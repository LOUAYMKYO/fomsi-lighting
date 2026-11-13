
const express = require("express");
const router = express.Router();

const { getPool } = require("../config/db");

const {
  authenticateToken,
  requireAdmin
} = require("../middleware/auth");

// GET: Retrieve all active products
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.query(`
      SELECT
        "ProductID",
        "CategoryID",
        "Name",
        "Description",
        "Price",
        "Stock",
        "ImageURL",
        "IsActive",
        "CreatedAt"
      FROM "Products"
      WHERE "IsActive" = TRUE
      ORDER BY "CreatedAt" DESC;
    `);

    return res.json(result.rows);

  } catch (error) {
    console.error("Error fetching products:", error.message);

    return res.status(500).json({
      message: "Failed to fetch products."
    });
  }
});

// POST: Create a new product (Admin only)
router.post("/", authenticateToken, requireAdmin, async (req, res) => {
  try {
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
      Name.trim().length > 200 ||
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

    const result = await pool.query(
      `
        INSERT INTO "Products" (
          "CategoryID",
          "Name",
          "Description",
          "Price",
          "Stock",
          "ImageURL"
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
          "ProductID",
          "CategoryID",
          "Name",
          "Description",
          "Price",
          "Stock",
          "ImageURL",
          "IsActive",
          "CreatedAt";
      `,
      [
        Number(CategoryID),
        Name.trim(),
        Description ?? null,
        Number(Price),
        Stock == null ? 0 : Number(Stock),
        ImageURL ?? null
      ]
    );

    return res.status(201).json({
      message: "Product created successfully.",
      product: result.rows[0]
    });

  } catch (error) {
    console.error("Error creating product:", error.message);

    if (error.code === "23503") {
      return res.status(400).json({
        message: "The specified category does not exist."
      });
    }

    return res.status(500).json({
      message: "Failed to create product."
    });
  }
});

// PUT: Update an existing product (Admin only)
router.put("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
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
      Name.trim().length > 200 ||
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

    const result = await pool.query(
      `
        UPDATE "Products"
        SET
          "CategoryID" = $1,
          "Name" = $2,
          "Description" = $3,
          "Price" = $4,
          "Stock" = $5,
          "ImageURL" = $6
        WHERE "ProductID" = $7
          AND "IsActive" = TRUE
        RETURNING
          "ProductID",
          "CategoryID",
          "Name",
          "Description",
          "Price",
          "Stock",
          "ImageURL",
          "IsActive",
          "CreatedAt";
      `,
      [
        Number(CategoryID),
        Name.trim(),
        Description ?? null,
        Number(Price),
        Stock == null ? 0 : Number(Stock),
        ImageURL ?? null,
        productId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Active product not found."
      });
    }

    return res.json({
      message: "Product updated successfully.",
      product: result.rows[0]
    });

  } catch (error) {
    console.error("Error updating product:", error.message);

    if (error.code === "23503") {
      return res.status(400).json({
        message: "The specified category does not exist."
      });
    }

    return res.status(500).json({
      message: "Failed to update product."
    });
  }
});

// DELETE: Soft-delete a product (Admin only)
router.delete("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const productId = Number(req.params.id);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({
        message: "Invalid product ID."
      });
    }

    const pool = await getPool();

    const result = await pool.query(
      `
        UPDATE "Products"
        SET "IsActive" = FALSE
        WHERE "ProductID" = $1
          AND "IsActive" = TRUE;
      `,
      [productId]
    );

    if (result.rowCount === 0) {
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
