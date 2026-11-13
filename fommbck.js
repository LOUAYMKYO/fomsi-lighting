/* =========================================================
   FOMSILIGHTING — MAIN JAVASCRIPT
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {

    /* =====================================================
       MOBILE MENU
       ===================================================== */

    const menuBtn = document.getElementById("menuBtn");
    const navLinks = document.getElementById("navLinks");

    if (menuBtn && navLinks) {

        menuBtn.addEventListener("click", () => {
            navLinks.classList.toggle("active");

            if (navLinks.classList.contains("active")) {
                menuBtn.textContent = "✕";
            } else {
                menuBtn.textContent = "☰";
            }
        });

        // Close menu when clicking a navigation link
        const links = navLinks.querySelectorAll("a");

        links.forEach(link => {
            link.addEventListener("click", () => {
                navLinks.classList.remove("active");
                menuBtn.textContent = "☰";
            });
        });
    }


    /* =====================================================
       PRODUCT FILTER
       ===================================================== */

    const filterButtons = document.querySelectorAll(".filter");
    const productCards = document.querySelectorAll(".product-card");

    filterButtons.forEach(button => {

        button.addEventListener("click", () => {

            // Remove active class from all buttons
            filterButtons.forEach(btn => {
                btn.classList.remove("active");
            });

            // Add active class to clicked button
            button.classList.add("active");

            const filter = button.getAttribute("data-filter");

            productCards.forEach(card => {

                const category = card.getAttribute("data-category");

                if (filter === "all" || category === filter) {

                    card.style.display = "block";

                    // Small animation
                    card.style.opacity = "0";
                    card.style.transform = "translateY(15px)";

                    setTimeout(() => {
                        card.style.transition = "opacity 0.3s ease, transform 0.3s ease";
                        card.style.opacity = "1";
                        card.style.transform = "translateY(0)";
                    }, 50);

                } else {

                    card.style.display = "none";
                }

            });

        });

    });


    /* =====================================================
       CATEGORY CARDS
       Clicking a category filters the products
       ===================================================== */

    const categoryCards = document.querySelectorAll(".category-card");

    categoryCards.forEach(card => {

        card.addEventListener("click", () => {

            const category = card.getAttribute("data-filter");

            // Find matching filter button
            const matchingButton = document.querySelector(
                `.filter[data-filter="${category}"]`
            );

            if (matchingButton) {

                matchingButton.click();

                // Scroll to products
                const boutique = document.getElementById("boutique");

                if (boutique) {
                    boutique.scrollIntoView({
                        behavior: "smooth",
                        block: "start"
                    });
                }
            }

        });

    });


    /* =====================================================
       SMOOTH SCROLL
       ===================================================== */

    const anchorLinks = document.querySelectorAll('a[href^="#"]');

    anchorLinks.forEach(link => {

        link.addEventListener("click", function (event) {

            const targetId = this.getAttribute("href");

            if (!targetId || targetId === "#") {
                return;
            }

            const target = document.querySelector(targetId);

            if (target) {

                event.preventDefault();

                target.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });

            }

        });

    });


    /* =====================================================
       NAVBAR SCROLL EFFECT
       ===================================================== */

    const header = document.querySelector("header");

    if (header) {

        window.addEventListener("scroll", () => {

            if (window.scrollY > 50) {
                header.classList.add("scrolled");
            } else {
                header.classList.remove("scrolled");
            }

        });

    }


    /* =====================================================
       REVEAL ANIMATION
       ===================================================== */

    const revealElements = document.querySelectorAll(
        ".category-card, .product-card, .about-content, .about-image, .contact-item"
    );

    if ("IntersectionObserver" in window) {

        const observer = new IntersectionObserver(
            (entries, observer) => {

                entries.forEach(entry => {

                    if (entry.isIntersecting) {

                        entry.target.classList.add("show");

                        observer.unobserve(entry.target);
                    }

                });

            },
            {
                threshold: 0.12
            }
        );

        revealElements.forEach(element => {
            element.classList.add("reveal");
            observer.observe(element);
        });

    } else {

        // Fallback for old browsers
        revealElements.forEach(element => {
            element.classList.add("show");
        });

    }


    /* =====================================================
       PRODUCT IMAGE ERROR HANDLING
       ===================================================== */

    const images = document.querySelectorAll("img");

    images.forEach(img => {

        img.addEventListener("error", () => {

            console.warn(
                "Image could not be loaded:",
                img.src
            );

            img.style.opacity = "0.3";

        });

    });


    /* =====================================================
       CURRENT YEAR
       ===================================================== */

    const currentYear = new Date().getFullYear();

    const footerYear = document.querySelector(".footer-bottom span");

    if (footerYear) {

        footerYear.innerHTML =
            `© ${currentYear} Fomsilighting. Tous droits réservés.`;

    }


    /* =====================================================
       WHATSAPP LINKS
       ===================================================== */

    const whatsappLinks = document.querySelectorAll(
        'a[href*="wa.me"]'
    );

    whatsappLinks.forEach(link => {

        link.addEventListener("click", () => {

            console.log(
                "Ouverture de WhatsApp pour contacter Fomsilighting..."
            );

        });

    });


    /* =====================================================
       PHONE NUMBER
       ===================================================== */

    const phoneLinks = document.querySelectorAll(
        'a[href^="tel:"]'
    );

    phoneLinks.forEach(link => {

        link.addEventListener("click", () => {

            console.log(
                "Appel de Fomsilighting : 0773 86 40 31"
            );

        });

    });


    /* =====================================================
       INITIALIZATION MESSAGE
       ===================================================== */

    console.log(
        "Fomsilighting website loaded successfully."
    );

});