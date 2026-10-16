
const express = require("express");
const { getPool, sql } = require("../config/db");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

router.use(authenticateToken);

// POST /api/orders
// Create an order from the logged-in user's cart.
router.post("/", async (req, res) => {
  const addressId = Number(req.body.addressId);

  if (!Number.isSafeInteger(addressId) || addressId <= 0) {
    return res.status(400).json({
      message: "A valid addressId is required."
    });
  }

  let transaction;

  try {
    const pool = await getPool();

    transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const request = new sql.Request(transaction);

    // Confirm that this address belongs to the logged-in customer.
    const addressResult = await request
      .input("UserID", sql.Int, req.user.userId)
      .input("AddressID", sql.Int, addressId)
      .query(`
        SELECT AddressID
        FROM dbo.Addresses
        WHERE AddressID = @AddressID
          AND UserID = @UserID;
      `);

    if (addressResult.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({
        message: "Delivery address not found."
      });
    }

    // Find the customer's cart.
    const cartResult = await new sql.Request(transaction)
      .input("UserID", sql.Int, req.user.userId)
      .query(`
        SELECT CartID
        FROM dbo.Carts
        WHERE UserID = @UserID;
      `);

    if (cartResult.recordset.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        message: "Your cart is empty."
      });
    }

    const cartId = cartResult.recordset[0].CartID;

    // Lock cart items and products while creating the order.
    const itemsResult = await new sql.Request(transaction)
      .input("CartID", sql.Int, cartId)
      .query(`
        SELECT
          ci.ProductID,
          ci.Quantity,
          p.Name,
          p.Price,
          p.Stock,
          p.IsActive
        FROM dbo.CartItems ci WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN dbo.Products p WITH (UPDLOCK, HOLDLOCK)
          ON p.ProductID = ci.ProductID
        WHERE ci.CartID = @CartID;
      `);

    const items = itemsResult.recordset;

    if (items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        message: "Your cart is empty."
      });
    }

    for (const item of items) {
      if (!item.IsActive) {
        await transaction.rollback();
        return res.status(400).json({
          message: `Product "${item.Name}" is no longer available.`
        });
      }

      if (item.Quantity > item.Stock) {
        await transaction.rollback();
        return res.status(400).json({
          message: `Insufficient stock for "${item.Name}".`,
          availableStock: item.Stock
        });
      }
    }

    const totalAmount = items.reduce(
      (sum, item) => sum + Number(item.Price) * item.Quantity,
      0
    );

    // Create the order header.
    const orderResult = await new sql.Request(transaction)
      .input("UserID", sql.Int, req.user.userId)
      .input("AddressID", sql.Int, addressId)
      .input("TotalAmount", sql.Decimal(12, 2), totalAmount)
      .query(`
        INSERT INTO dbo.Orders
          (UserID, AddressID, TotalAmount)
        OUTPUT INSERTED.OrderID
        VALUES
          (@UserID, @AddressID, @TotalAmount);
      `);

    const orderId = orderResult.recordset[0].OrderID;

    // Save purchase prices and deduct stock.
    for (const item of items) {
      const itemResult = await new sql.Request(transaction)
        .input("OrderID", sql.Int, orderId)
        .input("ProductID", sql.Int, item.ProductID)
        .input("Quantity", sql.Int, item.Quantity)
        .input("UnitPrice", sql.Decimal(12, 2), item.Price)
        .input("Name", sql.NVarChar(150), item.Name)
        .query(`
          INSERT INTO dbo.OrderItems
            (OrderID, ProductID, Quantity, UnitPrice)
          VALUES
            (@OrderID, @ProductID, @Quantity, @UnitPrice);

          UPDATE dbo.Products
          SET Stock = Stock - @Quantity
          WHERE ProductID = @ProductID
            AND IsActive = 1
            AND Stock >= @Quantity;

          IF @@ROWCOUNT = 0
            THROW 50001, 'Product stock changed or product is unavailable.', 1;
        `);
    }

    // Clear the cart only after every order item succeeds.
    await new sql.Request(transaction)
      .input("CartID", sql.Int, cartId)
      .query(`
        DELETE FROM dbo.CartItems
        WHERE CartID = @CartID;
      `);

    await transaction.commit();

    return res.status(201).json({
      message: "Order created successfully.",
      orderId,
      totalAmount: Number(totalAmount.toFixed(2)),
      status: "pending",
      itemCount: items.reduce((sum, item) => sum + item.Quantity, 0)
    });
  } catch (error) {
    if (transaction && transaction._aborted !== true) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error("Order rollback error:", rollbackError.message);
      }
    }

    console.error("Create order error:", error);

    return res.status(500).json({
      message: "Unable to create order."
    });
  }
});

 // GET /api/orders
 // Return only the logged-in customer's orders.
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool
      .request()
      .input("UserID", sql.Int, req.user.userId)
      .query(`
        SELECT
          o.OrderID,
          o.AddressID,
          o.TotalAmount,
          o.OrderStatus,
          o.CreatedAt,
          oi.OrderItemID,
          oi.ProductID,
          p.Name AS ProductName,
          oi.Quantity,
          oi.UnitPrice,
          CAST(
            oi.Quantity * oi.UnitPrice AS DECIMAL(12, 2)
          ) AS LineTotal
        FROM dbo.Orders o
        LEFT JOIN dbo.OrderItems oi
          ON oi.OrderID = o.OrderID
        LEFT JOIN dbo.Products p
          ON p.ProductID = oi.ProductID
        WHERE o.UserID = @UserID
        ORDER BY o.CreatedAt DESC, oi.OrderItemID ASC;
      `);

    const ordersMap = new Map();

    for (const row of result.recordset) {
      if (!ordersMap.has(row.OrderID)) {
        ordersMap.set(row.OrderID, {
          orderId: row.OrderID,
          addressId: row.AddressID,
          totalAmount: Number(row.TotalAmount),
          status: row.OrderStatus,
          createdAt: row.CreatedAt,
          items: []
        });
      }

      if (row.OrderItemID !== null) {
        ordersMap.get(row.OrderID).items.push({
          orderItemId: row.OrderItemID,
          productId: row.ProductID,
          productName: row.ProductName || "Unavailable product",
          quantity: row.Quantity,
          unitPrice: Number(row.UnitPrice),
          lineTotal: Number(row.LineTotal)
        });
      }
    }

    return res.json({
      orders: Array.from(ordersMap.values())
    });
  } catch (error) {
    console.error("Get order history error:", error);

    return res.status(500).json({
      message: "Unable to retrieve order history."
    });
  }
});

 // GET /api/orders/:id
 // View one order belonging to the logged-in customer.
router.get("/:id", async (req, res) => {
  try {
    const orderId = Number(req.params.id);

    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      return res.status(400).json({
        message: "A valid order ID is required."
      });
    }

    const pool = await getPool();

    const result = await pool
      .request()
      .input("OrderID", sql.Int, orderId)
      .input("UserID", sql.Int, req.user.userId)
      .query(`
        SELECT
          o.OrderID,
          o.UserID,
          o.AddressID,
          o.TotalAmount,
          o.OrderStatus,
          o.CreatedAt,
          a.AddressLine,
          a.City,
          a.Wilaya,
          a.PostalCode,
          a.Phone,
          oi.OrderItemID,
          oi.ProductID,
          p.Name AS ProductName,
          oi.Quantity,
          oi.UnitPrice,
          CAST(
            oi.Quantity * oi.UnitPrice AS DECIMAL(12, 2)
          ) AS LineTotal
        FROM dbo.Orders o
        INNER JOIN dbo.Addresses a
          ON a.AddressID = o.AddressID
        LEFT JOIN dbo.OrderItems oi
          ON oi.OrderID = o.OrderID
        LEFT JOIN dbo.Products p
          ON p.ProductID = oi.ProductID
        WHERE o.OrderID = @OrderID
          AND o.UserID = @UserID
        ORDER BY oi.OrderItemID;
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        message: "Order not found."
      });
    }

    const first = result.recordset[0];

    const order = {
      orderId: Number(first.OrderID),
      totalAmount: Number(first.TotalAmount),
      status: first.OrderStatus,
      createdAt: first.CreatedAt,
      deliveryAddress: {
        addressId: Number(first.AddressID),
        addressLine: first.AddressLine,
        city: first.City,
        wilaya: first.Wilaya,
        postalCode: first.PostalCode,
        phone: first.Phone
      },
      items: result.recordset
        .filter(row => row.OrderItemID !== null)
        .map(row => ({
          orderItemId: Number(row.OrderItemID),
          productId: Number(row.ProductID),
          productName: row.ProductName || "Unavailable product",
          quantity: row.Quantity,
          unitPrice: Number(row.UnitPrice),
          lineTotal: Number(row.LineTotal)
        }))
    };

    return res.json({ order });
  } catch (error) {
    console.error("Get order details error:", error);

    return res.status(500).json({
      message: "Unable to retrieve order details."
    });
  }
});

 // POST /api/orders/:id/cancel
 // Allow customers to cancel their own pending orders.
router.post("/:id/cancel", async (req, res) => {
  const orderId = Number(req.params.id);
  let transaction;

  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    return res.status(400).json({
      message: "A valid order ID is required."
    });
  }

  try {
    const pool = await getPool();

    transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    // Lock the order and verify ownership.
    const orderResult = await new sql.Request(transaction)
      .input("OrderID", sql.Int, orderId)
      .input("UserID", sql.Int, req.user.userId)
      .query(`
        SELECT OrderID, OrderStatus
        FROM dbo.Orders WITH (UPDLOCK, HOLDLOCK)
        WHERE OrderID = @OrderID
          AND UserID = @UserID;
      `);

    if (orderResult.recordset.length === 0) {
      await transaction.rollback();

      return res.status(404).json({
        message: "Order not found."
      });
    }

    const currentStatus = orderResult.recordset[0].OrderStatus;

    if (currentStatus !== "pending") {
      await transaction.rollback();

      return res.status(400).json({
        message: "Only pending orders can be cancelled.",
        currentStatus
      });
    }

    // Restore stock for all products in this order.
    await new sql.Request(transaction)
      .input("OrderID", sql.Int, orderId)
      .query(`
        UPDATE p
        SET p.Stock = p.Stock + oi.Quantity
        FROM dbo.Products AS p
        INNER JOIN dbo.OrderItems AS oi
          ON oi.ProductID = p.ProductID
        WHERE oi.OrderID = @OrderID;
      `);

    // Update the order status.
    await new sql.Request(transaction)
      .input("OrderID", sql.Int, orderId)
      .query(`
        UPDATE dbo.Orders
        SET OrderStatus = 'cancelled'
        WHERE OrderID = @OrderID;
      `);

    await transaction.commit();

    return res.json({
      message: "Order cancelled successfully.",
      orderId,
      previousStatus: currentStatus,
      status: "cancelled"
    });
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {
        // The transaction may already have rolled back.
      }
    }

    console.error("Customer cancel order error:", error);

    return res.status(500).json({
      message: "Unable to cancel order."
    });
  }
});

module.exports = router;
