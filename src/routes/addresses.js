
const express = require("express");
const { getPool } = require("../config/db");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// All address routes require login
router.use(authenticateToken);

// GET /api/addresses
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.query(
      `
        SELECT
          "AddressID",
          "UserID",
          "AddressLine",
          "City",
          "Wilaya",
          "PostalCode",
          "Phone",
          "IsDefault",
          "CreatedAt"
        FROM "Addresses"
        WHERE "UserID" = $1
        ORDER BY "IsDefault" DESC, "CreatedAt" DESC;
      `,
      [req.user.userId]
    );

    return res.json(result.rows);

  } catch (error) {
    console.error("Get addresses error:", error.message);

    return res.status(500).json({
      message: "Unable to retrieve addresses."
    });
  }
});

// POST /api/addresses
router.post("/", async (req, res) => {
  const pool = await getPool();
  const client = await pool.connect();

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

    await client.query("BEGIN");

    // If this address is default, remove default from other addresses
    if (isDefault === true) {
      await client.query(
        `
          UPDATE "Addresses"
          SET "IsDefault" = FALSE
          WHERE "UserID" = $1;
        `,
        [req.user.userId]
      );
    }

    const result = await client.query(
      `
        INSERT INTO "Addresses" (
          "UserID",
          "AddressLine",
          "City",
          "Wilaya",
          "PostalCode",
          "Phone",
          "IsDefault"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *;
      `,
      [
        req.user.userId,
        addressLine.trim(),
        city.trim(),
        wilaya.trim(),
        postalCode?.trim() || null,
        phone.trim(),
        isDefault === true
      ]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Address created successfully.",
      address: result.rows[0]
    });

  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Create address error:", error.message);

    return res.status(500).json({
      message: "Unable to create address."
    });

  } finally {
    client.release();
  }
});

// PUT /api/addresses/:id
router.put("/:id", async (req, res) => {
  const pool = await getPool();
  const client = await pool.connect();

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

    await client.query("BEGIN");

    if (isDefault === true) {
      await client.query(
        `
          UPDATE "Addresses"
          SET "IsDefault" = FALSE
          WHERE "UserID" = $1;
        `,
        [req.user.userId]
      );
    }

    const result = await client.query(
      `
        UPDATE "Addresses"
        SET
          "AddressLine" = $1,
          "City" = $2,
          "Wilaya" = $3,
          "PostalCode" = $4,
          "Phone" = $5,
          "IsDefault" = $6
        WHERE "AddressID" = $7
          AND "UserID" = $8
        RETURNING *;
      `,
      [
        addressLine.trim(),
        city.trim(),
        wilaya.trim(),
        postalCode?.trim() || null,
        phone.trim(),
        isDefault === true,
        addressID,
        req.user.userId
      ]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Address not found."
      });
    }

    await client.query("COMMIT");

    return res.json({
      message: "Address updated successfully.",
      address: result.rows[0]
    });

  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Update address error:", error.message);

    return res.status(500).json({
      message: "Unable to update address."
    });

  } finally {
    client.release();
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

    const result = await pool.query(
      `
        DELETE FROM "Addresses"
        WHERE "AddressID" = $1
          AND "UserID" = $2
        RETURNING "AddressID";
      `,
      [addressID, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Address not found."
      });
    }

    return res.json({
      message: "Address deleted successfully."
    });

  } catch (error) {
    console.error("Delete address error:", error.message);

    return res.status(500).json({
      message: "Unable to delete address."
    });
  }
});

module.exports = router;
