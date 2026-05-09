(async () => {
  while (!window.SaiFirebase && !window.SaiFirebaseError) {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  if (window.SaiFirebaseError) {
    return;
  }

  const { auth, db, firestore } = window.SaiFirebase;
  const {
    collection,
    onSnapshot,
    orderBy,
    query
  } = firestore;
  const { onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js");

  const user = await waitForSignedInUser();

  if (!user) {
    return;
  }

  const userTableBody = document.getElementById("userTableBody");
  const usersRef = collection(db, "users");

  onSnapshot(query(usersRef, orderBy("role")), (snapshot) => {
    if (snapshot.empty) {
      userTableBody.innerHTML = `<tr><td class="empty-table" colspan="5">No users found.</td></tr>`;
      return;
    }

    userTableBody.innerHTML = snapshot.docs.map((userDoc) => {
      const appUser = userDoc.data();
      const role = String(appUser.role || "-").trim();

      return `
        <tr>
          <td>${escapeHtml(appUser.name || appUser.displayName || "-")}</td>
          <td>${escapeHtml(appUser.email || "-")}</td>
          <td><span class="status ${role.toLowerCase() === "admin" ? "good" : "low"}">${escapeHtml(role || "-")}</span></td>
          <td><span class="status good">Active</span></td>
          <td class="product-actions"><span class="muted-action">${escapeHtml(userDoc.id)}</span></td>
        </tr>
      `;
    }).join("");
  }, (error) => {
    userTableBody.innerHTML = `<tr><td class="empty-table" colspan="5">${escapeHtml(error.message)}</td></tr>`;
  });

  function waitForSignedInUser() {
    if (auth.currentUser) {
      return Promise.resolve(auth.currentUser);
    }

    return new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        unsubscribe();

        if (!currentUser) {
          window.location.href = "index.html";
          resolve(null);
          return;
        }

        resolve(currentUser);
      });
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
