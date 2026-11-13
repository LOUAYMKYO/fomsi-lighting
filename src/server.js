
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const { authenticateToken } = require("./middleware/auth");

const productsRouter = require("./routes/products");
const categoriesRouter = require("./routes/categories");
const authRouter = require("./routes/auth");
const addressesRouter = require("./routes/addresses");
const cartRouter = require("./routes/cart");
const ordersRouter = require("./routes/orders");
const adminOrdersRouter = require("./routes/adminOrders");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// API routes
app.use("/api/auth", authRouter);
app.use("/api/products", productsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/addresses", addressesRouter);
app.use("/api/cart", cartRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/admin/orders", adminOrdersRouter);

// Authentication test
app.get("/api/auth/me", authenticateToken, (req, res) => {
  res.json({
    message: "Authentication successful!",
    user: req.user
  });
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    message: "FOMSI Lighting backend is running!"
  });
});

// Serve frontend files from the backend folder
app.use(express.static(path.join(__dirname, "..")));

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`FOMSI Lighting server running on port ${PORT}`);
});
