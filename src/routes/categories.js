
const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../config/db");

// GET: Fetch all categories
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT CategoryID, Name, Description, CreatedAt
      FROM dbo.Categories
      ORDER BY Name ASC;
    `);

    res.json(result.recordset);
  } catch (error) {
    console.error("Error fetching categories:", error.message);
    res.status(500).json({
      message: "Failed to fetch categories."
    });
  }
});

// POST: Create a category
router.post("/", async (req, res) => {
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

    const result = await pool.request()
      .input("Name", sql.NVarChar(100), Name.trim())
      .input("Description", sql.NVarChar(500), Description)
      .query(`
        INSERT INTO dbo.Categories (Name, Description)
        OUTPUT
          INSERTED.CategoryID,
          INSERTED.Name,
          INSERTED.Description,
          INSERTED.CreatedAt
        VALUES (@Name, @Description);
      `);

    res.status(201).json({
      message: "Category created successfully.",
      category: result.recordset[0]
    });
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) {
      return res.status(409).json({
        message: "A category with this name already exists."
      });
    }

    console.error("Error creating category:", error.message);
    res.status(500).json({
      message: "Failed to create category."
    });
  }
});

// PUT: Update a category
router.put("/:id", async (req, res) => {
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

    const result = await pool.request()
      .input("CategoryID", sql.Int, categoryID)
      .input("Name", sql.NVarChar(100), Name.trim())
      .input("Description", sql.NVarChar(500), Description)
      .query(`
        UPDATE dbo.Categories
        SET Name = @Name,
            Description = @Description
        WHERE CategoryID = @CategoryID;

        SELECT
          CategoryID,
          Name,
          Description,
          CreatedAt
        FROM dbo.Categories
        WHERE CategoryID = @CategoryID;
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        message: "Category not found."
      });
    }

    res.json({
      message: "Category updated successfully.",
      category: result.recordset[0]
    });
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) {
      return res.status(409).json({
        message: "A category with this name already exists."
      });
    }

    console.error("Error updating category:", error.message);
    res.status(500).json({
      message: "Failed to update category."
    });
  }
});

// DELETE: Delete a category only if no products use it
router.delete("/:id", async (req, res) => {
  try {
    const categoryID = Number(req.params.id);

    if (!Number.isInteger(categoryID) || categoryID <= 0) {
      return res.status(400).json({
        message: "Invalid category ID."
      });
    }

    const pool = await getPool();

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const request = new sql.Request(transaction);

      const result = await request
        .input("CategoryID", sql.Int, categoryID)
        .query(`
          SELECT CategoryID
          FROM dbo.Categories WITH (UPDLOCK, HOLDLOCK)
          WHERE CategoryID = @CategoryID;

          SELECT TOP (1) ProductID
          FROM dbo.Products WITH (UPDLOCK, HOLDLOCK)
          WHERE CategoryID = @CategoryID;
        `);

      if (result.recordsets[0].length === 0) {
        await transaction.rollback();

        return res.status(404).json({
          message: "Category not found."
        });
      }

      if (result.recordsets[1].length > 0) {
        await transaction.rollback();

        return res.status(409).json({
          message: "Cannot delete this category because products are using it."
        });
      }

      await new sql.Request(transaction)
        .input("CategoryID", sql.Int, categoryID)
        .query(`
          DELETE FROM dbo.Categories
          WHERE CategoryID = @CategoryID;
        `);

      await transaction.commit();

      res.json({
        message: "Category deleted successfully."
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error deleting category:", error.message);
    res.status(500).json({
      message: "Failed to delete category."
    });
  }
});

module.exports = router;
