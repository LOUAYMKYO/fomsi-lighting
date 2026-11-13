
const express = require("express");
const { getPool } = require("../config/db");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

router.use(authenticateToken);

// Get the current user's cart, creating it if necessary
async function getOrCreateCart(pool, userId) {
  await pool.query(
    `
      INSERT INTO "Carts" ("UserID")
      VALUES ($1)
      ON CONFLICT ("UserID") DO NOTHING;
    `,
    [userId]
  );

  const result = await pool.query(
    `
      SELECT "CartID"
      FROM "Carts"
      WHERE "UserID" = $1;
    `,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new Error("Unable to create or retrieve cart.");
  }

  return result.rows[0].CartID;
}

// GET /api/cart
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();
    const cartId = await getOrCreateCart(pool, req.user.userId);

    const result = await pool.query(
      `
        SELECT
          ci."CartItemID",
          ci."ProductID",
          p."Name",
          p."Description",
          p."Price",
          ci."Quantity",
          p."Stock",
          p."ImageURL",
          (p."Price" * ci."Quantity")::NUMERIC(12, 2) AS "LineTotal"
        FROM "CartItems" ci
        INNER JOIN "Products" p
          ON p."ProductID" = ci."ProductID"
        WHERE ci."CartID" = $1
          AND p."IsActive" = TRUE
        ORDER BY ci."CartItemID" DESC;
      `,
      [cartId]
    );

    const items = result.rows;

    const total = items.reduce(
      (sum, item) => sum + Number(item.LineTotal),
      0
    );

    return res.json({
      items,
      itemCount: items.reduce(
        (sum, item) => sum + item.Quantity,
        0
      ),
      total: Number(total.toFixed(2))
    });

  } catch (error) {
    console.error("Get cart error:", error.message);

    return res.status(500).json({
      message: "Unable to retrieve cart."
    });
  }
});

// POST /api/cart/items
router.post("/items", async (req, res) => {
  const pool = await getPool();
  const client = await pool.connect();

  try {
    const productId = Number(req.body.productId);

    const quantity = req.body.quantity === undefined
      ? 1
      : req.body.quantity;

    if (
      !Number.isSafeInteger(productId) ||
      productId <= 0 ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0
    ) {
      return res.status(400).json({
        message: "A valid productId and positive integer quantity are required."
      });
    }

    await client.query("BEGIN");

    // Lock the product while checking and updating its cart quantity.
    const productResult = await client.query(
      `
        SELECT
          "ProductID",
          "Name",
          "Price",
          "Stock"
        FROM "Products"
        WHERE "ProductID" = $1
          AND "IsActive" = TRUE
        FOR UPDATE;
      `,
      [productId]
    );

    if (productResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Product not found or unavailable."
      });
    }

    const product = productResult.rows[0];

    const cartId = await getOrCreateCart(
      client,
      req.user.userId
    );

    const existingResult = await client.query(
      `
        SELECT "CartItemID", "Quantity"
        FROM "CartItems"
        WHERE "CartID" = $1
          AND "ProductID" = $2
        FOR UPDATE;
      `,
      [cartId, productId]
    );

    const existingItem = existingResult.rows[0];

    const currentQuantity = existingItem
      ? existingItem.Quantity
      : 0;

    if (currentQuantity + quantity > product.Stock) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        message: "Requested quantity exceeds available stock.",
        availableStock: product.Stock
      });
    }

    if (existingItem) {
      await client.query(
        `
          UPDATE "CartItems"
          SET "Quantity" = $1
          WHERE "CartItemID" = $2;
        `,
        [
          currentQuantity + quantity,
          existingItem.CartItemID
        ]
      );
    } else {
      await client.query(
        `
          INSERT INTO "CartItems" (
            "CartID",
            "ProductID",
            "Quantity"
          )
          VALUES ($1, $2, $3);
        `,
        [cartId, productId, quantity]
      );
    }

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Product added to cart.",
      productId,
      quantityAdded: quantity
    });

  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Cart rollback error:", rollbackError.message);
    }

    console.error("Add cart item error:", error.message);

    return res.status(500).json({
      message: "Unable to add product to cart."
    });

  } finally {
    client.release();
  }
});

// PUT /api/cart/items/:productId
// Set the item's quantity to the supplied quantity.
router.put("/items/:productId", async (req, res) => {
  const pool = await getPool();
  const client = await pool.connect();

  try {
    const productId = Number(req.params.productId);
    const { quantity } = req.body;

    if (
      !Number.isSafeInteger(productId) ||
      productId <= 0 ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0
    ) {
      return res.status(400).json({
        message: "A valid productId and positive integer quantity are required."
      });
    }

    await client.query("BEGIN");

    const productResult = await client.query(
      `
        SELECT "Stock"
        FROM "Products"
        WHERE "ProductID" = $1
          AND "IsActive" = TRUE
        FOR UPDATE;
      `,
      [productId]
    );

    if (
      productResult.rows.length === 0 ||
      productResult.rows[0].Stock < quantity
    ) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        message: "Product unavailable or quantity exceeds stock."
      });
    }

    const cartId = await getOrCreateCart(
      client,
      req.user.userId
    );

    const result = await client.query(
      `
        UPDATE "CartItems"
        SET "Quantity" = $1
        WHERE "CartID" = $2
          AND "ProductID" = $3
        RETURNING "CartItemID";
      `,
      [quantity, cartId, productId]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Product not found in cart."
      });
    }

    await client.query("COMMIT");

    return res.json({
      message: "Cart quantity updated successfully."
    });

  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Cart rollback error:", rollbackError.message);
    }

    console.error("Update cart item error:", error.message);

    return res.status(500).json({
      message: "Unable to update cart item."
    });

  } finally {
    client.release();
  }
});

// DELETE /api/cart/items/:productId
router.delete("/items/:productId", async (req, res) => {
  try {
    const productId = Number(req.params.productId);

    if (!Number.isSafeInteger(productId) || productId <= 0) {
      return res.status(400).json({
        message: "Invalid product ID."
      });
    }

    const pool = await getPool();
    const cartId = await getOrCreateCart(pool, req.user.userId);

    const result = await pool.query(
      `
        DELETE FROM "CartItems"
        WHERE "CartID" = $1
          AND "ProductID" = $2
        RETURNING "CartItemID";
      `,
      [cartId, productId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Product not found in cart."
      });
    }

    return res.json({
      message: "Product removed from cart."
    });

  } catch (error) {
    console.error("Delete cart item error:", error.message);

    return res.status(500).json({
      message: "Unable to remove product from cart."
    });
  }
});

module.exports = router;
