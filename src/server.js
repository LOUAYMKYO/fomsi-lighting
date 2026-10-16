
require("dotenv").config();

const { authenticateToken } = require("./middleware/auth");

const express = require("express");
const cors = require("cors");

const productsRouter = require("./routes/products");
const categoriesRouter = require("./routes/categories");
const authRouter = require("./routes/auth");
const addressesRouter = require("./routes/addresses");
const cartRouter = require("./routes/cart");
const ordersRouter = require("./routes/orders");
const adminOrdersRouter = require("./routes/adminOrders");
const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "FOMSI Lighting backend is running!"
  });
});

app.use("/api/auth", authRouter);
app.use("/api/products", productsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/addresses", addressesRouter);
app.use("/api/cart", cartRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/admin/orders", adminOrdersRouter);
const PORT = process.env.PORT || 3000;

app.get("/api/auth/me", authenticateToken, (req, res) => {
  res.json({
    message: "Authentication successful!",
    user: req.user
  });
});
app.listen(PORT, () => {
  console.log(`FOMSI Lighting backend running on port ${PORT}`);
});
