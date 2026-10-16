
const jwt = require("jsonwebtoken");
const { getPool, sql } = require("../config/db");

async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Authentication token required."
    });
  }

  if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET is missing.");
    return res.status(500).json({
      message: "Server configuration error."
    });
  }

  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const pool = await getPool();

    const result = await pool
      .request()
      .input("UserID", sql.Int, decoded.userId)
      .query(`
        SELECT UserID, FullName, Email, Role
        FROM dbo.Users
        WHERE UserID = @UserID
          AND IsActive = 1
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({
        message: "User account is inactive or no longer exists."
      });
    }

    const user = result.recordset[0];

    req.user = {
      userId: user.UserID,
      fullName: user.FullName,
      email: user.Email,
      role: user.Role
    };

    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" ||
        error.name === "TokenExpiredError" ||
        error.name === "NotBeforeError") {
      return res.status(401).json({
        message: "Invalid or expired token."
      });
    }

    console.error("Authentication error:", error);

    return res.status(500).json({
      message: "Authentication service unavailable."
    });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      message: "Administrator access required."
    });
  }

  next();
}

module.exports = {
  authenticateToken,
  requireAdmin
};
