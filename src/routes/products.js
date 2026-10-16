
const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../config/db");
const {
  authenticateToken,
  requireAdmin
} = require("../middleware/auth");
// GET: Retrieve all active products
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT
        ProductID,
        CategoryID,
        Name,
        Description,
        Price,
        Stock,
        ImageURL,
        IsActive,
        CreatedAt
      FROM dbo.Products
      WHERE IsActive = 1
      ORDER BY CreatedAt DESC;
    `);

    return res.json(result.recordset);
  } catch (error) {
    console.error("Error fetching products:", error.message);

    return res.status(500).json({
      message: "Failed to fetch products."
    });
  }
});

// POST: Create a new product
router.post("/", authenticateToken, requireAdmin, async (req, res) => {  try {
    const {
      CategoryID,
      Name,
      Description,
      Price,
      Stock,
      ImageURL
    } = req.body;

    if (CategoryID == null || !Name || Price == null) {
      return res.status(400).json({
        message: "CategoryID, Name, and Price are required."
      });
    }

    if (
      !Number.isInteger(Number(CategoryID)) ||
      Number(CategoryID) <= 0 ||
      typeof Name !== "string" ||
      !Name.trim() ||
      !Number.isFinite(Number(Price)) ||
      Number(Price) < 0 ||
      (Stock != null &&
        (!Number.isInteger(Number(Stock)) || Number(Stock) < 0)) ||
      (Description != null && typeof Description !== "string") ||
      (ImageURL != null && typeof ImageURL !== "string")
    ) {
      return res.status(400).json({
        message: "Please provide valid product details."
      });
    }

    const pool = await getPool();

    const result = await pool.request()
      .input("CategoryID", sql.Int, Number(CategoryID))
      .input("Name", sql.NVarChar(200), Name.trim())
      .input("Description", sql.NVarChar(sql.MAX), Description ?? null)
      .input("Price", sql.Decimal(12, 2), Number(Price))
      .input("Stock", sql.Int, Stock == null ? 0 : Number(Stock))
      .input("ImageURL", sql.NVarChar(1000), ImageURL ?? null)
      .query(`
        INSERT INTO dbo.Products (
          CategoryID,
          Name,
          Description,
          Price,
          Stock,
          ImageURL
        )
        OUTPUT
          INSERTED.ProductID,
          INSERTED.CategoryID,
          INSERTED.Name,
          INSERTED.Description,
          INSERTED.Price,
          INSERTED.Stock,
          INSERTED.ImageURL,
          INSERTED.IsActive,
          INSERTED.CreatedAt
        VALUES (
          @CategoryID,
          @Name,
          @Description,
          @Price,
          @Stock,
          @ImageURL
        );
      `);

    return res.status(201).json({
      message: "Product created successfully.",
      product: result.recordset[0]
    });
  } catch (error) {
    console.error("Error creating product:", error.message);

    if (error.number === 547) {
      return res.status(400).json({
        message: "The specified category does not exist, or a database constraint was violated."
      });
    }

    return res.status(500).json({
      message: "Failed to create product."
    });
  }
});

// PUT: Update an existing product
router.put("/:id", authenticateToken, requireAdmin, async (req, res) => {  try {
    const productId = Number(req.params.id);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({
        message: "Invalid product ID."
      });
    }

    const {
      CategoryID,
      Name,
      Description,
      Price,
      Stock,
      ImageURL
    } = req.body;

    if (
      CategoryID == null ||
      !Name ||
      Price == null
    ) {
      return res.status(400).json({
        message: "CategoryID, Name, and Price are required."
      });
    }

    if (
      !Number.isInteger(Number(CategoryID)) ||
      Number(CategoryID) <= 0 ||
      typeof Name !== "string" ||
      !Name.trim() ||
      !Number.isFinite(Number(Price)) ||
      Number(Price) < 0 ||
      (Stock != null &&
        (!Number.isInteger(Number(Stock)) || Number(Stock) < 0)) ||
      (Description != null && typeof Description !== "string") ||
      (ImageURL != null && typeof ImageURL !== "string")
    ) {
      return res.status(400).json({
        message: "Please provide valid product details."
      });
    }

    const pool = await getPool();

    const result = await pool.request()
      .input("ProductID", sql.Int, productId)
      .input("CategoryID", sql.Int, Number(CategoryID))
      .input("Name", sql.NVarChar(200), Name.trim())
      .input("Description", sql.NVarChar(sql.MAX), Description ?? null)
      .input("Price", sql.Decimal(12, 2), Number(Price))
      .input("Stock", sql.Int, Stock == null ? 0 : Number(Stock))
      .input("ImageURL", sql.NVarChar(1000), ImageURL ?? null)
      .query(`
        UPDATE dbo.Products
        SET
          CategoryID = @CategoryID,
          Name = @Name,
          Description = @Description,
          Price = @Price,
          Stock = @Stock,
          ImageURL = @ImageURL
        WHERE ProductID = @ProductID
          AND IsActive = 1;

        SELECT
          ProductID,
          CategoryID,
          Name,
          Description,
          Price,
          Stock,
          ImageURL,
          IsActive,
          CreatedAt
        FROM dbo.Products
        WHERE ProductID = @ProductID
          AND IsActive = 1;
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        message: "Active product not found."
      });
    }

    return res.json({
      message: "Product updated successfully.",
      product: result.recordset[0]
    });
  } catch (error) {
    console.error("Error updating product:", error.message);

    if (error.number === 547) {
      return res.status(400).json({
        message: "The specified category does not exist, or a database constraint was violated."
      });
    }

    return res.status(500).json({
      message: "Failed to update product."
    });
  }
});

 // DELETE: Soft-delete a product
router.delete("/:id", authenticateToken, requireAdmin, async (req, res) => {  try {
    const productId = Number(req.params.id);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({
        message: "Invalid product ID."
      });
    }

    const pool = await getPool();

    const result = await pool.request()
      .input("ProductID", sql.Int, productId)
      .query(`
        UPDATE dbo.Products
        SET IsActive = 0
        WHERE ProductID = @ProductID
          AND IsActive = 1;

        SELECT @@ROWCOUNT AS RowsAffected;
      `);

    if (result.recordsets[0][0].RowsAffected === 0) {
      return res.status(404).json({
        message: "Active product not found."
      });
    }

    return res.json({
      message: "Product deactivated successfully."
    });
  } catch (error) {
    console.error("Error deleting product:", error.message);

    return res.status(500).json({
      message: "Failed to delete product."
    });
  }
});

module.exports = router;
