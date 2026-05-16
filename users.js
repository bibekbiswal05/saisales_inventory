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
    serverTimestamp,
    setDoc,
    doc
  } = firestore;
  const { initializeApp, deleteApp } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js");
  const {
    createUserWithEmailAndPassword,
    deleteUser,
    getAuth,
    onAuthStateChanged,
    signOut,
    updateProfile
  } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js");

  const user = await waitForSignedInUser();

  if (!user) {
    return;
  }

  const userTableBody = document.getElementById("userTableBody");
  const showAddUserButton = document.getElementById("showAddUserButton");
  const addUserForm = document.getElementById("addUserForm");
  const cancelAddUserButton = document.getElementById("cancelAddUserButton");
  const addUserStatus = document.getElementById("addUserStatus");
  const saveUserButton = document.getElementById("saveUserButton");
  const usersRef = collection(db, "users");

  showAddUserButton?.addEventListener("click", () => {
    addUserForm.hidden = false;
    addUserStatus.textContent = "";
    addUserStatus.classList.remove("error");
    document.getElementById("userName")?.focus();
  });

  cancelAddUserButton?.addEventListener("click", () => {
    addUserForm.reset();
    addUserForm.hidden = true;
    setStatus("");
  });

  addUserForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("");
    saveUserButton.disabled = true;
    saveUserButton.textContent = "Saving...";

    try {
      const appUser = await createAppUser();
      addUserForm.reset();
      setStatus(`${appUser.name} added successfully.`);
    } catch (error) {
      setStatus(getFriendlyAuthError(error), true);
    } finally {
      saveUserButton.disabled = false;
      saveUserButton.textContent = "Save User";
    }
  });

  onSnapshot(usersRef, (snapshot) => {
    if (snapshot.empty) {
      userTableBody.innerHTML = `<tr><td class="empty-table" colspan="5">No users found.</td></tr>`;
      return;
    }

    const userDocs = [...snapshot.docs].sort((first, second) => {
      const firstData = first.data();
      const secondData = second.data();
      const firstRole = String(firstData.role || "").toLowerCase();
      const secondRole = String(secondData.role || "").toLowerCase();
      const roleSort = firstRole.localeCompare(secondRole);

      if (roleSort !== 0) {
        return roleSort;
      }

      return String(firstData.name || firstData.displayName || firstData.email || first.id)
        .localeCompare(String(secondData.name || secondData.displayName || secondData.email || second.id));
    });

    userTableBody.innerHTML = userDocs.map((userDoc) => {
      const appUser = userDoc.data();
      const role = String(appUser.role || "-").trim();
      const status = String(appUser.status || "active").trim();

      return `
        <tr>
          <td>${escapeHtml(appUser.name || appUser.displayName || "-")}</td>
          <td>${escapeHtml(appUser.email || "-")}</td>
          <td><span class="status ${role.toLowerCase() === "admin" ? "good" : "low"}">${escapeHtml(role || "-")}</span></td>
          <td><span class="status good">${escapeHtml(status || "active")}</span></td>
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

  async function createAppUser() {
    const name = document.getElementById("userName").value.trim();
    const email = document.getElementById("userEmail").value.trim();
    const password = document.getElementById("userPassword").value;
    const role = document.getElementById("userRole").value;

    if (!name) {
      throw new Error("Enter user name.");
    }

    if (!email) {
      throw new Error("Enter user email.");
    }

    if (!password || password.length < 6) {
      throw new Error("Password must be at least 6 characters.");
    }

    const secondaryApp = initializeApp(window.SaiFirebase.firebaseConfig, `user-create-${Date.now()}`);
    const secondaryAuth = getAuth(secondaryApp);
    let credential;

    try {
      credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      await updateProfile(credential.user, { displayName: name });

      await setDoc(doc(db, "users", credential.user.uid), {
        name,
        displayName: name,
        email,
        role,
        status: "active",
        createdBy: auth.currentUser?.uid || "",
        createdByEmail: auth.currentUser?.email || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      return { name, email, role };
    } catch (error) {
      if (credential?.user) {
        await deleteUser(credential.user).catch(() => {});
      }

      throw error;
    } finally {
      await signOut(secondaryAuth).catch(() => {});
      await deleteApp(secondaryApp).catch(() => {});
    }
  }

  function setStatus(message, isError = false) {
    if (!addUserStatus) {
      return;
    }

    addUserStatus.textContent = message;
    addUserStatus.classList.toggle("error", Boolean(isError));
  }

  function getFriendlyAuthError(error) {
    if (error.code === "auth/email-already-in-use") {
      return "This email is already added.";
    }

    if (error.code === "auth/invalid-email") {
      return "Enter a valid email address.";
    }

    if (error.code === "auth/weak-password") {
      return "Password must be at least 6 characters.";
    }

    return error.message || "Unable to add user.";
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
