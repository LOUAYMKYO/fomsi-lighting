
const express = require("express");
const { getPool, sql } = require("../config/db");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// All address routes require login
router.use(authenticateToken);

// GET /api/addresses
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool
      .request()
      .input("UserID", sql.Int, req.user.userId)
      .query(`
        SELECT AddressID, UserID, AddressLine, City, Wilaya,
               PostalCode, Phone, IsDefault, CreatedAt
        FROM dbo.Addresses
        WHERE UserID = @UserID
        ORDER BY IsDefault DESC, CreatedAt DESC
      `);

    res.json(result.recordset);
  } catch (error) {
    console.error("Get addresses error:", error);
    res.status(500).json({
      message: "Unable to retrieve addresses."
    });
  }
});

// POST /api/addresses
router.post("/", async (req, res) => {
  try {
    const {
      addressLine,
      city,
      wilaya,
      postalCode,
      phone,
      isDefault
    } = req.body;

    if (
      typeof addressLine !== "string" ||
      typeof city !== "string" ||
      typeof wilaya !== "string" ||
      typeof phone !== "string" ||
      !addressLine.trim() ||
      !city.trim() ||
      !wilaya.trim() ||
      !phone.trim()
    ) {
      return res.status(400).json({
        message: "Address, city, wilaya, and phone are required."
      });
    }

    if (
      addressLine.trim().length > 250 ||
      city.trim().length > 100 ||
      wilaya.trim().length > 100 ||
      phone.trim().length > 30 ||
      (postalCode != null &&
        (typeof postalCode !== "string" || postalCode.length > 20)) ||
      (isDefault !== undefined && typeof isDefault !== "boolean")
    ) {
      return res.status(400).json({
        message: "One or more fields have invalid values."
      });
    }

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    await transaction.begin();

    try {
      const request = new sql.Request(transaction);

      if (isDefault === true) {
        await request
          .input("UserID", sql.Int, req.user.userId)
          .query(`
            UPDATE dbo.Addresses
            SET IsDefault = 0
            WHERE UserID = @UserID
          `);
      }

      const result = await new sql.Request(transaction)
        .input("UserID", sql.Int, req.user.userId)
        .input("AddressLine", sql.NVarChar(250), addressLine.trim())
        .input("City", sql.NVarChar(100), city.trim())
        .input("Wilaya", sql.NVarChar(100), wilaya.trim())
        .input("PostalCode", sql.NVarChar(20), postalCode?.trim() || null)
        .input("Phone", sql.NVarChar(30), phone.trim())
        .input("IsDefault", sql.Bit, isDefault === true)
        .query(`
          INSERT INTO dbo.Addresses
            (UserID, AddressLine, City, Wilaya, PostalCode, Phone, IsDefault)
          OUTPUT INSERTED.*
          VALUES
            (@UserID, @AddressLine, @City, @Wilaya, @PostalCode, @Phone, @IsDefault)
        `);

      await transaction.commit();

      res.status(201).json({
        message: "Address created successfully.",
        address: result.recordset[0]
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Create address error:", error);
    res.status(500).json({
      message: "Unable to create address."
    });
  }
});

// PUT /api/addresses/:id
router.put("/:id", async (req, res) => {
  try {
    const addressID = Number(req.params.id);

    if (!Number.isInteger(addressID) || addressID <= 0) {
      return res.status(400).json({
        message: "Invalid address ID."
      });
    }

    const {
      addressLine,
      city,
      wilaya,
      postalCode,
      phone,
      isDefault
    } = req.body;

    if (
      typeof addressLine !== "string" ||
      typeof city !== "string" ||
      typeof wilaya !== "string" ||
      typeof phone !== "string" ||
      !addressLine.trim() ||
      !city.trim() ||
      !wilaya.trim() ||
      !phone.trim() ||
      addressLine.trim().length > 250 ||
      city.trim().length > 100 ||
      wilaya.trim().length > 100 ||
      phone.trim().length > 30 ||
      (postalCode != null &&
        (typeof postalCode !== "string" || postalCode.length > 20)) ||
      (isDefault !== undefined && typeof isDefault !== "boolean")
    ) {
      return res.status(400).json({
        message: "Provide valid address details."
      });
    }

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    await transaction.begin();

    try {
      if (isDefault === true) {
        await new sql.Request(transaction)
          .input("UserID", sql.Int, req.user.userId)
          .query(`
            UPDATE dbo.Addresses
            SET IsDefault = 0
            WHERE UserID = @UserID
          `);
      }

      const result = await new sql.Request(transaction)
        .input("AddressID", sql.Int, addressID)
        .input("UserID", sql.Int, req.user.userId)
        .input("AddressLine", sql.NVarChar(250), addressLine.trim())
        .input("City", sql.NVarChar(100), city.trim())
        .input("Wilaya", sql.NVarChar(100), wilaya.trim())
        .input("PostalCode", sql.NVarChar(20), postalCode?.trim() || null)
        .input("Phone", sql.NVarChar(30), phone.trim())
        .input("IsDefault", sql.Bit, isDefault === true)
        .query(`
          UPDATE dbo.Addresses
          SET AddressLine = @AddressLine,
              City = @City,
              Wilaya = @Wilaya,
              PostalCode = @PostalCode,
              Phone = @Phone,
              IsDefault = @IsDefault
          OUTPUT INSERTED.*
          WHERE AddressID = @AddressID
            AND UserID = @UserID
        `);

      if (result.recordset.length === 0) {
        await transaction.rollback();
        return res.status(404).json({
          message: "Address not found."
        });
      }

      await transaction.commit();

      res.json({
        message: "Address updated successfully.",
        address: result.recordset[0]
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Update address error:", error);
    res.status(500).json({
      message: "Unable to update address."
    });
  }
});

// DELETE /api/addresses/:id
router.delete("/:id", async (req, res) => {
  try {
    const addressID = Number(req.params.id);

    if (!Number.isInteger(addressID) || addressID <= 0) {
      return res.status(400).json({
        message: "Invalid address ID."
      });
    }

    const pool = await getPool();

    const result = await pool
      .request()
      .input("AddressID", sql.Int, addressID)
      .input("UserID", sql.Int, req.user.userId)
      .query(`
        DELETE FROM dbo.Addresses
        OUTPUT DELETED.AddressID
        WHERE AddressID = @AddressID
          AND UserID = @UserID
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        message: "Address not found."
      });
    }

    res.json({
      message: "Address deleted successfully."
    });
  } catch (error) {
    console.error("Delete address error:", error);
    res.status(500).json({
      message: "Unable to delete address."
    });
  }
});

module.exports = router;
