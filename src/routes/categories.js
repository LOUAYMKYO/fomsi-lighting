
const express = require("express");
const router = express.Router();
const { getPool } = require("../config/db");

const {
  authenticateToken,
  requireAdmin
} = require("../middleware/auth");

// GET: Fetch all categories (public)
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.query(`
      SELECT
        "CategoryID",
        "Name",
        "Description",
        "CreatedAt"
      FROM "Categories"
      ORDER BY "Name" ASC;
    `);

    return res.json(result.rows);
  } catch (error) {
    console.error("Error fetching categories:", error.message);

    return res.status(500).json({
      message: "Failed to fetch categories."
    });
  }
});

// POST: Create a category (admin only)
router.post("/", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { Name, Description = null } = req.body;

    if (
      typeof Name !== "string" ||
      !Name.trim() ||
      Name.trim().length > 100
    ) {
      return res.status(400).json({
        message: "Name is required and must not exceed 100 characters."
      });
    }

    if (
      Description !== null &&
      (typeof Description !== "string" || Description.length > 500)
    ) {
      return res.status(400).json({
        message: "Description must be text or null, with a maximum of 500 characters."
      });
    }

    const pool = await getPool();

    const result = await pool.query(
      `
        INSERT INTO "Categories" ("Name", "Description")
        VALUES ($1, $2)
        RETURNING
          "CategoryID",
          "Name",
          "Description",
          "CreatedAt";
      `,
      [Name.trim(), Description]
    );

    return res.status(201).json({
      message: "Category created successfully.",
      category: result.rows[0]
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        message: "A category with this name already exists."
      });
    }

    console.error("Error creating category:", error.message);

    return res.status(500).json({
      message: "Failed to create category."
    });
  }
});

// PUT: Update a category (admin only)
router.put("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const categoryID = Number(req.params.id);
    const { Name, Description = null } = req.body;

    if (!Number.isInteger(categoryID) || categoryID <= 0) {
      return res.status(400).json({
        message: "Invalid category ID."
      });
    }

    if (
      typeof Name !== "string" ||
      !Name.trim() ||
      Name.trim().length > 100
    ) {
      return res.status(400).json({
        message: "Name is required and must not exceed 100 characters."
      });
    }

    if (
      Description !== null &&
      (typeof Description !== "string" || Description.length > 500)
    ) {
      return res.status(400).json({
        message: "Description must be text or null, with a maximum of 500 characters."
      });
    }

    const pool = await getPool();

    const result = await pool.query(
      `
        UPDATE "Categories"
        SET
          "Name" = $1,
          "Description" = $2
        WHERE "CategoryID" = $3
        RETURNING
          "CategoryID",
          "Name",
          "Description",
          "CreatedAt";
      `,
      [Name.trim(), Description, categoryID]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Category not found."
      });
    }

    return res.json({
      message: "Category updated successfully.",
      category: result.rows[0]
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        message: "A category with this name already exists."
      });
    }

    console.error("Error updating category:", error.message);

    return res.status(500).json({
      message: "Failed to update category."
    });
  }
});

// DELETE: Delete a category only if no products use it (admin only)
router.delete("/:id", authenticateToken, requireAdmin, async (req, res) => {
  const pool = await getPool();
  const client = await pool.connect();

  try {
    const categoryID = Number(req.params.id);

    if (!Number.isInteger(categoryID) || categoryID <= 0) {
      return res.status(400).json({
        message: "Invalid category ID."
      });
    }

    await client.query("BEGIN");

    const categoryResult = await client.query(
      `
        SELECT "CategoryID"
        FROM "Categories"
        WHERE "CategoryID" = $1
        FOR UPDATE;
      `,
      [categoryID]
    );

    if (categoryResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Category not found."
      });
    }

    const productsResult = await client.query(
      `
        SELECT "ProductID"
        FROM "Products"
        WHERE "CategoryID" = $1
        LIMIT 1;
      `,
      [categoryID]
    );

    if (productsResult.rows.length > 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        message: "Cannot delete this category because products are using it."
      });
    }

    await client.query(
      `
        DELETE FROM "Categories"
        WHERE "CategoryID" = $1;
      `,
      [categoryID]
    );

    await client.query("COMMIT");

    return res.json({
      message: "Category deleted successfully."
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Transaction rollback error:", rollbackError.message);
    }

    console.error("Error deleting category:", error.message);

    return res.status(500).json({
      message: "Failed to delete category."
    });
  } finally {
    client.release();
  }
});

module.exports = router;
