(async () => {
  while (!window.SaiFirebase && !window.SaiFirebaseError) {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  if (window.SaiFirebaseError) {
    return;
  }

  const { auth, db, firestore } = window.SaiFirebase;
  const {
    addDoc,
    collection,
    deleteDoc,
    doc,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    updateDoc
  } = firestore;
  const { onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js");

  const suppliersRef = collection(db, "suppliers");
  const stockInRef = collection(db, "stockIn");
  const form = document.getElementById("supplierForm");
  const supplierDocId = document.getElementById("supplierDocId");
  const formTitle = document.getElementById("supplierFormTitle");
  const supplierTableBody = document.getElementById("supplierTableBody");
  const supplierStatus = document.getElementById("supplierStatus");
  const saveButton = document.getElementById("saveSupplierButton");
  const cancelEditButton = document.getElementById("cancelSupplierEditButton");
  const purchaseHistoryBody = document.getElementById("supplierPurchaseHistoryBody");
  const isAdmin = () => document.body.dataset.role === "admin";
  let suppliers = [];

  const user = await waitForSignedInUser();

  if (!user) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("");
    saveButton.disabled = true;
    saveButton.textContent = supplierDocId.value ? "Updating..." : "Saving...";

    try {
      const supplier = getSupplierFromForm();

      if (supplierDocId.value) {
        await updateDoc(doc(db, "suppliers", supplierDocId.value), {
          ...supplier,
          updatedAt: serverTimestamp()
        });
        setStatus("Supplier updated successfully.");
      } else {
        await addDoc(suppliersRef, {
          ...supplier,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        setStatus("Supplier added successfully.");
      }

      resetForm();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = supplierDocId.value ? "Update Supplier" : "Save Supplier";
    }
  });

  cancelEditButton.addEventListener("click", resetForm);

  supplierTableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");

    if (!button) {
      return;
    }

    const supplier = suppliers.find((item) => item.id === button.dataset.id);

    if (!supplier) {
      return;
    }

    if (button.dataset.action === "edit") {
      fillForm(supplier);
      return;
    }

    if (button.dataset.action === "delete") {
      if (!isAdmin()) {
        setStatus("Only Admin can delete suppliers.", true);
        return;
      }

      if (!confirm(`Delete ${supplier.name}?`)) {
        return;
      }

      await deleteDoc(doc(db, "suppliers", supplier.id));
      setStatus("Supplier deleted successfully.");
    }
  });

  onSnapshot(query(suppliersRef, orderBy("name")), (snapshot) => {
    suppliers = snapshot.docs.map((supplierDoc) => ({
      id: supplierDoc.id,
      ...supplierDoc.data()
    }));
    renderSuppliers();
  }, (error) => setStatus(error.message, true));

  onSnapshot(query(stockInRef, orderBy("createdAt", "desc")), (snapshot) => {
    if (snapshot.empty) {
      purchaseHistoryBody.innerHTML = `<tr><td class="empty-table" colspan="4">No purchase history yet.</td></tr>`;
      return;
    }

    purchaseHistoryBody.innerHTML = snapshot.docs.map((entryDoc) => {
      const entry = entryDoc.data();

      return `
        <tr>
          <td>${formatMovementDate(entry.movementDate, entry.createdAt)}</td>
          <td>${escapeHtml(entry.supplierName)}</td>
          <td>${escapeHtml(entry.productName)}</td>
          <td>${formatNumber(entry.quantity)} ${escapeHtml(entry.unit)}</td>
        </tr>
      `;
    }).join("");
  }, (error) => {
    purchaseHistoryBody.innerHTML = `<tr><td class="empty-table" colspan="4">${escapeHtml(error.message)}</td></tr>`;
  });

  function renderSuppliers() {
    if (!suppliers.length) {
      supplierTableBody.innerHTML = `<tr><td class="empty-table" colspan="4">No suppliers added yet.</td></tr>`;
      return;
    }

    supplierTableBody.innerHTML = suppliers.map((supplier) => `
      <tr>
        <td>${escapeHtml(supplier.name)}</td>
        <td>${escapeHtml(supplier.phone)}</td>
        <td>${escapeHtml(supplier.email)}</td>
        <td class="product-actions">
          <button class="secondary-button small-button" type="button" data-action="edit" data-id="${supplier.id}">Edit</button>
          ${isAdmin() ? `<button class="danger-button small-button" type="button" data-action="delete" data-id="${supplier.id}">Delete</button>` : ""}
        </td>
      </tr>
    `).join("");
  }

  function getSupplierFromForm() {
    const name = document.getElementById("supplierNameInput").value.trim();

    if (!name) {
      throw new Error("Supplier name is required.");
    }

    return {
      name,
      phone: document.getElementById("supplierPhone").value.trim(),
      email: document.getElementById("supplierEmail").value.trim(),
      address: document.getElementById("supplierAddress").value.trim()
    };
  }

  function fillForm(supplier) {
    supplierDocId.value = supplier.id;
    formTitle.textContent = "Edit Supplier";
    document.getElementById("supplierNameInput").value = supplier.name || "";
    document.getElementById("supplierPhone").value = supplier.phone || "";
    document.getElementById("supplierEmail").value = supplier.email || "";
    document.getElementById("supplierAddress").value = supplier.address || "";
    saveButton.textContent = "Update Supplier";
    cancelEditButton.hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetForm() {
    form.reset();
    supplierDocId.value = "";
    formTitle.textContent = "Add Supplier";
    saveButton.textContent = "Save Supplier";
    cancelEditButton.hidden = true;
  }

  function setStatus(message, isError = false) {
    supplierStatus.textContent = message;
    supplierStatus.classList.toggle("error", isError);
  }

  function formatMovementDate(dateValue, fallbackTimestamp) {
    if (dateValue) {
      const date = new Date(`${dateValue}T00:00:00`);
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      }
    }

    const date = fallbackTimestamp?.toDate ? fallbackTimestamp.toDate() : null;
    return date ? date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function waitForSignedInUser() {
    if (auth.currentUser) {
      return Promise.resolve(auth.currentUser);
    }

    return new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        unsubscribe();

        if (!user) {
          window.location.href = "index.html";
          resolve(null);
          return;
        }

        resolve(user);
      });
    });
  }
})();
