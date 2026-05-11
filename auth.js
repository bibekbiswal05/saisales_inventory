(async () => {
  while (!window.SaiFirebase && !window.SaiFirebaseError) {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  if (window.SaiFirebaseError) {
    showError("Firebase failed to load. Please refresh and try again.");
    return;
  }

  const { auth, db, firestore } = window.SaiFirebase;
  const {
    doc,
    getDoc
  } = firestore;
  const { signInWithEmailAndPassword, onAuthStateChanged, signOut } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js");

  window.togglePassword = function () {
    const password = document.getElementById("password");
    const toggle = document.querySelector(".icon-button");

    if (!password || !toggle) {
      return;
    }

    const isHidden = password.type === "password";
    password.type = isHidden ? "text" : "password";
    toggle.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
  };

  window.logout = async function () {
    await signOut(auth);
    window.location.href = "index.html";
  };

  window.requireLogin = function () {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "index.html";
        return;
      }

      const role = await getUserRole(user.uid);
      document.body.dataset.role = role || "";
      window.SaiCurrentRole = role;

      if (document.body.dataset.adminPage === "true" && role !== "admin") {
        window.location.href = "staff-dashboard.html";
        return;
      }

      document.body.dataset.authReady = "true";

      const roleLabel = document.querySelector("[data-role-label]");
      if (roleLabel) {
        roleLabel.textContent = role === "admin" ? "Admin" : "Staff";
      }

      if (role !== "admin") {
        document.querySelectorAll("[data-admin-only]").forEach((element) => {
          element.hidden = true;
        });
      } else {
        document.querySelectorAll("[data-admin-only]").forEach((element) => {
          element.hidden = false;
        });
      }

      initMobileNavigation();
    });
  };

  const loginForm = document.getElementById("loginForm");

  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;
      const loginButton = document.getElementById("loginButton");

      if (!email || !password) {
        showError("Enter your email and password.");
        return;
      }

      showError("");
      loginButton.disabled = true;
      loginButton.textContent = "Logging in...";

      try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const role = await getUserRole(userCredential.user.uid);

        if (role === "admin") {
          window.location.href = "admin-dashboard.html";
          return;
        }

        if (role === "staff") {
          window.location.href = "staff-dashboard.html";
          return;
        }

        showError("Invalid role. Please contact the administrator.");
      } catch (error) {
        showError(error.message);
      } finally {
        loginButton.disabled = false;
        loginButton.textContent = "Log In";
      }
    });
  }

  if (!loginForm && (document.querySelector(".app-shell") || document.querySelector(".admin-shell"))) {
    window.requireLogin();
  }

  async function getUserRole(uid) {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      showError("No role profile found for this user.");
      return "";
    }

    return String(userSnap.data().role || "").trim().toLowerCase();
  }

  function showError(message) {
    const errorMessage = document.getElementById("errorMessage");

    if (errorMessage) {
      errorMessage.textContent = message;
    }
  }

  function initMobileNavigation() {
    const sidebar = document.querySelector(".sidebar");
    const nav = sidebar?.querySelector(".side-nav");
    const logoWrap = sidebar?.querySelector(".logo-wrap");

    if (!sidebar || !nav || !logoWrap || sidebar.querySelector(".mobile-menu-button")) {
      return;
    }

    const menuButton = document.createElement("button");
    menuButton.className = "mobile-menu-button";
    menuButton.type = "button";
    menuButton.setAttribute("aria-label", "Open navigation menu");
    menuButton.setAttribute("aria-controls", "mobileNavigation");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.innerHTML = "<span></span><span></span><span></span>";
    nav.id = nav.id || "mobileNavigation";
    logoWrap.append(menuButton);

    const closeMenu = () => {
      document.body.classList.remove("mobile-nav-open");
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.setAttribute("aria-label", "Open navigation menu");
    };

    menuButton.addEventListener("click", () => {
      const isOpen = document.body.classList.toggle("mobile-nav-open");
      menuButton.setAttribute("aria-expanded", String(isOpen));
      menuButton.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
    });

    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) {
        closeMenu();
      }
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 760) {
        closeMenu();
      }
    });
  }
})();
