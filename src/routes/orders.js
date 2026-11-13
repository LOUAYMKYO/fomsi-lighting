
const express = require("express");
const { getPool } = require("../config/db");
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

  let client;
  let transactionStarted = false;

  try {
    const pool = await getPool();
    client = await pool.connect();

    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionStarted = true;

    // Confirm that this address belongs to the logged-in customer.
    const addressResult = await client.query(
      `
        SELECT "AddressID"
        FROM "Addresses"
        WHERE "AddressID" = $1
          AND "UserID" = $2
        FOR SHARE;
      `,
      [addressId, req.user.userId]
    );

    if (addressResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        message: "Delivery address not found."
      });
    }

    // Find and lock the customer's cart.
    const cartResult = await client.query(
      `
        SELECT "CartID"
        FROM "Carts"
        WHERE "UserID" = $1
        FOR UPDATE;
      `,
      [req.user.userId]
    );

    if (cartResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(400).json({
        message: "Your cart is empty."
      });
    }

    const cartId = cartResult.rows[0].CartID;

    // Lock cart items and products while creating the order.
    const itemsResult = await client.query(
      `
        SELECT
          ci."ProductID",
          ci."Quantity",
          p."Name",
          p."Price",
          p."Stock",
          p."IsActive"
        FROM "CartItems" ci
        INNER JOIN "Products" p
          ON p."ProductID" = ci."ProductID"
        WHERE ci."CartID" = $1
        ORDER BY p."ProductID"
        FOR UPDATE OF ci, p;
      `,
      [cartId]
    );

    const items = itemsResult.rows;

    if (items.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(400).json({
        message: "Your cart is empty."
      });
    }

    // Validate product availability and stock.
    for (const item of items) {
      if (!item.IsActive) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(400).json({
          message: `Product "${item.Name}" is no longer available.`
        });
      }

      if (item.Quantity > item.Stock) {
        await client.query("ROLLBACK");
        transactionStarted = false;

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
    const orderResult = await client.query(
      `
        INSERT INTO "Orders" (
          "UserID",
          "AddressID",
          "TotalAmount"
        )
        VALUES ($1, $2, $3)
        RETURNING "OrderID";
      `,
      [req.user.userId, addressId, totalAmount]
    );

    const orderId = orderResult.rows[0].OrderID;

    // Save purchase prices and deduct stock.
    for (const item of items) {
      await client.query(
        `
          INSERT INTO "OrderItems" (
            "OrderID",
            "ProductID",
            "Quantity",
            "UnitPrice"
          )
          VALUES ($1, $2, $3, $4);
        `,
        [
          orderId,
          item.ProductID,
          item.Quantity,
          item.Price
        ]
      );

      const stockResult = await client.query(
        `
          UPDATE "Products"
          SET "Stock" = "Stock" - $1
          WHERE "ProductID" = $2
            AND "IsActive" = TRUE
            AND "Stock" >= $1
          RETURNING "ProductID";
        `,
        [item.Quantity, item.ProductID]
      );

      if (stockResult.rows.length === 0) {
        throw new Error(
          "Product stock changed or product is unavailable."
        );
      }
    }

    // Clear the cart only after every order item succeeds.
    await client.query(
      `
        DELETE FROM "CartItems"
        WHERE "CartID" = $1;
      `,
      [cartId]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    return res.status(201).json({
      message: "Order created successfully.",
      orderId,
      totalAmount: Number(totalAmount.toFixed(2)),
      status: "pending",
      itemCount: items.reduce(
        (sum, item) => sum + item.Quantity,
        0
      )
    });

  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Order rollback error:", rollbackError.message);
      }
    }

    console.error("Create order error:", error.message);

    return res.status(500).json({
      message: "Unable to create order."
    });

  } finally {
    if (client) {
      client.release();
    }
  }
});

// GET /api/orders
// Return only the logged-in customer's orders.
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.query(
      `
        SELECT
          o."OrderID",
          o."AddressID",
          o."TotalAmount",
          o."OrderStatus",
          o."CreatedAt",
          oi."OrderItemID",
          oi."ProductID",
          p."Name" AS "ProductName",
          oi."Quantity",
          oi."UnitPrice",
          (
            oi."Quantity" * oi."UnitPrice"
          )::NUMERIC(12, 2) AS "LineTotal"
        FROM "Orders" o
        LEFT JOIN "OrderItems" oi
          ON oi."OrderID" = o."OrderID"
        LEFT JOIN "Products" p
          ON p."ProductID" = oi."ProductID"
        WHERE o."UserID" = $1
        ORDER BY
          o."CreatedAt" DESC,
          oi."OrderItemID" ASC;
      `,
      [req.user.userId]
    );

    const ordersMap = new Map();

    for (const row of result.rows) {
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
    console.error("Get order history error:", error.message);

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

    const result = await pool.query(
      `
        SELECT
          o."OrderID",
          o."UserID",
          o."AddressID",
          o."TotalAmount",
          o."OrderStatus",
          o."CreatedAt",
          a."AddressLine",
          a."City",
          a."Wilaya",
          a."PostalCode",
          a."Phone",
          oi."OrderItemID",
          oi."ProductID",
          p."Name" AS "ProductName",
          oi."Quantity",
          oi."UnitPrice",
          (
            oi."Quantity" * oi."UnitPrice"
          )::NUMERIC(12, 2) AS "LineTotal"
        FROM "Orders" o
        INNER JOIN "Addresses" a
          ON a."AddressID" = o."AddressID"
        LEFT JOIN "OrderItems" oi
          ON oi."OrderID" = o."OrderID"
        LEFT JOIN "Products" p
          ON p."ProductID" = oi."ProductID"
        WHERE o."OrderID" = $1
          AND o."UserID" = $2
        ORDER BY oi."OrderItemID";
      `,
      [orderId, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Order not found."
      });
    }

    const first = result.rows[0];

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

      items: result.rows
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
    console.error("Get order details error:", error.message);

    return res.status(500).json({
      message: "Unable to retrieve order details."
    });
  }
});

// POST /api/orders/:id/cancel
// Allow customers to cancel their own pending orders.
router.post("/:id/cancel", async (req, res) => {
  const orderId = Number(req.params.id);

  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    return res.status(400).json({
      message: "A valid order ID is required."
    });
  }

  let client;
  let transactionStarted = false;

  try {
    const pool = await getPool();
    client = await pool.connect();

    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionStarted = true;

    // Lock the order and verify ownership.
    const orderResult = await client.query(
      `
        SELECT "OrderID", "OrderStatus"
        FROM "Orders"
        WHERE "OrderID" = $1
          AND "UserID" = $2
        FOR UPDATE;
      `,
      [orderId, req.user.userId]
    );

    if (orderResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        message: "Order not found."
      });
    }

    const currentStatus = orderResult.rows[0].OrderStatus;

    if (currentStatus !== "pending") {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(400).json({
        message: "Only pending orders can be cancelled.",
        currentStatus
      });
    }

    // Restore stock for all products in this order.
    await client.query(
      `
        UPDATE "Products" AS p
        SET "Stock" = p."Stock" + oi."Quantity"
        FROM "OrderItems" AS oi
        WHERE oi."ProductID" = p."ProductID"
          AND oi."OrderID" = $1;
      `,
      [orderId]
    );

    // Update the order status.
    await client.query(
      `
        UPDATE "Orders"
        SET "OrderStatus" = 'cancelled'
        WHERE "OrderID" = $1;
      `,
      [orderId]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    return res.json({
      message: "Order cancelled successfully.",
      orderId,
      previousStatus: currentStatus,
      status: "cancelled"
    });

  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Order rollback error:", rollbackError.message);
      }
    }

    console.error("Customer cancel order error:", error.message);

    return res.status(500).json({
      message: "Unable to cancel order."
    });

  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;
