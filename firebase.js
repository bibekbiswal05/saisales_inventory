(async () => {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js");
  const { getAnalytics, isSupported } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-analytics.js");
  const { getAuth } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js");
  const firestore = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");

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
  const db = firestore.getFirestore(app);

  if (await isSupported()) {
    getAnalytics(app);
  }

  window.SaiFirebase = {
    app,
    auth,
    firebaseConfig,
    db,
    firestore
  };
})().catch((error) => {
  console.error("Firebase failed to load:", error);
  window.SaiFirebaseError = error;
});
