document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    // =========================================================
    // CONFIGURATION
    // =========================================================
    const API = "/api";
    const WHATSAPP = "213773864031";
    const TOKEN_KEY = "fomsiToken";

    let products = [];
    let categories = [];
    let currentFilter = "all";
    let isAdmin = false;

    // Current product image URL (used when editing without a new image)
    let currentProductImageURL = null;
    let previewObjectURL = null;

    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => [...document.querySelectorAll(selector)];

    // =========================================================
    // HTML ELEMENTS
    // =========================================================
    const accountPanel = $("#accountPanel");
    const accountBtn = $("#accountBtn");
    const accountTitle = $("#accountTitle");
    const accountDescription = $("#accountDescription");
    const loginForm = $("#loginForm");
    const loginEmail = $("#loginEmail");
    const loginPassword = $("#loginPassword");
    const accountMessage = $("#accountMessage");
    const adminDashboard = $("#adminDashboard");
    const logoutBtn = $("#logoutBtn");

    const productsGrid = $("#productsGrid");
    const productsMessage = $("#productsMessage");

    const productForm = $("#productForm");
    const productIdInput = $("#productId");
    const productNameInput = $("#productName");
    const productCategoryInput = $("#productCategory");
    const productDescriptionInput = $("#productDescription");
    const productPriceInput = $("#productPrice");
    const productStockInput = $("#productStock");
    const productImageInput = $("#productImage");
    const saveProductBtn = $("#saveProductBtn");
    const cancelProductEditBtn = $("#cancelProductEdit");
    const adminProductList = $("#adminProductList");

    // Image preview elements
    const productImageUpload = $("#productImageUpload");
    const productImagePreview = $("#productImagePreview");
    const productPreviewImg = $("#productPreviewImg");
    const productImageStatus = $("#productImageStatus");

    // The image replacement control is only available while editing a product.
    if (productImageUpload) {
        productImageUpload.hidden = true;
    }

    const categoryForm = $("#categoryForm");
    const categoryIdInput = $("#categoryId");
    const categoryNameInput = $("#categoryName");
    const categoryDescriptionInput = $("#categoryDescription");
    const saveCategoryBtn = $("#saveCategoryBtn");
    const cancelCategoryEditBtn = $("#cancelCategoryEdit");
    const adminCategoryList = $("#adminCategoryList");

    // =========================================================
    // GENERAL HELPERS
    // =========================================================
    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);
    }

    function getToken() {
        return sessionStorage.getItem(TOKEN_KEY);
    }

    function saveToken(token) {
        sessionStorage.setItem(TOKEN_KEY, token);
    }

    function clearToken() {
        sessionStorage.removeItem(TOKEN_KEY);
        isAdmin = false;
    }

    function showMessage(element, message, type = "info") {
        if (!element) return;

        element.textContent = message;
        element.dataset.type = type;
    }

    function formatPrice(price) {
        const number = Number(price);

        if (!Number.isFinite(number)) {
            return "Prix sur demande";
        }

        return `${number.toLocaleString("fr-FR")} DA`;
    }

    function getField(object, ...names) {
        for (const name of names) {
            if (object && object[name] !== undefined && object[name] !== null) {
                return object[name];
            }
        }

        return "";
    }

    function safeImageURL(value) {
        if (!value) return "";

        try {
            const url = new URL(value);

            if (url.protocol === "https:" || url.protocol === "http:") {
                return url.href;
            }
        } catch {
            return "";
        }

        return "";
    }

    function getCategoryName(product) {
        const categoryId = Number(
            getField(product, "CategoryID", "categoryId")
        );

        const category = categories.find(
            (item) => Number(getField(item, "CategoryID", "categoryId")) === categoryId
        );

        return category
            ? getField(category, "Name", "name")
            : "Luminaire";
    }

    // Connect database categories to the storefront's existing filters.
    function getFilterForCategory(categoryName) {
        const name = String(categoryName || "").toLowerCase();

        if (/lustre|chandelier/.test(name)) return "lustre";
        if (/spot|wall|applique|led/.test(name)) return "spot";
        if (/decor|déco|ornement/.test(name)) return "decor";
        if (/suspension|ceiling|plafond/.test(name)) return "suspension";

        return "suspension";
    }

    function getProductFilter(product) {
        return getFilterForCategory(getCategoryName(product));
    }

    function isValidAdminToken(token) {
        if (!token) return false;

        try {
            const parts = token.split(".");
            if (parts.length !== 3) return false;

            const base64 = parts[1]
                .replace(/-/g, "+")
                .replace(/_/g, "/");

            const payload = JSON.parse(
                decodeURIComponent(
                    atob(base64)
                        .split("")
                        .map((character) =>
                            "%" + character.charCodeAt(0).toString(16).padStart(2, "0")
                        )
                        .join("")
                )
            );

            const role = String(payload.role || "").toLowerCase();
            const notExpired = !payload.exp || payload.exp * 1000 > Date.now();

            return role === "admin" && notExpired;
        } catch {
            return false;
        }
    }

    // =========================================================
    // API REQUESTS
    // =========================================================
    async function apiRequest(path, options = {}) {
        const headers = {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {})
        };

        const token = getToken();

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        let response;

        try {
            response = await fetch(`${API}${path}`, {
                ...options,
                headers
            });
        } catch {
            throw new Error(
                "Impossible de contacter le serveur. Vérifiez que le backend tourne sur le port 3000."
            );
        }

        const contentType = response.headers.get("content-type") || "";
        let result = {};

        if (contentType.includes("application/json")) {
            result = await response.json();
        } else {
            const text = await response.text();
            result = text ? { message: text } : {};
        }

        if (!response.ok) {
            if (response.status === 401 && getToken()) {
                clearToken();
                updateAccountView();

                showMessage(
                    accountMessage,
                    "Votre session a expiré. Connectez-vous à nouveau.",
                    "error"
                );
            }

            throw new Error(
                result.message ||
                result.error ||
                `Erreur serveur (${response.status}).`
            );
        }

        return result;
    }

    // =========================================================
    // CLOUDINARY IMAGE UPLOAD
    // =========================================================
    async function uploadProductImage(file) {
        if (!file) {
            throw new Error("Veuillez sélectionner une image.");
        }

        const formData = new FormData();
        formData.append("image", file);

        const token = getToken();

        if (!token) {
            throw new Error("Votre session a expiré. Connectez-vous à nouveau.");
        }

        let response;

        try {
            response = await fetch(`${API}/products/upload`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`
                },
                body: formData
            });
        } catch {
            throw new Error("Impossible de contacter le serveur pour envoyer l'image.");
        }

        const contentType = response.headers.get("content-type") || "";
        let result = {};

        if (contentType.includes("application/json")) {
            result = await response.json();
        } else {
            const text = await response.text();
            result = text ? { message: text } : {};
        }

        if (!response.ok) {
            throw new Error(
                result.message ||
                result.error ||
                `Échec de l'envoi de l'image (${response.status}).`
            );
        }

        const imageURL = safeImageURL(
            getField(result, "imageUrl", "imageURL")
        );

        if (!imageURL) {
            throw new Error("Le serveur n'a pas retourné une URL d'image valide.");
        }

        return imageURL;
    }

    // =========================================================
    // PRODUCT IMAGE PREVIEW
    // =========================================================
    function clearProductImagePreview() {
        if (previewObjectURL) {
            URL.revokeObjectURL(previewObjectURL);
            previewObjectURL = null;
        }

        if (productPreviewImg) {
            productPreviewImg.src = "";
        }

        if (productImagePreview) {
            productImagePreview.hidden = true;
        }

        if (productImageStatus) {
            productImageStatus.textContent = "";
        }
    }

    function showProductImagePreview(imageURL, message = "") {
        if (!productImagePreview || !productPreviewImg) return;

        productPreviewImg.src = imageURL;
        productImagePreview.hidden = false;

        if (productImageStatus) {
            productImageStatus.textContent = message;
        }
    }

    if (productImageInput) {
        productImageInput.addEventListener("change", () => {
            const file = productImageInput.files?.[0];

            if (!file) return;

            const allowedTypes = [
                "image/jpeg",
                "image/png",
                "image/webp",
                "image/gif",
                "image/avif"
            ];

            if (!allowedTypes.includes(file.type)) {
                productImageInput.value = "";

                showMessage(
                    accountMessage,
                    "Format invalide. Utilisez JPG, PNG, WEBP, GIF ou AVIF.",
                    "error"
                );

                return;
            }

            if (file.size > 5 * 1024 * 1024) {
                productImageInput.value = "";

                showMessage(
                    accountMessage,
                    "L'image ne doit pas dépasser 5 MB.",
                    "error"
                );

                return;
            }

            if (previewObjectURL) {
                URL.revokeObjectURL(previewObjectURL);
            }

            previewObjectURL = URL.createObjectURL(file);

            showProductImagePreview(
                previewObjectURL,
                "Nouvelle image sélectionnée. Elle sera envoyée lors de l'enregistrement."
            );

            showMessage(
                accountMessage,
                "Image sélectionnée avec succès. Vous pouvez enregistrer le produit.",
                "success"
            );
        });
    }

    // =========================================================
    // MOBILE MENU
    // =========================================================
    const menuBtn = $("#menuBtn");
    const navLinks = $("#navLinks");

    if (menuBtn && navLinks) {
        menuBtn.addEventListener("click", () => {
            const isOpen = navLinks.classList.toggle("active");

            menuBtn.setAttribute("aria-expanded", String(isOpen));
            menuBtn.setAttribute(
                "aria-label",
                isOpen ? "Fermer le menu" : "Ouvrir le menu"
            );
        });

        $$("#navLinks a").forEach((link) => {
            link.addEventListener("click", () => {
                navLinks.classList.remove("active");
                menuBtn.setAttribute("aria-expanded", "false");
                menuBtn.setAttribute("aria-label", "Ouvrir le menu");
            });
        });
    }

    // =========================================================
    // ACCOUNT PANEL
    // =========================================================
    function openAccountPanel() {
        if (!accountPanel) return;

        accountPanel.hidden = false;
        document.body.classList.add("panel-open");

        if (isAdmin) {
            loadAdminData().catch((error) => {
                showMessage(accountMessage, error.message, "error");
            });
        }

        const firstInput = isAdmin ? null : loginEmail;

        if (firstInput) {
            setTimeout(() => firstInput.focus(), 50);
        }
    }

    function closeAccountPanel() {
        if (!accountPanel) return;

        accountPanel.hidden = true;
        document.body.classList.remove("panel-open");
    }

    if (accountBtn) {
        accountBtn.addEventListener("click", openAccountPanel);
    }

    $$("[data-close-panel]").forEach((button) => {
        button.addEventListener("click", closeAccountPanel);
    });

    if (accountPanel) {
        accountPanel.addEventListener("click", (event) => {
            if (event.target === accountPanel) {
                closeAccountPanel();
            }
        });
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && accountPanel && !accountPanel.hidden) {
            closeAccountPanel();
        }
    });

    function updateAccountView() {
        const token = getToken();

        isAdmin = isValidAdminToken(token);

        if (accountBtn) {
            accountBtn.textContent = isAdmin ? "Tableau de bord" : "Espace admin";
        }

        if (loginForm) {
            loginForm.hidden = isAdmin;
        }

        if (adminDashboard) {
            adminDashboard.hidden = !isAdmin;
        }

        if (logoutBtn) {
            logoutBtn.hidden = !isAdmin;
        }

        if (accountTitle) {
            accountTitle.textContent = isAdmin
                ? "Tableau de bord admin"
                : "Espace admin";
        }

        if (accountDescription) {
            accountDescription.textContent = isAdmin
                ? "Gérez les produits et les catégories de Fomsilighting."
                : "Connectez-vous avec votre compte administrateur.";
        }
    }

    // =========================================================
    // ADMIN LOGIN
    // =========================================================
    if (loginForm) {
        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();

            const submitButton = loginForm.querySelector(
                'button[type="submit"]'
            );

            if (submitButton) submitButton.disabled = true;

            showMessage(accountMessage, "Connexion en cours...", "info");

            try {
                const result = await apiRequest("/auth/login", {
                    method: "POST",
                    body: JSON.stringify({
                        email: loginEmail.value.trim(),
                        password: loginPassword.value
                    })
                });

                const token = result.token;
                const user = result.user || {};
                const role = String(
                    getField(user, "Role", "role")
                ).toLowerCase();

                if (!token) {
                    throw new Error("Le serveur n'a pas retourné de token.");
                }

                if (role !== "admin") {
                    clearToken();
                    updateAccountView();

                    throw new Error(
                        "Ce compte n'a pas les droits administrateur."
                    );
                }

                saveToken(token);
                updateAccountView();
                loginForm.reset();

                showMessage(
                    accountMessage,
                    "Connexion réussie. Bienvenue dans votre espace admin.",
                    "success"
                );

                await loadAdminData();
            } catch (error) {
                showMessage(accountMessage, error.message, "error");
            } finally {
                if (submitButton) submitButton.disabled = false;
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            clearToken();
            resetProductForm();
            resetCategoryForm();
            updateAccountView();

            showMessage(
                accountMessage,
                "Vous êtes déconnecté.",
                "success"
            );
        });
    }

    // =========================================================
    // ADMIN TABS
    // =========================================================
    $$("[data-admin-tab]").forEach((button) => {
        button.addEventListener("click", () => {
            const selectedTab = button.dataset.adminTab;

            $$("[data-admin-tab]").forEach((tab) => {
                const active = tab === button;

                tab.classList.toggle("active", active);
                tab.setAttribute("aria-selected", String(active));
            });

            const productsSection = $("#adminProducts");
            const categoriesSection = $("#adminCategories");

            if (productsSection) {
                productsSection.hidden = selectedTab !== "products";
            }

            if (categoriesSection) {
                categoriesSection.hidden = selectedTab !== "categories";
            }
        });
    });

    // =========================================================
    // PUBLIC PRODUCTS: LOAD AND DISPLAY
    // =========================================================
    async function loadProducts() {
        if (productsGrid) {
            productsGrid.setAttribute("aria-busy", "true");
        }

        try {
            const [productResult, categoryResult] = await Promise.all([
                apiRequest("/products"),
                apiRequest("/categories")
            ]);

            products = Array.isArray(productResult)
                ? productResult
                : productResult.products || [];

            categories = Array.isArray(categoryResult)
                ? categoryResult
                : categoryResult.categories || [];

            renderPublicProducts();
        } catch (error) {
            if (productsGrid && !productsGrid.querySelector(".product-card")) {
                productsGrid.innerHTML = `
                    <p class="products-loading">
                        ${escapeHTML(error.message)}
                    </p>
                `;
            }

            console.error("Erreur de chargement des produits :", error);
        } finally {
            if (productsGrid) {
                productsGrid.setAttribute("aria-busy", "false");
            }
        }
    }

    function renderPublicProducts() {
        if (!productsGrid) return;

        if (!products.length) {
            productsGrid.innerHTML = `
                <p class="products-loading">
                    Aucun produit disponible pour le moment.
                    Contactez-nous sur WhatsApp pour plus d'informations.
                </p>
            `;
            return;
        }

        const filteredProducts = products.filter((product) => {
            return currentFilter === "all" ||
                getProductFilter(product) === currentFilter;
        });

        if (!filteredProducts.length) {
            productsGrid.innerHTML = `
                <p class="products-loading">
                    Aucun produit dans cette collection pour le moment.
                </p>
            `;
            return;
        }

        productsGrid.innerHTML = filteredProducts.map((product) => {
            const name = getField(product, "Name", "name") || "Luminaire";
            const description = getField(product, "Description", "description");
            const price = Number(getField(product, "Price", "price"));
            const imageURL = safeImageURL(
                getField(product, "ImageURL", "imageURL", "imageUrl")
            );
            const categoryName = getCategoryName(product);

            const validPrice = Number.isFinite(price) && price >= 0;

            const message = encodeURIComponent(
                `Bonjour Fomsilighting 👋

Je souhaite commander :

Produit : ${name}
Prix unitaire : ${validPrice ? formatPrice(price) : "Prix sur demande"}
Quantité : 1
Total : ${validPrice ? formatPrice(price) : "Prix sur demande"}

Merci de me confirmer la disponibilité.`
            );

            const imageMarkup = imageURL
                ? `<img src="${escapeHTML(imageURL)}" alt="${escapeHTML(name)}" loading="lazy">`
                : `<div class="product-no-image">✦ FOMSILIGHTING</div>`;

            return `
                <article class="product-card" data-product-filter="${escapeHTML(
                    getProductFilter(product)
                )}">
                    <div class="product-image">
                        ${imageMarkup}
                    </div>

                    <div class="product-content">
                        <span class="product-category">
                            ${escapeHTML(categoryName)}
                        </span>

                        <h3>${escapeHTML(name)}</h3>

                        <p class="product-description">
                            ${escapeHTML(description || "Découvrez ce luminaire chez Fomsilighting.")}
                        </p>

                        <div class="product-bottom">
                            <strong class="product-price">
                                ${escapeHTML(formatPrice(price))}
                            </strong>
                        </div>

                        <div class="product-order">
                            <label class="product-quantity-label">
                                Quantité :
                                <input
                                    type="number"
                                    class="product-quantity"
                                    min="1"
                                    max="99"
                                    step="1"
                                    value="1"
                                    aria-label="Quantité de ${escapeHTML(name)}"
                                >
                            </label>

                            <a
                                class="btn btn-gold product-contact"
                                data-whatsapp-order
                                data-product-name="${escapeHTML(name)}"
                                data-product-price="${validPrice ? price : ""}"
                                href="https://wa.me/${WHATSAPP}?text=${message}"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                Commander sur WhatsApp
                            </a>
                        </div>
                    </div>
                </article>
            `;
        }).join("");

        // Avoid broken product images if a URL is no longer available.
        productsGrid.querySelectorAll(".product-image img").forEach((image) => {
            image.addEventListener("error", () => {
                const placeholder = document.createElement("div");
                placeholder.className = "product-no-image";
                placeholder.textContent = "✦ FOMSILIGHTING";
                image.replaceWith(placeholder);
            }, { once: true });
        });
    }

    // =========================================================
    // WHATSAPP ORDER WITH QUANTITY AND TOTAL
    // =========================================================
    if (productsGrid) {
        productsGrid.addEventListener("click", (event) => {
            const button = event.target.closest("[data-whatsapp-order]");

            if (!button) return;

            const card = button.closest(".product-card");
            if (!card) return;

            const quantityInput = card.querySelector(".product-quantity");
            if (!quantityInput) {
                event.preventDefault();
                return;
            }

            const quantity = Number(quantityInput.value);
            const name = button.dataset.productName;
            const price = Number(button.dataset.productPrice);

            if (
                !Number.isInteger(quantity) ||
                quantity < 1 ||
                quantity > 99
            ) {
                event.preventDefault();
                alert("Veuillez choisir une quantité entre 1 et 99.");
                quantityInput.focus();
                return;
            }

            if (
                button.dataset.productPrice === "" ||
                !Number.isFinite(price) ||
                price < 0
            ) {
                event.preventDefault();
                alert("Prix du produit invalide.");
                return;
            }

            const total = price * quantity;

            const message = `Bonjour Fomsilighting 👋

Je souhaite commander :

💡 Produit : ${name}
💰 Prix unitaire : ${formatPrice(price)}
📦 Quantité : ${quantity}
💵 Total : ${formatPrice(total)}

Merci de me confirmer la disponibilité.`;

            button.href =
                `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(message)}`;
        });
    }

    // Existing collection cards and product filter buttons.
    $$(".filter[data-filter]").forEach((button) => {
        button.addEventListener("click", () => {
            currentFilter = button.dataset.filter || "all";

            $$(".filter[data-filter]").forEach((filterButton) => {
                const active = filterButton === button;

                filterButton.classList.toggle("active", active);
                filterButton.setAttribute("aria-pressed", String(active));
            });

            renderPublicProducts();
        });
    });

    $$(".category-card[data-filter]").forEach((button) => {
        button.addEventListener("click", () => {
            currentFilter = button.dataset.filter || "all";

            $$(".filter[data-filter]").forEach((filterButton) => {
                const active = filterButton.dataset.filter === currentFilter;

                filterButton.classList.toggle("active", active);
                filterButton.setAttribute("aria-pressed", String(active));
            });

            renderPublicProducts();

            const boutique = $("#boutique");

            if (boutique) {
                boutique.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
            }
        });
    });

    // =========================================================
    // ADMIN DATA: LOAD PRODUCTS AND CATEGORIES
    // =========================================================
    async function loadAdminData() {
        if (!isAdmin || !getToken()) return;

        if (adminProductList) {
            adminProductList.innerHTML = "<p>Chargement des produits...</p>";
        }

        if (adminCategoryList) {
            adminCategoryList.innerHTML = "<p>Chargement des catégories...</p>";
        }

        const [productResult, categoryResult] = await Promise.all([
            apiRequest("/products"),
            apiRequest("/categories")
        ]);

        products = Array.isArray(productResult)
            ? productResult
            : productResult.products || [];

        categories = Array.isArray(categoryResult)
            ? categoryResult
            : categoryResult.categories || [];

        populateCategorySelect();
        renderAdminProducts();
        renderAdminCategories();
        renderPublicProducts();
    }

    function populateCategorySelect() {
        if (!productCategoryInput) return;

        const previousValue = productCategoryInput.value;

        productCategoryInput.innerHTML = `
            <option value="">Choisir une catégorie</option>
            ${categories.map((category) => {
                const id = getField(category, "CategoryID", "categoryId");
                const name = getField(category, "Name", "name");

                return `
                    <option value="${escapeHTML(id)}">
                        ${escapeHTML(name)}
                    </option>
                `;
            }).join("")}
        `;

        if (categories.some((category) =>
            String(getField(category, "CategoryID", "categoryId")) === previousValue
        )) {
            productCategoryInput.value = previousValue;
        }
    }

    // =========================================================
    // ADMIN PRODUCT LIST
    // =========================================================
    function renderAdminProducts() {
        if (!adminProductList) return;

        if (!products.length) {
            adminProductList.innerHTML = "<p>Aucun produit actif.</p>";
            return;
        }

        adminProductList.innerHTML = products.map((product) => {
            const id = Number(getField(product, "ProductID", "productId"));
            const name = getField(product, "Name", "name") || "Sans nom";
            const price = getField(product, "Price", "price");
            const stock = getField(product, "Stock", "stock");
            const categoryName = getCategoryName(product);

            return `
                <article class="admin-list-item">
                    <div class="admin-item-info">
                        <strong>${escapeHTML(name)}</strong>
                        <span>${escapeHTML(categoryName)}</span>
                        <span>${escapeHTML(formatPrice(price))} · Stock : ${escapeHTML(stock)}</span>
                    </div>

                    <div class="admin-item-actions">
                        <button
                            type="button"
                            class="btn btn-outline"
                            data-edit-product="${id}"
                        >
                            Modifier
                        </button>

                        <button
                            type="button"
                            class="btn btn-outline"
                            data-deactivate-product="${id}"
                        >
                            Désactiver
                        </button>
                    </div>
                </article>
            `;
        }).join("");
    }

    if (adminProductList) {
        adminProductList.addEventListener("click", async (event) => {
            const editButton = event.target.closest("[data-edit-product]");
            const deactivateButton = event.target.closest("[data-deactivate-product]");

            if (editButton) {
                const id = Number(editButton.dataset.editProduct);
                const product = products.find(
                    (item) => Number(getField(item, "ProductID", "productId")) === id
                );

                if (product) {
                    startProductEdit(product);
                }

                return;
            }

            if (deactivateButton) {
                const id = Number(deactivateButton.dataset.deactivateProduct);
                const product = products.find(
                    (item) => Number(getField(item, "ProductID", "productId")) === id
                );

                if (!product) return;

                const name = getField(product, "Name", "name");

                if (!confirm(`Désactiver le produit « ${name} » ? Il ne sera plus affiché dans la boutique.`)) {
                    return;
                }

                try {
                    await apiRequest(`/products/${id}`, {
                        method: "DELETE"
                    });

                    showMessage(
                        accountMessage,
                        "Produit désactivé avec succès.",
                        "success"
                    );

                    await loadAdminData();
                } catch (error) {
                    showMessage(accountMessage, error.message, "error");
                }
            }
        });
    }

    // =========================================================
    // ADD / EDIT PRODUCT
    // =========================================================
    function resetProductForm() {
        if (!productForm) return;

        productForm.reset();
        productIdInput.value = "";

        currentProductImageURL = null;
        clearProductImagePreview();

        if (productImageUpload) {
            productImageUpload.hidden = true;
        }

        if (productStockInput) productStockInput.value = "0";

        if (saveProductBtn) {
            saveProductBtn.textContent = "Ajouter le produit";
        }

        if (cancelProductEditBtn) {
            cancelProductEditBtn.hidden = true;
        }
    }

    function startProductEdit(product) {
        if (productImageUpload) {
            productImageUpload.hidden = false;
        }

        productIdInput.value = getField(product, "ProductID", "productId");
        productNameInput.value = getField(product, "Name", "name");
        productCategoryInput.value = getField(product, "CategoryID", "categoryId");
        productDescriptionInput.value = getField(product, "Description", "description");
        productPriceInput.value = getField(product, "Price", "price");
        productStockInput.value = getField(product, "Stock", "stock");

        // Keep the current image URL for editing.
        // A new image will replace it only if the admin selects another file.
        currentProductImageURL = safeImageURL(
            getField(product, "ImageURL", "imageURL", "imageUrl")
        );

        // File inputs cannot be filled with an existing URL.
        productImageInput.value = "";

        clearProductImagePreview();

        if (currentProductImageURL) {
            showProductImagePreview(
                currentProductImageURL,
                "Image actuelle du produit. Sélectionnez une nouvelle image pour la remplacer."
            );
        }

        if (saveProductBtn) {
            saveProductBtn.textContent = "Enregistrer les modifications";
        }

        if (cancelProductEditBtn) {
            cancelProductEditBtn.hidden = false;
        }

        productForm.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }

    if (cancelProductEditBtn) {
        cancelProductEditBtn.addEventListener("click", resetProductForm);
    }

    if (productForm) {
        productForm.addEventListener("submit", async (event) => {
            event.preventDefault();

            if (!isAdmin) {
                showMessage(accountMessage, "Connectez-vous comme administrateur.", "error");
                return;
            }

            const id = productIdInput.value;
            const selectedFile = productImageInput.files?.[0] || null;

            // Validate product information before uploading the image.
            const payload = {
                CategoryID: Number(productCategoryInput.value),
                Name: productNameInput.value.trim(),
                Description: productDescriptionInput.value.trim(),
                Price: Number(productPriceInput.value),
                Stock: Number(productStockInput.value || 0),
                ImageURL: currentProductImageURL
            };

            if (
                !payload.Name ||
                !payload.CategoryID ||
                !Number.isFinite(payload.Price) ||
                payload.Price < 0 ||
                !Number.isInteger(payload.Stock) ||
                payload.Stock < 0
            ) {
                showMessage(
                    accountMessage,
                    "Vérifiez le nom, la catégorie, le prix et le stock.",
                    "error"
                );
                return;
            }

            // Validate the selected image.
            if (selectedFile) {
                const allowedTypes = [
                    "image/jpeg",
                    "image/png",
                    "image/webp",
                    "image/gif",
                    "image/avif"
                ];

                if (!allowedTypes.includes(selectedFile.type)) {
                    showMessage(
                        accountMessage,
                        "Format d'image invalide. Utilisez JPG, PNG, WEBP, GIF ou AVIF.",
                        "error"
                    );
                    return;
                }

                if (selectedFile.size > 5 * 1024 * 1024) {
                    showMessage(
                        accountMessage,
                        "L'image ne doit pas dépasser 5 MB.",
                        "error"
                    );
                    return;
                }
            }

            if (saveProductBtn) {
                saveProductBtn.disabled = true;
            }

            try {
                // Step 1: Upload the selected image to Cloudinary.
                if (selectedFile) {
                    showMessage(
                        accountMessage,
                        "Envoi de l'image vers Cloudinary en cours...",
                        "info"
                    );

                    if (productImageStatus) {
                        productImageStatus.textContent = "Envoi de l'image en cours...";
                    }

                    payload.ImageURL = await uploadProductImage(selectedFile);

                    currentProductImageURL = payload.ImageURL;

                    showProductImagePreview(
                        payload.ImageURL,
                        "Image envoyée avec succès !"
                    );
                }

                // Step 2: Save the product with its Cloudinary URL.
                showMessage(
                    accountMessage,
                    "Enregistrement du produit en cours...",
                    "info"
                );

                await apiRequest(
                    id ? `/products/${encodeURIComponent(id)}` : "/products",
                    {
                        method: id ? "PUT" : "POST",
                        body: JSON.stringify(payload)
                    }
                );

                showMessage(
                    accountMessage,
                    id ? "Produit modifié avec succès." : "Produit ajouté avec succès.",
                    "success"
                );

                resetProductForm();
                await loadAdminData();

            } catch (error) {
                showMessage(accountMessage, error.message, "error");

                if (productImageStatus && selectedFile) {
                    productImageStatus.textContent = error.message;
                }

            } finally {
                if (saveProductBtn) {
                    saveProductBtn.disabled = false;
                }
            }
        });
    }

    // =========================================================
    // ADMIN CATEGORY LIST
    // =========================================================
    function renderAdminCategories() {
        if (!adminCategoryList) return;

        if (!categories.length) {
            adminCategoryList.innerHTML = "<p>Aucune catégorie trouvée.</p>";
            return;
        }

        adminCategoryList.innerHTML = categories.map((category) => {
            const id = Number(getField(category, "CategoryID", "categoryId"));
            const name = getField(category, "Name", "name") || "Sans nom";
            const description = getField(category, "Description", "description");

            return `
                <article class="admin-list-item">
                    <div class="admin-item-info">
                        <strong>${escapeHTML(name)}</strong>
                        <span>${escapeHTML(description || "Aucune description")}</span>
                    </div>

                    <div class="admin-item-actions">
                        <button
                            type="button"
                            class="btn btn-outline"
                            data-edit-category="${id}"
                        >
                            Modifier
                        </button>

                        <button
                            type="button"
                            class="btn btn-outline"
                            data-delete-category="${id}"
                        >
                            Supprimer
                        </button>
                    </div>
                </article>
            `;
        }).join("");
    }

    if (adminCategoryList) {
        adminCategoryList.addEventListener("click", async (event) => {
            const editButton = event.target.closest("[data-edit-category]");
            const deleteButton = event.target.closest("[data-delete-category]");

            if (editButton) {
                const id = Number(editButton.dataset.editCategory);

                const category = categories.find(
                    (item) => Number(getField(item, "CategoryID", "categoryId")) === id
                );

                if (category) {
                    startCategoryEdit(category);
                }

                return;
            }

            if (deleteButton) {
                const id = Number(deleteButton.dataset.deleteCategory);

                const category = categories.find(
                    (item) => Number(getField(item, "CategoryID", "categoryId")) === id
                );

                if (!category) return;

                const name = getField(category, "Name", "name");

                if (!confirm(`Supprimer la catégorie « ${name} » ?`)) {
                    return;
                }

                try {
                    await apiRequest(`/categories/${id}`, {
                        method: "DELETE"
                    });

                    showMessage(
                        accountMessage,
                        "Catégorie supprimée avec succès.",
                        "success"
                    );

                    await loadAdminData();
                } catch (error) {
                    showMessage(
                        accountMessage,
                        `${error.message} Si des produits utilisent cette catégorie, retirez-les ou changez leur catégorie d'abord.`,
                        "error"
                    );
                }
            }
        });
    }

    // =========================================================
    // ADD / EDIT CATEGORY
    // =========================================================
    function resetCategoryForm() {
        if (!categoryForm) return;

        categoryForm.reset();
        categoryIdInput.value = "";

        if (saveCategoryBtn) {
            saveCategoryBtn.textContent = "Ajouter la catégorie";
        }

        if (cancelCategoryEditBtn) {
            cancelCategoryEditBtn.hidden = true;
        }
    }

    function startCategoryEdit(category) {
        categoryIdInput.value = getField(category, "CategoryID", "categoryId");
        categoryNameInput.value = getField(category, "Name", "name");
        categoryDescriptionInput.value = getField(category, "Description", "description");

        if (saveCategoryBtn) {
            saveCategoryBtn.textContent = "Enregistrer les modifications";
        }

        if (cancelCategoryEditBtn) {
            cancelCategoryEditBtn.hidden = false;
        }

        categoryForm.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }

    if (cancelCategoryEditBtn) {
        cancelCategoryEditBtn.addEventListener("click", resetCategoryForm);
    }

    if (categoryForm) {
        categoryForm.addEventListener("submit", async (event) => {
            event.preventDefault();

            if (!isAdmin) {
                showMessage(accountMessage, "Connectez-vous comme administrateur.", "error");
                return;
            }

            const id = categoryIdInput.value;

            const payload = {
                Name: categoryNameInput.value.trim(),
                Description: categoryDescriptionInput.value.trim()
            };

            if (!payload.Name) {
                showMessage(accountMessage, "Le nom de la catégorie est obligatoire.", "error");
                return;
            }

            saveCategoryBtn.disabled = true;

            try {
                await apiRequest(
                    id ? `/categories/${encodeURIComponent(id)}` : "/categories",
                    {
                        method: id ? "PUT" : "POST",
                        body: JSON.stringify(payload)
                    }
                );

                showMessage(
                    accountMessage,
                    id ? "Catégorie modifiée avec succès." : "Catégorie ajoutée avec succès.",
                    "success"
                );

                resetCategoryForm();
                await loadAdminData();
            } catch (error) {
                showMessage(accountMessage, error.message, "error");
            } finally {
                saveCategoryBtn.disabled = false;
            }
        });
    }

    // =========================================================
    // HEADER SCROLL EFFECT
    // =========================================================
    const header = $("header");

    function updateHeader() {
        if (header) {
            header.classList.toggle("scrolled", window.scrollY > 30);
        }
    }

    window.addEventListener("scroll", updateHeader, { passive: true });
    updateHeader();

    // =========================================================
    // REVEAL ANIMATIONS
    // =========================================================
    if ("IntersectionObserver" in window) {
        const revealElements = $$(
            ".section, .category-card, .product-card, .about-grid, .cta, .contact-grid"
        );

        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add("visible");
                    observer.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.08
        });

        revealElements.forEach((element) => {
            element.classList.add("reveal");
            observer.observe(element);
        });
    }

    // =========================================================
    // FOOTER YEAR
    // =========================================================
    const yearElement = $("footer .footer-bottom span");

    if (yearElement) {
        yearElement.textContent =
            `© ${new Date().getFullYear()} Fomsilighting. Tous droits réservés.`;
    }

    // =========================================================
    // STARTUP
    // =========================================================
    updateAccountView();

    loadProducts();

    if (isAdmin) {
        loadAdminData().catch((error) => {
            showMessage(accountMessage, error.message, "error");
        });
    }
});