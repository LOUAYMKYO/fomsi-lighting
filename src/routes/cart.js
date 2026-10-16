
const express = require("express");
const { getPool, sql } = require("../config/db");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

router.use(authenticateToken);

// Get the current user's cart, creating it if necessary
async function getOrCreateCart(pool, userId) {
  const result = await pool
    .request()
    .input("UserID", sql.Int, userId)
    .query(`
      IF NOT EXISTS (
        SELECT 1 FROM dbo.Carts WHERE UserID = @UserID
      )
      BEGIN
        INSERT INTO dbo.Carts (UserID) VALUES (@UserID);
      END;

      SELECT CartID
      FROM dbo.Carts
      WHERE UserID = @UserID;
    `);

  return result.recordset[0].CartID;
}

// GET /api/cart
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();
    const cartId = await getOrCreateCart(pool, req.user.userId);

    const result = await pool
      .request()
      .input("CartID", sql.Int, cartId)
      .query(`
        SELECT
          ci.CartItemID,
          ci.ProductID,
          p.Name,
          p.Description,
          p.Price,
          ci.Quantity,
          p.Stock,
          p.ImageURL,
          CAST(p.Price * ci.Quantity AS DECIMAL(12, 2)) AS LineTotal
        FROM dbo.CartItems ci
        INNER JOIN dbo.Products p
          ON p.ProductID = ci.ProductID
        WHERE ci.CartID = @CartID
          AND p.IsActive = 1
        ORDER BY ci.CartItemID DESC;
      `);

    const items = result.recordset;
    const total = items.reduce(
      (sum, item) => sum + Number(item.LineTotal),
      0
    );

    res.json({
      items,
      itemCount: items.reduce((sum, item) => sum + item.Quantity, 0),
      total: Number(total.toFixed(2))
    });
  } catch (error) {
    console.error("Get cart error:", error);
    res.status(500).json({
      message: "Unable to retrieve cart."
    });
  }
});

// POST /api/cart/items
router.post("/items", async (req, res) => {
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

    const pool = await getPool();

    const productResult = await pool
      .request()
      .input("ProductID", sql.Int, productId)
      .query(`
        SELECT ProductID, Name, Price, Stock
        FROM dbo.Products
        WHERE ProductID = @ProductID
          AND IsActive = 1;
      `);

    if (productResult.recordset.length === 0) {
      return res.status(404).json({
        message: "Product not found or unavailable."
      });
    }

    const product = productResult.recordset[0];
    const cartId = await getOrCreateCart(pool, req.user.userId);

    // Add to an existing row, or create a new row.
    // Lock the cart-item key to avoid concurrent duplicate rows.
    const result = await pool
      .request()
      .input("CartID", sql.Int, cartId)
      .input("ProductID", sql.Int, productId)
      .input("Quantity", sql.Int, quantity)
      .input("Stock", sql.Int, product.Stock)
      .query(`
        SET XACT_ABORT ON;
        BEGIN TRANSACTION;

        DECLARE @ExistingQuantity INT;

        SELECT @ExistingQuantity = Quantity
        FROM dbo.CartItems WITH (UPDLOCK, HOLDLOCK)
        WHERE CartID = @CartID
          AND ProductID = @ProductID;

        IF ISNULL(@ExistingQuantity, 0) + @Quantity > @Stock
        BEGIN
          ROLLBACK TRANSACTION;
          SELECT CAST(0 AS BIT) AS Success;
        END
        ELSE
        BEGIN
          IF @ExistingQuantity IS NULL
          BEGIN
            INSERT INTO dbo.CartItems (CartID, ProductID, Quantity)
            VALUES (@CartID, @ProductID, @Quantity);
          END
          ELSE
          BEGIN
            UPDATE dbo.CartItems
            SET Quantity = @ExistingQuantity + @Quantity
            WHERE CartID = @CartID
              AND ProductID = @ProductID;
          END;

          COMMIT TRANSACTION;
          SELECT CAST(1 AS BIT) AS Success;
        END;
      `);

    if (!result.recordset[0].Success) {
      return res.status(400).json({
        message: "Requested quantity exceeds available stock.",
        availableStock: product.Stock
      });
    }

    res.status(201).json({
      message: "Product added to cart.",
      productId,
      quantityAdded: quantity
    });
  } catch (error) {
    console.error("Add cart item error:", error);
    res.status(500).json({
      message: "Unable to add product to cart."
    });
  }
});

// PUT /api/cart/items/:productId
// Set the item's quantity to the supplied quantity.
router.put("/items/:productId", async (req, res) => {
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

    const pool = await getPool();
    const cartId = await getOrCreateCart(pool, req.user.userId);

    const result = await pool
      .request()
      .input("CartID", sql.Int, cartId)
      .input("ProductID", sql.Int, productId)
      .input("Quantity", sql.Int, quantity)
      .query(`
        UPDATE ci
        SET Quantity = @Quantity
        FROM dbo.CartItems ci
        INNER JOIN dbo.Products p
          ON p.ProductID = ci.ProductID
        WHERE ci.CartID = @CartID
          AND ci.ProductID = @ProductID
          AND p.IsActive = 1
          AND p.Stock >= @Quantity;

        SELECT @@ROWCOUNT AS RowsAffected;
      `);

    if (result.recordset[0].RowsAffected === 0) {
      return res.status(400).json({
        message: "Cart item not found, product unavailable, or quantity exceeds stock."
      });
    }

    res.json({
      message: "Cart quantity updated successfully."
    });
  } catch (error) {
    console.error("Update cart item error:", error);
    res.status(500).json({
      message: "Unable to update cart item."
    });
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

    const result = await pool
      .request()
      .input("CartID", sql.Int, cartId)
      .input("ProductID", sql.Int, productId)
      .query(`
        DELETE FROM dbo.CartItems
        OUTPUT DELETED.CartItemID
        WHERE CartID = @CartID
          AND ProductID = @ProductID;
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        message: "Product not found in cart."
      });
    }

    res.json({
      message: "Product removed from cart."
    });
  } catch (error) {
    console.error("Delete cart item error:", error);
    res.status(500).json({
      message: "Unable to remove product from cart."
    });
  }
});

module.exports = router;
