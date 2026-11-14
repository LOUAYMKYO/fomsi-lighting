
const express = require("express");
const router = express.Router();

const { getPool } = require("../config/db");

const {
  authenticateToken,
  requireAdmin
} = require("../middleware/auth");

const cloudinary = require("cloudinary").v2;
const multer = require("multer");

// =========================================================
// CLOUDINARY CONFIGURATION
// =========================================================

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const CLOUDINARY_FOLDER = "fomsi-lighting/products";

// =========================================================
// CLOUDINARY IMAGE HELPERS
// =========================================================

// Extract the Cloudinary public ID only from our product folder.
// This prevents accidentally deleting external images.

function getProductImagePublicId(imageURL) {
  try {
    if (typeof imageURL !== "string" || !imageURL.trim()) {
      return null;
    }

    const parsedURL = new URL(imageURL);

    if (parsedURL.hostname !== "res.cloudinary.com") {
      return null;
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

    if (!cloudName) {
      return null;
    }

    const uploadPath = `/${cloudName}/image/upload/`;
    const uploadIndex = parsedURL.pathname.indexOf(uploadPath);

    if (uploadIndex === -1) {
      return null;
    }

    let parts = parsedURL.pathname
      .substring(uploadIndex + uploadPath.length)
      .split("/")
      .filter(Boolean);

    // Cloudinary URLs normally contain a version such as v123456.
    const versionIndex = parts.findIndex(part => /^v\d+$/.test(part));

    if (versionIndex === -1) {
      return null;
    }

    parts = parts.slice(versionIndex + 1);

    if (parts.length === 0) {
      return null;
    }

    let publicId = decodeURIComponent(parts.join("/"));

    // Remove the file extension.
    publicId = publicId.replace(/\.[^/.]+$/, "");

    if (!publicId.startsWith(`${CLOUDINARY_FOLDER}/`)) {
      return null;
    }

    return publicId;

  } catch (error) {
    console.error("Could not extract Cloudinary public ID:", error.message);
    return null;
  }
}

// Delete an image from Cloudinary safely.

async function deleteProductImage(imageURL) {
  const publicId = getProductImagePublicId(imageURL);

  if (!publicId) {
    return;
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
      invalidate: true
    });

    if (result.result === "ok" || result.result === "not found") {
      console.log(`Cloudinary image deletion: ${result.result} (${publicId})`);
    } else {
      console.error("Cloudinary image deletion returned:", result);
    }

  } catch (error) {
    console.error("Cloudinary image deletion failed:", error.message);
  }
}

// =========================================================
// IMAGE UPLOAD CONFIGURATION
// =========================================================

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, callback) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/avif"
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return callback(
        new Error("Only JPG, PNG, WEBP, GIF and AVIF images are allowed.")
      );
    }

    callback(null, true);
  }
});

// =========================================================
// POST: UPLOAD PRODUCT IMAGE (ADMIN ONLY)
// =========================================================

router.post(
  "/upload",
  authenticateToken,
  requireAdmin,
  (req, res, next) => {
    upload.single("image")(req, res, error => {
      if (error) {
        return res.status(400).json({
          message: error.message
        });
      }

      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          message: "Please select an image."
        });
      }

      if (
        !process.env.CLOUDINARY_CLOUD_NAME ||
        !process.env.CLOUDINARY_API_KEY ||
        !process.env.CLOUDINARY_API_SECRET
      ) {
        return res.status(500).json({
          message: "Image upload service is not configured."
        });
      }

      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: CLOUDINARY_FOLDER,
            resource_type: "image"
          },
          (error, uploadedImage) => {
            if (error) {
              return reject(error);
            }

            resolve(uploadedImage);
          }
        );

        stream.end(req.file.buffer);
      });

      return res.status(201).json({
        message: "Image uploaded successfully.",
        imageURL: result.secure_url
      });

    } catch (error) {
      console.error("Cloudinary upload error:", error.message);

      return res.status(500).json({
        message: "Failed to upload image."
      });
    }
  }
);

// =========================================================
// GET: RETRIEVE ALL ACTIVE PRODUCTS
// =========================================================

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
    console.error("Error fetching products:", {
      message: error.message,
      code: error.code,
      detail: error.detail,
      table: error.table,
      column: error.column
    });

    return res.status(500).json({
      message: "Failed to fetch products."
    });
  }
});

// =========================================================
// POST: CREATE A NEW PRODUCT (ADMIN ONLY)
// =========================================================

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

// =========================================================
// PUT: UPDATE PRODUCT AND REPLACE OLD IMAGE
// =========================================================

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

    // First, retrieve the existing image URL.
    const oldProduct = await pool.query(
      `
        SELECT "ImageURL"
        FROM "Products"
        WHERE "ProductID" = $1
          AND "IsActive" = TRUE;
      `,
      [productId]
    );

    if (oldProduct.rows.length === 0) {
      return res.status(404).json({
        message: "Active product not found."
      });
    }

    const oldImageURL = oldProduct.rows[0].ImageURL;

    // Update the product in PostgreSQL.
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

    const newImageURL = result.rows[0].ImageURL;

    // Delete the old image only if a different image was saved.
    if (oldImageURL && oldImageURL !== newImageURL) {
      await deleteProductImage(oldImageURL);
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

// =========================================================
// DELETE: SOFT-DELETE PRODUCT AND DELETE ITS CLOUDINARY IMAGE
// =========================================================

router.delete("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const productId = Number(req.params.id);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({
        message: "Invalid product ID."
      });
    }

    const pool = await getPool();

    // Retrieve the product image before deactivating the product.
    const oldProduct = await pool.query(
      `
        SELECT "ImageURL"
        FROM "Products"
        WHERE "ProductID" = $1
          AND "IsActive" = TRUE;
      `,
      [productId]
    );

    if (oldProduct.rows.length === 0) {
      return res.status(404).json({
        message: "Active product not found."
      });
    }

    const oldImageURL = oldProduct.rows[0].ImageURL;

    // Keep the existing soft-delete behavior.
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

    // Delete the associated Cloudinary image.
    if (oldImageURL) {
      await deleteProductImage(oldImageURL);
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
