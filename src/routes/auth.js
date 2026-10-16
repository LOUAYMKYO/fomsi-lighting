
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getPool, sql } = require("../config/db");

const router = express.Router();

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { fullName, email, password } = req.body;

    // Validate the input
    if (
      typeof fullName !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        message: "Full name, email, and password are required."
      });
    }

    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName || cleanName.length > 150) {
      return res.status(400).json({
        message: "Full name must be between 1 and 150 characters."
      });
    }

    if (
      cleanEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
    ) {
      return res.status(400).json({
        message: "Please provide a valid email address."
      });
    }

    if (
      password.length < 8 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        message: "Password must be at least 8 characters and no more than 72 bytes."
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is missing from the environment.");
      return res.status(500).json({
        message: "Server configuration error."
      });
    }

    const pool = await getPool();

    // Check whether this email is already registered
    const existingUser = await pool
      .request()
      .input("Email", sql.NVarChar(254), cleanEmail)
      .query(`
        SELECT UserID
        FROM dbo.Users
        WHERE Email = @Email
      `);

    if (existingUser.recordset.length > 0) {
      return res.status(409).json({
        message: "An account with this email already exists."
      });
    }

    // Never store the plain-text password
    const passwordHash = await bcrypt.hash(password, 12);

    // Public registration always creates a customer
    const result = await pool
      .request()
      .input("FullName", sql.NVarChar(150), cleanName)
      .input("Email", sql.NVarChar(254), cleanEmail)
      .input("PasswordHash", sql.NVarChar(255), passwordHash)
      .query(`
        INSERT INTO dbo.Users (FullName, Email, PasswordHash, Role)
        OUTPUT
          INSERTED.UserID,
          INSERTED.FullName,
          INSERTED.Email,
          INSERTED.Role
        VALUES (@FullName, @Email, @PasswordHash, 'customer')
      `);

    const user = result.recordset[0];

    const token = jwt.sign(
      {
        userId: user.UserID,
        role: user.Role
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    return res.status(201).json({
      message: "Account created successfully.",
      token,
      user
    });
  } catch (error) {
    // Handle a duplicate email if two requests arrive simultaneously
    if (error.number === 2627 || error.number === 2601) {
      return res.status(409).json({
        message: "An account with this email already exists."
      });
    }

    console.error("Registration error:", error);

    return res.status(500).json({
      message: "Unable to register at this time."
    });
  }
});


// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        message: "Email and password are required."
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is missing from the environment.");
      return res.status(500).json({
        message: "Server configuration error."
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const pool = await getPool();

    const result = await pool
      .request()
      .input("Email", sql.NVarChar(254), cleanEmail)
      .query(`
        SELECT UserID, FullName, Email, PasswordHash, Role
        FROM dbo.Users
        WHERE Email = @Email
          AND IsActive = 1
      `);

    const user = result.recordset[0];

    // Use the same message for an unknown email or incorrect password
    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password."
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.PasswordHash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid email or password."
      });
    }

    const token = jwt.sign(
      {
        userId: user.UserID,
        role: user.Role
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    return res.status(200).json({
      message: "Login successful.",
      token,
      user: {
        UserID: user.UserID,
        FullName: user.FullName,
        Email: user.Email,
        Role: user.Role
      }
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      message: "Unable to log in at this time."
    });
  }
});

module.exports = router;
