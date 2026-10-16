
const express = require("express");
const { getPool, sql } = require("../config/db");
const {
  authenticateToken,
  requireAdmin
} = require("../middleware/auth");

const router = express.Router();

// Every endpoint in this router requires an authenticated admin.
router.use(authenticateToken, requireAdmin);

// GET /api/admin/orders
// List orders from all customers.
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT
        o.OrderID,
        o.UserID,
        u.FullName AS CustomerName,
        u.Email AS CustomerEmail,
        o.AddressID,
        o.TotalAmount,
        o.OrderStatus,
        o.CreatedAt,
        COUNT(oi.OrderItemID) AS ItemCount
      FROM dbo.Orders o
      INNER JOIN dbo.Users u
        ON u.UserID = o.UserID
      LEFT JOIN dbo.OrderItems oi
        ON oi.OrderID = o.OrderID
      GROUP BY
        o.OrderID,
        o.UserID,
        u.FullName,
        u.Email,
        o.AddressID,
        o.TotalAmount,
        o.OrderStatus,
        o.CreatedAt
      ORDER BY o.CreatedAt DESC;
    `);

    return res.json({
      orders: result.recordset.map(order => ({
        orderId: Number(order.OrderID),
        userId: Number(order.UserID),
        customerName: order.CustomerName,
        customerEmail: order.CustomerEmail,
        addressId: Number(order.AddressID),
        totalAmount: Number(order.TotalAmount),
        status: order.OrderStatus,
        createdAt: order.CreatedAt,
        itemCount: Number(order.ItemCount)
      }))
    });
  } catch (error) {
    console.error("Admin get orders error:", error);

    return res.status(500).json({
      message: "Unable to retrieve orders."
    });
  }
});

 // PATCH /api/admin/orders/:id/status
 // Update an order's status as an administrator.
router.patch("/:id/status", async (req, res) => {
  const orderId = Number(req.params.id);
  const { status } = req.body;

  const allowedStatuses = [
    "confirmed",
    "shipped",
    "delivered",
    "cancelled"
  ];

  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    return res.status(400).json({
      message: "A valid order ID is required."
    });
  }

  if (
    typeof status !== "string" ||
    !allowedStatuses.includes(status)
  ) {
    return res.status(400).json({
      message: "Status must be confirmed, shipped, delivered, or cancelled."
    });
  }

  let transaction;

  try {
    const pool = await getPool();

    transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    const orderResult = await new sql.Request(transaction)
      .input("OrderID", sql.Int, orderId)
      .query(`
        SELECT OrderID, OrderStatus
        FROM dbo.Orders WITH (UPDLOCK, HOLDLOCK)
        WHERE OrderID = @OrderID;
      `);

    if (orderResult.recordset.length === 0) {
      await transaction.rollback();

      return res.status(404).json({
        message: "Order not found."
      });
    }

    const currentStatus = orderResult.recordset[0].OrderStatus;

    const transitions = {
      pending: ["confirmed", "cancelled"],
      confirmed: ["shipped", "cancelled"],
      shipped: ["delivered"],
      delivered: [],
      cancelled: []
    };

    if (!transitions[currentStatus]?.includes(status)) {
      await transaction.rollback();

      return res.status(400).json({
        message: `Cannot change order status from ${currentStatus} to ${status}.`
      });
    }

    // Restore inventory if the order is cancelled.
    if (status === "cancelled") {
      await new sql.Request(transaction)
        .input("OrderID", sql.Int, orderId)
        .query(`
          UPDATE p
          SET p.Stock = p.Stock + oi.Quantity
          FROM dbo.Products p
          INNER JOIN dbo.OrderItems oi
            ON oi.ProductID = p.ProductID
          WHERE oi.OrderID = @OrderID;
        `);
    }

    await new sql.Request(transaction)
      .input("OrderID", sql.Int, orderId)
      .input("Status", sql.NVarChar(20), status)
      .query(`
        UPDATE dbo.Orders
        SET OrderStatus = @Status
        WHERE OrderID = @OrderID;
      `);

    await transaction.commit();

    return res.json({
      message: "Order status updated successfully.",
      orderId,
      previousStatus: currentStatus,
      status
    });
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {
        // The transaction may already have rolled back.
      }
    }

    console.error("Admin update order status error:", error);

    return res.status(500).json({
      message: "Unable to update order status."
    });
  }
});

module.exports = router;
