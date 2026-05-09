(async () => {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js");
  const { getAnalytics, isSupported } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-analytics.js");
  const { getAuth, signInWithEmailAndPassword } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js");
  const { getFirestore, doc, getDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");

  const firebaseConfig = {
    apiKey: "AIzaSyAlFqQ3L1Th7j02GXpNqhkkAqKJzKcjEms",
    authDomain: "sai-sales-inventory-management.firebaseapp.com",
    projectId: "sai-sales-inventory-management",
    storageBucket: "sai-sales-inventory-management.firebasestorage.app",
    messagingSenderId: "684641033011",
    appId: "1:684641033011:web:ec506b29d531556f6b7c46",
    measurementId: "G-M13HG3K7J5"
  };

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const loginForm = document.getElementById("loginForm");
  const loginButton = document.getElementById("loginButton");
  const errorMessage = document.getElementById("errorMessage");

  if (await isSupported()) {
    getAnalytics(app);
  }

  window.togglePassword = function () {
    const password = document.getElementById("password");
    const toggle = document.querySelector(".icon-button");
    const isHidden = password.type === "password";

    password.type = isHidden ? "text" : "password";
    toggle.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
  };

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (!email || !password) {
      errorMessage.textContent = "Enter your email and password.";
      return;
    }

    errorMessage.textContent = "";
    loginButton.disabled = true;
    loginButton.textContent = "Logging in...";

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const userRef = doc(db, "users", userCredential.user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        errorMessage.textContent = "No role profile found for this user.";
        return;
      }

      const role = String(userSnap.data().role || "").trim().toLowerCase();

      if (role === "admin") {
        window.location.href = "admin-dashboard.html";
        return;
      }

      if (role === "staff") {
        window.location.href = "staff-dashboard.html";
        return;
      }

      errorMessage.textContent = "Invalid role. Please contact the administrator.";
    } catch (error) {
      errorMessage.textContent = error.message;
    } finally {
      loginButton.disabled = false;
      loginButton.textContent = "Log In";
    }
  });
})().catch((error) => {
  console.error("Login page failed to load:", error);
  const errorMessage = document.getElementById("errorMessage");

  if (errorMessage) {
    errorMessage.textContent = "Login page failed to load. Please refresh and try again.";
  }
});
