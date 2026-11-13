
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getPool } = require("../config/db");

const router = express.Router();

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { fullName, email, password } = req.body;

    // Validate input
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

    // Hash password before saving
    const passwordHash = await bcrypt.hash(password, 12);

    // Public registration always creates a customer
    const result = await pool.query(
      `
        INSERT INTO "Users" (
          "FullName",
          "Email",
          "PasswordHash",
          "Role"
        )
        VALUES ($1, $2, $3, 'customer')
        RETURNING
          "UserID",
          "FullName",
          "Email",
          "Role";
      `,
      [
        cleanName,
        cleanEmail,
        passwordHash
      ]
    );

    const user = result.rows[0];

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
    // PostgreSQL unique violation (duplicate email)
    if (error.code === "23505") {
      return res.status(409).json({
        message: "An account with this email already exists."
      });
    }

    console.error("Registration error:", error.message);

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

    const result = await pool.query(
      `
        SELECT
          "UserID",
          "FullName",
          "Email",
          "PasswordHash",
          "Role"
        FROM "Users"
        WHERE "Email" = $1
          AND "IsActive" = TRUE;
      `,
      [cleanEmail]
    );

    const user = result.rows[0];

    // Same message for unknown email or incorrect password
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
    console.error("Login error:", error.message);

    return res.status(500).json({
      message: "Unable to log in at this time."
    });
  }
});

module.exports = router;
