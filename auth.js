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
})();
