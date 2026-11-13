
const express = require("express");
const { getPool } = require("../config/db");
const {
  authenticateToken,
  requireAdmin
} = require("../middleware/auth");

const router = express.Router();

// Every endpoint requires an authenticated admin.
router.use(authenticateToken, requireAdmin);

// GET /api/admin/orders
// List orders from all customers.
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.query(`
      SELECT
        o."OrderID",
        o."UserID",
        u."FullName" AS "CustomerName",
        u."Email" AS "CustomerEmail",
        o."AddressID",
        o."TotalAmount",
        o."OrderStatus",
        o."CreatedAt",
        COUNT(oi."OrderItemID") AS "ItemCount"
      FROM "Orders" o
      INNER JOIN "Users" u
        ON u."UserID" = o."UserID"
      LEFT JOIN "OrderItems" oi
        ON oi."OrderID" = o."OrderID"
      GROUP BY
        o."OrderID",
        o."UserID",
        u."FullName",
        u."Email",
        o."AddressID",
        o."TotalAmount",
        o."OrderStatus",
        o."CreatedAt"
      ORDER BY o."CreatedAt" DESC;
    `);

    return res.json({
      orders: result.rows.map(order => ({
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
    console.error("Admin get orders error:", error.message);

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

  let client;
  let transactionStarted = false;

  try {
    const pool = await getPool();
    client = await pool.connect();

    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionStarted = true;

    // Lock the order to prevent simultaneous status changes.
    const orderResult = await client.query(
      `
        SELECT "OrderID", "OrderStatus"
        FROM "Orders"
        WHERE "OrderID" = $1
        FOR UPDATE;
      `,
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        message: "Order not found."
      });
    }

    const currentStatus = orderResult.rows[0].OrderStatus;

    const transitions = {
      pending: ["confirmed", "cancelled"],
      confirmed: ["shipped", "cancelled"],
      shipped: ["delivered"],
      delivered: [],
      cancelled: []
    };

    if (!transitions[currentStatus]?.includes(status)) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(400).json({
        message: `Cannot change order status from ${currentStatus} to ${status}.`
      });
    }

    // Restore inventory only when cancelling an eligible order.
    // The locked order and transition rules prevent restoring twice.
    if (status === "cancelled") {
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
    }

    await client.query(
      `
        UPDATE "Orders"
        SET "OrderStatus" = $1
        WHERE "OrderID" = $2;
      `,
      [status, orderId]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    return res.json({
      message: "Order status updated successfully.",
      orderId,
      previousStatus: currentStatus,
      status
    });

  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Admin order rollback error:", rollbackError.message);
      }
    }

    console.error("Admin update order status error:", error.message);

    return res.status(500).json({
      message: "Unable to update order status."
    });

  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;
