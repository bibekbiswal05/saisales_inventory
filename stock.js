(async () => {
  while (!window.SaiFirebase && !window.SaiFirebaseError) {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  if (window.SaiFirebaseError) {
    return;
  }

  const { auth, db, firestore } = window.SaiFirebase;
  const { onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js");
  const {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    increment,
    limit,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    Timestamp,
    updateDoc,
    writeBatch
  } = firestore;

  const productsRef = collection(db, "products");
  const stockInRef = collection(db, "stockIn");
  const stockOutRef = collection(db, "stockOut");
  const suppliersRef = collection(db, "suppliers");
  const backupCollections = ["products", "suppliers", "users", "stockIn", "stockOut", "stockMovements", "reports"];

  window.StockService = {
    async addProduct(product) {
      return addDoc(productsRef, {
        ...product,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    },

    async updateProduct(productId, product) {
      return updateDoc(doc(db, "products", productId), {
        ...product,
        updatedAt: serverTimestamp()
      });
    },

    async deleteProduct(productId) {
      return deleteDoc(doc(db, "products", productId));
    },

    async listProducts() {
      const productsQuery = query(productsRef, orderBy("name"));
      const snapshot = await getDocs(productsQuery);

      return snapshot.docs.map((productDoc) => ({
        id: productDoc.id,
        ...productDoc.data()
      }));
    },

    subscribeProducts(callback, errorCallback) {
      const productsQuery = query(productsRef, orderBy("name"));

      return onSnapshot(productsQuery, (snapshot) => {
        callback(snapshot.docs.map((productDoc) => ({
          id: productDoc.id,
          ...productDoc.data()
        })));
      }, errorCallback);
    },

    generateSku() {
      return `SKU-${Date.now().toString(36).toUpperCase()}`;
    },

    async recordStockIn(entry) {
      const productRef = doc(db, "products", entry.productId);
      const quantity = Number(entry.quantity || 0);

      if (quantity <= 0) {
        throw new Error("Stock in quantity must be greater than zero.");
      }

      const productSnap = await getDoc(productRef);

      if (!productSnap.exists()) {
        throw new Error("Selected product was not found.");
      }

      const product = productSnap.data();

      await addDoc(stockInRef, {
        ...entry,
        productName: product.name || "",
        sku: product.sku || "",
        unit: product.unit || "",
        quantity,
        createdBy: auth.currentUser?.uid || "",
        createdByEmail: auth.currentUser?.email || "",
        createdAt: serverTimestamp()
      });

      await updateDoc(productRef, {
        quantity: increment(quantity),
        stock: increment(quantity),
        updatedAt: serverTimestamp()
      });
    },

    async recordStockOut(entry) {
      const productRef = doc(db, "products", entry.productId);
      const movementRef = doc(stockOutRef);
      const quantity = Number(entry.quantity || 0);

      if (quantity <= 0) {
        throw new Error("Stock out quantity must be greater than zero.");
      }

      await runTransaction(db, async (transaction) => {
        const productSnap = await transaction.get(productRef);

        if (!productSnap.exists()) {
          throw new Error("Selected product was not found.");
        }

        const product = productSnap.data();
        const currentQuantity = Number(product.quantity || product.stock || 0);

        if (currentQuantity < quantity) {
          throw new Error(`Only ${formatNumber(currentQuantity)} ${product.unit || ""} available in stock.`);
        }

        const nextQuantity = currentQuantity - quantity;

        transaction.set(movementRef, {
          ...entry,
          productName: product.name || "",
          sku: product.sku || "",
          unit: product.unit || "",
          quantity,
          createdBy: auth.currentUser?.uid || "",
          createdByEmail: auth.currentUser?.email || "",
          createdAt: serverTimestamp()
        });

        transaction.update(productRef, {
          quantity: nextQuantity,
          stock: nextQuantity,
          updatedAt: serverTimestamp()
        });
      });
    },

    async updateStock(productId, quantity, type) {
      await addDoc(collection(db, "stockMovements"), {
        productId,
        quantity: Number(quantity),
        type,
        createdAt: serverTimestamp()
      });

      await updateDoc(doc(db, "products", productId), {
        updatedAt: serverTimestamp()
      });
    }
  };

  if (document.getElementById("productForm") || document.getElementById("inventoryTableBody") || document.getElementById("stockInForm") || document.getElementById("stockOutForm") || document.getElementById("dashboardTotalProducts")) {
    const user = await waitForSignedInUser();

    if (!user) {
      return;
    }
  }

  if (document.getElementById("stockReportBody")) {
    const user = await waitForSignedInUser();

    if (!user) {
      return;
    }

    initReportsPage();
  }

  if (document.getElementById("inventoryTableBody")) {
    initInventoryDashboard();
  }

  if (document.getElementById("dashboardTotalProducts")) {
    initMainDashboard();
  }

  if (document.getElementById("stockInForm")) {
    initStockInPage();
  }

  if (document.getElementById("stockOutForm")) {
    initStockOutPage();
  }

  if (document.getElementById("productForm")) {
    initProductPage();
  }

  function initProductPage() {
    const form = document.getElementById("productForm");
    const formTitle = document.getElementById("productFormTitle");
    const productDocId = document.getElementById("productDocId");
    const sku = document.getElementById("sku");
    const imageInput = document.getElementById("productImage");
    const imagePreview = document.getElementById("imagePreview");
    const status = document.getElementById("productStatus");
    const saveButton = document.getElementById("saveProductButton");
    const cancelEditButton = document.getElementById("cancelEditButton");
    const productListSearch = document.getElementById("productListSearch");
    const tableBody = document.getElementById("productTableBody");
    const canViewPrices = () => document.body.dataset.role === "admin";
    let products = [];
    let imageDataUrl = "";

    sku.value = window.StockService.generateSku();
    document.querySelectorAll("[data-price-only] input").forEach((input) => {
      input.required = canViewPrices();
    });

    imageInput.addEventListener("change", async () => {
      const file = imageInput.files[0];

      if (!file) {
        imageDataUrl = "";
        imagePreview.textContent = "No image selected";
        imagePreview.style.backgroundImage = "";
        return;
      }

      imageDataUrl = await readImage(file);
      imagePreview.textContent = "";
      imagePreview.style.backgroundImage = `url("${imageDataUrl}")`;
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatus("");
      saveButton.disabled = true;
      saveButton.textContent = productDocId.value ? "Updating..." : "Saving...";

      try {
        const product = getProductFromForm(imageDataUrl);

        if (productDocId.value) {
          await window.StockService.updateProduct(productDocId.value, product);
          setStatus("Product updated successfully.");
        } else {
          await window.StockService.addProduct(product);
          setStatus("Product added successfully.");
        }

        resetForm();
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = productDocId.value ? "Update Product" : "Save Product";
      }
    });

    cancelEditButton.addEventListener("click", resetForm);
    productListSearch?.addEventListener("input", () => renderProducts(getFilteredProducts()));

    tableBody.addEventListener("click", async (event) => {
      const actionButton = event.target.closest("[data-action]");

      if (!actionButton) {
        return;
      }

      const productId = actionButton.dataset.id;
      const product = products.find((item) => item.id === productId);

      if (!product) {
        return;
      }

      if (actionButton.dataset.action === "edit") {
        fillForm(product);
        return;
      }

      if (actionButton.dataset.action === "delete") {
        if (!canViewPrices()) {
          setStatus("Only Admin can delete products.", true);
          return;
        }

        const shouldDelete = confirm(`Delete ${product.name}?`);

        if (!shouldDelete) {
          return;
        }

        try {
          await window.StockService.deleteProduct(productId);
          setStatus("Product deleted successfully.");
        } catch (error) {
          setStatus(error.message, true);
        }
      }
    });

    window.StockService.subscribeProducts((items) => {
      products = items;
      renderProducts(getFilteredProducts());
    }, (error) => setStatus(error.message, true));

    function getFilteredProducts() {
      const searchTerm = (productListSearch?.value || "").trim().toLowerCase();

      if (!searchTerm) {
        return products;
      }

      return products.filter((product) => [product.name, product.sku, product.category, product.unit]
        .some((value) => String(value || "").toLowerCase().includes(searchTerm)));
    }

    function renderProducts(items) {
      if (!items.length) {
        tableBody.innerHTML = `<tr><td class="empty-table" colspan="8">${products.length ? "No products match your search." : "No products added yet."}</td></tr>`;
        return;
      }

      const showPrices = canViewPrices();

      tableBody.innerHTML = items.map((product, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${product.imageDataUrl ? `<img class="product-thumb" src="${escapeAttribute(product.imageDataUrl)}" alt="">` : `<span class="product-thumb empty-thumb">No image</span>`}</td>
          <td>${escapeHtml(product.name)}</td>
          <td>${escapeHtml(product.sku)}</td>
          <td>${escapeHtml(product.category)}</td>
          ${showPrices ? `<td data-price-only>Cost: ${formatMoney(product.costPrice)}<br>Sell: ${formatMoney(product.sellingPrice)}</td>` : ""}
          <td>${formatNumber(getQuantity(product))} ${escapeHtml(product.unit)}</td>
          <td class="product-actions">
            <button class="secondary-button small-button" type="button" data-action="edit" data-id="${product.id}">Edit</button>
            ${showPrices ? `<button class="danger-button small-button" type="button" data-action="delete" data-id="${product.id}">Delete</button>` : ""}
          </td>
        </tr>
      `).join("");
    }

    function fillForm(product) {
      productDocId.value = product.id;
      formTitle.textContent = "Edit Product";
      document.getElementById("name").value = product.name || "";
      sku.value = product.sku || "";
      document.getElementById("category").value = product.category || "";
      document.getElementById("quantity").value = product.quantity ?? 0;
      document.getElementById("unit").value = product.unit || "pcs";
      document.getElementById("costPrice").value = product.costPrice ?? 0;
      document.getElementById("sellingPrice").value = product.sellingPrice ?? 0;
      document.getElementById("lowStockLimit").value = product.lowStockLimit ?? 0;
      imageDataUrl = product.imageDataUrl || "";
      imageInput.value = "";
      imagePreview.textContent = imageDataUrl ? "" : "No image selected";
      imagePreview.style.backgroundImage = imageDataUrl ? `url("${imageDataUrl}")` : "";
      saveButton.textContent = "Update Product";
      cancelEditButton.hidden = false;
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function resetForm() {
      form.reset();
      productDocId.value = "";
      formTitle.textContent = "Add Product";
      sku.value = window.StockService.generateSku();
      imageDataUrl = "";
      imagePreview.textContent = "No image selected";
      imagePreview.style.backgroundImage = "";
      saveButton.textContent = "Save Product";
      cancelEditButton.hidden = true;
    }

    function getProductFromForm(currentImageDataUrl) {
      const name = document.getElementById("name").value.trim();
      const productSku = sku.value.trim() || window.StockService.generateSku();
      const category = document.getElementById("category").value.trim();
      const quantity = Number(document.getElementById("quantity").value || 0);
      const unit = document.getElementById("unit").value;
      const existingProduct = productDocId.value ? products.find((product) => product.id === productDocId.value) : null;
      const costPrice = canViewPrices() ? Number(document.getElementById("costPrice").value || 0) : Number(existingProduct?.costPrice || 0);
      const sellingPrice = canViewPrices() ? Number(document.getElementById("sellingPrice").value || 0) : Number(existingProduct?.sellingPrice || 0);
      const lowStockLimit = Number(document.getElementById("lowStockLimit").value || 0);

      if (!name || !category || !unit) {
        throw new Error("Product name, category, and unit are required.");
      }

      return {
        name,
        sku: productSku,
        category,
        quantity,
        stock: quantity,
        unit,
        costPrice,
        sellingPrice,
        lowStockLimit,
        imageDataUrl: currentImageDataUrl,
        status: getStockStatus({ quantity, lowStockLimit }).key
      };
    }

    function setStatus(message, isError = false) {
      status.textContent = message;
      status.classList.toggle("error", isError);
    }
  }

  function initInventoryDashboard() {
    const totalItemsCount = document.getElementById("totalItemsCount");
    const lowStockCount = document.getElementById("lowStockCount");
    const totalStockValue = document.getElementById("totalStockValue");
    const outOfStockCount = document.getElementById("outOfStockCount");
    const inventoryTableBody = document.getElementById("inventoryTableBody");
    const itemSearch = document.getElementById("itemSearch");
    const globalSearch = document.getElementById("globalSearch");
    const stockStatusFilter = document.getElementById("stockStatusFilter");
    const dateFromFilter = document.getElementById("dateFromFilter");
    const dateToFilter = document.getElementById("dateToFilter");
    const stockAlertBadge = document.getElementById("stockAlertBadge");
    const stockAlertButton = document.getElementById("stockAlertButton");
    const lowStockWarning = document.getElementById("lowStockWarning");
    const lowStockWarningText = document.getElementById("lowStockWarningText");
    const downloadLowStockPdfButton = document.getElementById("downloadLowStockPdfButton");
    const recentTransactionsBody = document.getElementById("recentTransactionsBody");
    const inventoryDetailPanel = document.getElementById("inventoryDetailPanel");
    const inventoryDetailTitle = document.getElementById("inventoryDetailTitle");
    const inventoryDetailHead = document.getElementById("inventoryDetailHead");
    const inventoryDetailBody = document.getElementById("inventoryDetailBody");
    const inventoryDetailClose = document.getElementById("inventoryDetailClose");
    let products = [];

    const render = () => {
      const searchTerm = (itemSearch?.value || globalSearch?.value || "").trim().toLowerCase();
      const statusFilter = stockStatusFilter?.value || "all";
      const dateFrom = parseDateInput(dateFromFilter?.value, "start");
      const dateTo = parseDateInput(dateToFilter?.value, "end");
      const filteredProducts = products.filter((product) => {
        const productStatus = getStockStatus(product).key;
        const productDate = getProductDate(product);
        const matchesSearch = !searchTerm || [product.name, product.sku, product.category].some((value) => String(value || "").toLowerCase().includes(searchTerm));
        const matchesStatus = statusFilter === "all" || productStatus === statusFilter;
        const matchesDateFrom = !dateFrom || productDate >= dateFrom;
        const matchesDateTo = !dateTo || productDate <= dateTo;

        return matchesSearch && matchesStatus && matchesDateFrom && matchesDateTo;
      });

      const lowProducts = products.filter((product) => getStockStatus(product).key === "low-stock");
      const outProducts = products.filter((product) => getStockStatus(product).key === "out-of-stock");
      const alertCount = lowProducts.length + outProducts.length;

      totalItemsCount.textContent = formatNumber(getTotalStockQuantity(products));
      lowStockCount.textContent = lowProducts.length;
      totalStockValue.textContent = formatMoney(products.reduce((total, product) => total + (getQuantity(product) * Number(product.costPrice || 0)), 0));
      outOfStockCount.textContent = outProducts.length;
      stockAlertBadge.textContent = alertCount;
      stockAlertButton.classList.toggle("has-alert", alertCount > 0);
      stockAlertBadge.hidden = alertCount === 0;
      lowStockWarning.hidden = alertCount === 0;

      if (alertCount > 0) {
        lowStockWarningText.textContent = `${alertCount} product${alertCount === 1 ? " is" : "s are"} at or below the minimum stock level.`;
      }

      if (!filteredProducts.length) {
        inventoryTableBody.innerHTML = `<tr><td class="empty-table" colspan="8">No inventory items added yet.</td></tr>`;
        return;
      }

      inventoryTableBody.innerHTML = filteredProducts.map((product, index) => {
        const stockStatus = getStockStatus(product);
        const updatedAt = formatDate(product.updatedAt || product.createdAt);

        return `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(product.name)}</td>
            <td>${product.imageDataUrl ? `<img class="product-thumb" src="${escapeAttribute(product.imageDataUrl)}" alt="">` : `<span class="product-thumb empty-thumb">No image</span>`}</td>
            <td>${formatNumber(getQuantity(product))} ${escapeHtml(product.unit)}</td>
            <td>${escapeHtml(product.category)}</td>
            <td>${updatedAt}</td>
            <td><span class="status ${stockStatus.className}">${stockStatus.label}</span></td>
            <td class="product-actions"><button class="secondary-button small-button" type="button" onclick="location.href='products.html'">Edit</button></td>
          </tr>
        `;
      }).join("");
    };

    itemSearch?.addEventListener("input", render);
    globalSearch?.addEventListener("input", render);
    stockStatusFilter?.addEventListener("change", render);
    dateFromFilter?.addEventListener("change", render);
    dateToFilter?.addEventListener("change", render);
    downloadLowStockPdfButton?.addEventListener("click", () => {
      const alertProducts = products.filter((product) => {
        const status = getStockStatus(product).key;
        return status === "low-stock" || status === "out-of-stock";
      });

      downloadLowStockReport(alertProducts);
    });

    document.querySelectorAll("[data-inventory-detail]").forEach((card) => {
      card.addEventListener("click", () => renderInventoryDetail(card.dataset.inventoryDetail));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          renderInventoryDetail(card.dataset.inventoryDetail);
        }
      });
    });

    inventoryDetailClose?.addEventListener("click", () => {
      inventoryDetailPanel.hidden = true;
    });

    window.StockService.subscribeProducts((items) => {
      products = items;
      render();
    }, (error) => {
      inventoryTableBody.innerHTML = `<tr><td class="empty-table" colspan="8">${escapeHtml(error.message)}</td></tr>`;
    });

    if (recentTransactionsBody) {
      subscribeRecentTransactions(recentTransactionsBody);
    }

    function renderInventoryDetail(type) {
      if (!inventoryDetailPanel || !inventoryDetailTitle || !inventoryDetailHead || !inventoryDetailBody) {
        return;
      }

      const config = getInventoryDetailConfig(type);

      if (!config) {
        return;
      }

      inventoryDetailTitle.textContent = config.title;
      inventoryDetailHead.innerHTML = config.head;
      inventoryDetailBody.innerHTML = config.body;
      inventoryDetailPanel.hidden = false;
      inventoryDetailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function getInventoryDetailConfig(type) {
      if (type === "products") {
        const stockedProducts = products.filter((product) => getQuantity(product) > 0);

        return {
          title: `Total Stock Details - ${formatNumber(getTotalStockQuantity(products))}`,
          head: "<tr><th>Product</th><th>SKU</th><th>Category</th><th>Stock</th><th>Status</th></tr>",
          body: renderInventoryProductRows(stockedProducts, "No products currently have available stock.")
        };
      }

      if (type === "lowStock") {
        const lowProducts = products.filter((product) => getStockStatus(product).key === "low-stock");

        return {
          title: "Low Stock Details",
          head: "<tr><th>Product</th><th>SKU</th><th>Category</th><th>Stock</th><th>Minimum</th></tr>",
          body: lowProducts.length ? lowProducts.map((product) => `
            <tr>
              <td>${escapeHtml(product.name)}</td>
              <td>${escapeHtml(product.sku)}</td>
              <td>${escapeHtml(product.category)}</td>
              <td>${formatNumber(getQuantity(product))} ${escapeHtml(product.unit)}</td>
              <td>${formatNumber(product.lowStockLimit || 0)} ${escapeHtml(product.unit)}</td>
            </tr>
          `).join("") : `<tr><td class="empty-table" colspan="5">No low stock products right now.</td></tr>`
        };
      }

      if (type === "stockValue") {
        const totalValue = products.reduce((total, product) => total + (getQuantity(product) * Number(product.costPrice || 0)), 0);

        return {
          title: `Stock Value Details - ${formatMoney(totalValue)}`,
          head: "<tr><th>Product</th><th>Category</th><th>Stock</th><th>Cost Price</th><th>Value</th></tr>",
          body: products.length ? products.map((product) => {
            const quantity = getQuantity(product);
            const costPrice = Number(product.costPrice || 0);

            return `
              <tr>
                <td>${escapeHtml(product.name)}</td>
                <td>${escapeHtml(product.category)}</td>
                <td>${formatNumber(quantity)} ${escapeHtml(product.unit)}</td>
                <td>${formatMoney(costPrice)}</td>
                <td>${formatMoney(quantity * costPrice)}</td>
              </tr>
            `;
          }).join("") : `<tr><td class="empty-table" colspan="5">No stock value data yet.</td></tr>`
        };
      }

      if (type === "outOfStock") {
        const outProducts = products.filter((product) => getStockStatus(product).key === "out-of-stock");

        return {
          title: "Out of Stock Details",
          head: "<tr><th>Product</th><th>SKU</th><th>Category</th><th>Stock</th><th>Status</th></tr>",
          body: renderInventoryProductRows(outProducts, "No out of stock products right now.", false)
        };
      }

      return null;
    }

    function renderInventoryProductRows(items, emptyMessage) {
      if (!items.length) {
        return `<tr><td class="empty-table" colspan="5">${emptyMessage}</td></tr>`;
      }

      return items.map((product) => {
        const stockStatus = getStockStatus(product);

        return `
          <tr>
            <td>${escapeHtml(product.name)}</td>
            <td>${escapeHtml(product.sku)}</td>
            <td>${escapeHtml(product.category)}</td>
            <td>${formatNumber(getQuantity(product))} ${escapeHtml(product.unit)}</td>
            <td><span class="status ${stockStatus.className}">${stockStatus.label}</span></td>
          </tr>
        `;
      }).join("");
    }
  }

  async function initMainDashboard() {
    const dashboardTotalProducts = document.getElementById("dashboardTotalProducts");
    const dashboardStockInCount = document.getElementById("dashboardStockInCount");
    const dashboardStockOutCount = document.getElementById("dashboardStockOutCount");
    const dashboardLowStockCount = document.getElementById("dashboardLowStockCount");
    const dashboardUsersCount = document.getElementById("dashboardUsersCount");
    const dashboardRecentActivityBody = document.getElementById("dashboardRecentActivityBody");
    const dashboardDetailPanel = document.getElementById("dashboardDetailPanel");
    const dashboardDetailTitle = document.getElementById("dashboardDetailTitle");
    const dashboardDetailHead = document.getElementById("dashboardDetailHead");
    const dashboardDetailBody = document.getElementById("dashboardDetailBody");
    const dashboardDetailClose = document.getElementById("dashboardDetailClose");
    const usersRef = collection(db, "users");
    let products = [];
    let users = [];
    let stockInItems = [];
    let stockOutItems = [];

    window.StockService.subscribeProducts((items) => {
      products = items;
      dashboardTotalProducts.textContent = formatNumber(getTotalStockQuantity(products));
      if (dashboardLowStockCount) {
        dashboardLowStockCount.textContent = products.filter((product) => {
          const status = getStockStatus(product).key;
          return status === "low-stock" || status === "out-of-stock";
        }).length;
      }
    }, (error) => {
      dashboardTotalProducts.textContent = "!";
      if (dashboardLowStockCount) {
        dashboardLowStockCount.textContent = "!";
      }
      console.error(error);
    });

    onSnapshot(query(stockInRef, orderBy("createdAt", "desc")), (snapshot) => {
      stockInItems = snapshot.docs.map((movementDoc) => movementDoc.data());
      dashboardStockInCount.textContent = snapshot.size;
      renderDashboardActivity();
    }, (error) => {
      dashboardStockInCount.textContent = "!";
      showDashboardError(error);
    });

    onSnapshot(query(stockOutRef, orderBy("createdAt", "desc")), (snapshot) => {
      stockOutItems = snapshot.docs.map((movementDoc) => movementDoc.data());
      dashboardStockOutCount.textContent = snapshot.size;
      renderDashboardActivity();
    }, (error) => {
      dashboardStockOutCount.textContent = "!";
      showDashboardError(error);
    });

    if (dashboardUsersCount && await getCurrentUserRole() === "admin") {
      onSnapshot(query(usersRef), (snapshot) => {
        users = snapshot.docs.map((userDoc) => ({
          id: userDoc.id,
          ...userDoc.data()
        }));
        dashboardUsersCount.textContent = snapshot.size;
      }, (error) => {
        dashboardUsersCount.textContent = "!";
        console.error(error);
      });
    }

    document.querySelectorAll("[data-dashboard-detail]").forEach((card) => {
      card.addEventListener("click", () => renderDashboardDetail(card.dataset.dashboardDetail));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          renderDashboardDetail(card.dataset.dashboardDetail);
        }
      });
    });

    dashboardDetailClose?.addEventListener("click", () => {
      dashboardDetailPanel.hidden = true;
    });

    function renderDashboardActivity() {
      if (!dashboardRecentActivityBody) {
        return;
      }

      const activity = [
        ...stockInItems.map((item) => ({ ...item, type: "Stock IN", statusClass: "good" })),
        ...stockOutItems.map((item) => ({ ...item, type: "Stock OUT", statusClass: "out" }))
      ].sort((first, second) => getTimestampMs(second.createdAt) - getTimestampMs(first.createdAt)).slice(0, 8);

      if (!activity.length) {
        dashboardRecentActivityBody.innerHTML = `<tr><td class="empty-table" colspan="5">No activity recorded yet.</td></tr>`;
        return;
      }

      dashboardRecentActivityBody.innerHTML = activity.map((item) => `
        <tr>
          <td>${formatMovementDate(item.movementDate, item.createdAt)}</td>
          <td><span class="status ${item.statusClass}">${item.type}</span></td>
          <td>${escapeHtml(item.productName)}</td>
          <td>${formatNumber(item.quantity)} ${escapeHtml(item.unit)}</td>
          <td>${escapeHtml(item.type === "Stock IN" ? "Added" : "Removed")}</td>
        </tr>
      `).join("");
    }

    function showDashboardError(error) {
      if (dashboardRecentActivityBody) {
        dashboardRecentActivityBody.innerHTML = `<tr><td class="empty-table" colspan="5">${escapeHtml(error.message)}</td></tr>`;
      }
    }

    function renderDashboardDetail(type) {
      if (!dashboardDetailPanel || !dashboardDetailTitle || !dashboardDetailHead || !dashboardDetailBody) {
        return;
      }

      const config = getDashboardDetailConfig(type);

      if (!config) {
        return;
      }

      dashboardDetailTitle.textContent = config.title;
      dashboardDetailHead.innerHTML = config.head;
      dashboardDetailBody.innerHTML = config.body;
      dashboardDetailPanel.hidden = false;
      dashboardDetailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function getDashboardDetailConfig(type) {
      if (type === "products") {
        const stockedProducts = products.filter((product) => getQuantity(product) > 0);

        return {
          title: `Total Stock Details - ${formatNumber(getTotalStockQuantity(products))}`,
          head: "<tr><th>Product</th><th>SKU</th><th>Category</th><th>Stock</th><th>Status</th></tr>",
          body: stockedProducts.length ? stockedProducts.map((product) => {
            const stockStatus = getStockStatus(product);

            return `
              <tr>
                <td>${escapeHtml(product.name)}</td>
                <td>${escapeHtml(product.sku)}</td>
                <td>${escapeHtml(product.category)}</td>
                <td>${formatNumber(getQuantity(product))} ${escapeHtml(product.unit)}</td>
                <td><span class="status ${stockStatus.className}">${stockStatus.label}</span></td>
              </tr>
            `;
          }).join("") : `<tr><td class="empty-table" colspan="5">No products currently have available stock.</td></tr>`
        };
      }

      if (type === "stockIn") {
        return {
          title: "Stock In Details",
          head: "<tr><th>Date</th><th>Name</th><th>Product</th><th>Quantity</th><th>Phone</th></tr>",
          body: stockInItems.length ? stockInItems.map((entry) => `
            <tr>
              <td>${formatMovementDate(entry.movementDate, entry.createdAt)}</td>
              <td>${escapeHtml(entry.contactName || entry.supplierName)}</td>
              <td>${escapeHtml(entry.productName)}</td>
              <td>${formatNumber(entry.quantity)} ${escapeHtml(entry.unit)}</td>
              <td>${escapeHtml(entry.phoneNumber)}</td>
            </tr>
          `).join("") : `<tr><td class="empty-table" colspan="5">No stock in entries yet.</td></tr>`
        };
      }

      if (type === "stockOut") {
        return {
          title: "Stock Out Details",
          head: "<tr><th>Date</th><th>Name</th><th>Product</th><th>Quantity</th><th>Phone</th></tr>",
          body: stockOutItems.length ? stockOutItems.map((entry) => `
            <tr>
              <td>${formatMovementDate(entry.movementDate, entry.createdAt)}</td>
              <td>${escapeHtml(entry.contactName)}</td>
              <td>${escapeHtml(entry.productName)}</td>
              <td>${formatNumber(entry.quantity)} ${escapeHtml(entry.unit)}</td>
              <td>${escapeHtml(entry.phoneNumber)}</td>
            </tr>
          `).join("") : `<tr><td class="empty-table" colspan="5">No stock out entries yet.</td></tr>`
        };
      }

      if (type === "users") {
        return {
          title: "Users Details",
          head: "<tr><th>Name</th><th>Email</th><th>Role</th><th>User ID</th></tr>",
          body: users.length ? users.map((user) => `
            <tr>
              <td>${escapeHtml(user.name || user.displayName || "-")}</td>
              <td>${escapeHtml(user.email || "-")}</td>
              <td>${escapeHtml(user.role || "-")}</td>
              <td>${escapeHtml(user.id)}</td>
            </tr>
          `).join("") : `<tr><td class="empty-table" colspan="4">No users found.</td></tr>`
        };
      }

      return null;
    }
  }

  async function getCurrentUserRole() {
    if (!auth.currentUser) {
      return "";
    }

    const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
    return String(userSnap.data()?.role || "").trim().toLowerCase();
  }

  function initStockInPage() {
    const form = document.getElementById("stockInForm");
    const rowsBody = document.getElementById("stockInRows");
    const addRowButton = document.getElementById("addStockInRowButton");
    const status = document.getElementById("stockInStatus");
    const saveButton = document.getElementById("saveStockInButton");
    const tableBody = document.getElementById("stockInTableBody");
    let products = [];

    window.StockService.subscribeProducts((items) => {
      products = items;
      updateProductDatalist(products);
      renderBatchRows(rowsBody, "in", products);
    }, (error) => setInlineStatus(status, error.message, true));

    subscribeMovements(stockInRef, tableBody, "supplierName", "No stock in entries yet.", {
      actionLabel: "Download",
      receiptType: "Stock In"
    });
    addBatchRow(rowsBody, "in", products);
    setDefaultDate("stockInDate");

    addRowButton.addEventListener("click", () => {
      addBatchRow(rowsBody, "in", products);
    });
    rowsBody.addEventListener("input", () => maybeAddBatchRow(rowsBody, "in", products));
    rowsBody.addEventListener("change", () => maybeAddBatchRow(rowsBody, "in", products));

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      setInlineStatus(status, "");
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";

      try {
        const entries = getBatchEntries(rowsBody, "in", getBatchDetails("stockIn"), products);

        for (const entry of entries) {
          await window.StockService.recordStockIn(entry);
        }

        form.reset();
        setDefaultDate("stockInDate");
        resetBatchRows(rowsBody, "in", products);
        setInlineStatus(status, `${entries.length} stock in entr${entries.length === 1 ? "y" : "ies"} saved.`);
      } catch (error) {
        setInlineStatus(status, error.message, true);
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = "Save All Stock In";
      }
    });
  }

  function initStockOutPage() {
    const form = document.getElementById("stockOutForm");
    const rowsBody = document.getElementById("stockOutRows");
    const addRowButton = document.getElementById("addStockOutRowButton");
    const status = document.getElementById("stockOutStatus");
    const saveButton = document.getElementById("saveStockOutButton");
    const tableBody = document.getElementById("stockOutTableBody");
    let products = [];

    window.StockService.subscribeProducts((items) => {
      products = items;
      updateProductDatalist(products);
      renderBatchRows(rowsBody, "out", products);
    }, (error) => setInlineStatus(status, error.message, true));

    subscribeMovements(stockOutRef, tableBody, "whereUsed", "No stock out entries yet.", {
      actionLabel: "Download",
      receiptType: "Stock Out"
    });
    addBatchRow(rowsBody, "out", products);
    setDefaultDate("stockOutDate");

    addRowButton.addEventListener("click", () => {
      addBatchRow(rowsBody, "out", products);
    });
    rowsBody.addEventListener("input", () => maybeAddBatchRow(rowsBody, "out", products));
    rowsBody.addEventListener("change", () => maybeAddBatchRow(rowsBody, "out", products));

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      setInlineStatus(status, "");
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";

      try {
        const entries = getBatchEntries(rowsBody, "out", getBatchDetails("stockOut"), products);

        for (const entry of entries) {
          await window.StockService.recordStockOut(entry);
        }

        await downloadStockReceipt("Stock Out", entries, products);
        form.reset();
        setDefaultDate("stockOutDate");
        resetBatchRows(rowsBody, "out", products);
        setInlineStatus(status, `${entries.length} stock out entr${entries.length === 1 ? "y" : "ies"} saved and PDF downloaded.`);
      } catch (error) {
        setInlineStatus(status, error.message, true);
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = "Save All Stock Out";
      }
    });
  }

  function addBatchRow(rowsBody, type, products = []) {
    const row = document.createElement("tr");
    row.className = "batch-entry-row";
    row.innerHTML = getBatchRowHtml(type, products);
    rowsBody.append(row);
  }

  function resetBatchRows(rowsBody, type, products = []) {
    rowsBody.innerHTML = "";
    addBatchRow(rowsBody, type, products);
  }

  function maybeAddBatchRow(rowsBody, type, products = []) {
    const rows = [...rowsBody.querySelectorAll("tr")];
    const lastRow = rows.at(-1);

    if (!lastRow || isBatchRowBlank(lastRow)) {
      return;
    }

    if (isBatchRowComplete(lastRow, products)) {
      addBatchRow(rowsBody, type, products);
    }
  }

  function renderBatchRows(rowsBody, type, products = []) {
    if (!rowsBody) {
      return;
    }

    const rows = [...rowsBody.querySelectorAll("tr")];

    if (!rows.length) {
      addBatchRow(rowsBody, type, products);
      return;
    }

    rows.forEach((row) => {
      const productValue = row.querySelector("[data-field='productSearch']")?.value || "";
      const quantityValue = row.querySelector("[data-field='quantity']")?.value || "";

      row.innerHTML = getBatchRowHtml(type, products);
      row.querySelector("[data-field='productSearch']").value = productValue;
      row.querySelector("[data-field='quantity']").value = quantityValue;
    });
  }

  function getBatchRowHtml(type, products = []) {
    return `
      <td><input data-field="productSearch" list="batchProductOptions" placeholder="Type product name, SKU, category" autocomplete="off" required></td>
      <td><input data-field="quantity" type="number" min="1" step="0.01" placeholder="0" required></td>
      <td><button class="icon-action remove-row-button" type="button" aria-label="Remove row">x</button></td>
    `;
  }

  function getBatchEntries(rowsBody, type, batchDetails, products = []) {
    const rows = [...rowsBody.querySelectorAll("tr")].filter((row) => !isBatchRowBlank(row));

    if (!rows.length) {
      throw new Error("Add at least one row.");
    }

    return rows.map((row, index) => {
      const rowNumber = index + 1;
      const productText = row.querySelector("[data-field='productSearch']").value.trim();
      const product = resolveProductFromText(productText, products);
      const quantity = Number(row.querySelector("[data-field='quantity']").value || 0);

      if (!productText) {
        throw new Error(`Row ${rowNumber}: select a product.`);
      }

      if (!product) {
        throw new Error(`Row ${rowNumber}: no matching product found.`);
      }

      if (quantity <= 0) {
        throw new Error(`Row ${rowNumber}: enter a quantity greater than zero.`);
      }

      if (type === "in") {
        return {
          ...batchDetails,
          productId: product.id,
          quantity,
          supplierName: batchDetails.contactName
        };
      }

      return {
        ...batchDetails,
        productId: product.id,
        quantity,
        whereUsed: batchDetails.address || batchDetails.contactName
      };
    });
  }

  function isBatchRowBlank(row) {
    const productText = row.querySelector("[data-field='productSearch']")?.value.trim() || "";
    const quantity = row.querySelector("[data-field='quantity']")?.value.trim() || "";

    return !productText && !quantity;
  }

  function isBatchRowComplete(row, products = []) {
    const productText = row.querySelector("[data-field='productSearch']")?.value.trim() || "";
    const quantity = Number(row.querySelector("[data-field='quantity']")?.value || 0);

    return Boolean(resolveProductFromText(productText, products)) && quantity > 0;
  }

  function updateProductDatalist(products = []) {
    let datalist = document.getElementById("batchProductOptions");

    if (!datalist) {
      datalist = document.createElement("datalist");
      datalist.id = "batchProductOptions";
      document.body.append(datalist);
    }

    datalist.innerHTML = products.map((product) => `
      <option value="${escapeAttribute(getProductSearchLabel(product))}"></option>
    `).join("");
  }

  function resolveProductFromText(productText, products = []) {
    const searchText = productText.trim().toLowerCase();

    if (!searchText) {
      return null;
    }

    const exactMatch = products.find((product) => getProductSearchLabel(product).toLowerCase() === searchText);

    if (exactMatch) {
      return exactMatch;
    }

    const matches = products.filter((product) => [
      product.name,
      product.sku,
      product.category,
      getProductSearchLabel(product)
    ].some((value) => String(value || "").toLowerCase().includes(searchText)));

    return matches.length === 1 ? matches[0] : null;
  }

  function getProductSearchLabel(product) {
    return `${product.name || "Unnamed product"} | ${product.sku || "No SKU"} | ${formatNumber(getQuantity(product))} ${product.unit || ""}`.trim();
  }

  function getBatchDetails(prefix) {
    const contactName = document.getElementById(`${prefix}Name`).value.trim();
    const phoneNumber = document.getElementById(`${prefix}Phone`).value.trim();
    const movementDate = document.getElementById(`${prefix}Date`).value;
    const address = document.getElementById(`${prefix}Address`).value.trim();

    if (!contactName) {
      throw new Error("Enter name.");
    }

    if (!movementDate) {
      throw new Error("Select date.");
    }

    if (!address) {
      throw new Error("Enter address.");
    }

    return {
      contactName,
      phoneNumber,
      movementDate,
      address
    };
  }

  function setDefaultDate(inputId) {
    const input = document.getElementById(inputId);

    if (input) {
      input.value = getTodayInputValue();
    }
  }

  document.addEventListener("click", (event) => {
    const removeButton = event.target.closest(".remove-row-button");

    if (!removeButton) {
      return;
    }

    const row = removeButton.closest("tr");
    const rowsBody = row?.parentElement;

    if (!row || !rowsBody || rowsBody.rows.length <= 1) {
      return;
    }

    row.remove();
  });

  function subscribeMovements(collectionRef, tableBody, personField, emptyMessage, options = {}) {
    const movementsQuery = query(collectionRef, orderBy("createdAt", "desc"));
    const movementsById = new Map();
    const hasPdfAction = Boolean(options.receiptType);
    const columnCount = hasPdfAction ? 5 : 4;

    if (hasPdfAction) {
      tableBody.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-action='download-receipt']");

        if (!button) {
          return;
        }

        const movement = movementsById.get(button.dataset.id);

        if (!movement) {
          return;
        }

        button.disabled = true;
        button.textContent = "Preparing...";

        try {
          await downloadStockReceipt(options.receiptType, [movement], []);
        } finally {
          button.disabled = false;
          button.textContent = options.actionLabel || "PDF";
        }
      });
    }

    onSnapshot(movementsQuery, (snapshot) => {
      if (snapshot.empty) {
        movementsById.clear();
        tableBody.innerHTML = `<tr><td class="empty-table" colspan="${columnCount}">${emptyMessage}</td></tr>`;
        return;
      }

      movementsById.clear();
      tableBody.innerHTML = snapshot.docs.map((movementDoc) => {
        const movement = {
          id: movementDoc.id,
          ...movementDoc.data()
        };
        movementsById.set(movementDoc.id, movement);

        return `
          <tr>
            <td>${formatMovementDate(movement.movementDate, movement.createdAt)}</td>
            <td>${escapeHtml(movement.contactName || movement[personField])}</td>
            <td>${escapeHtml(movement.productName)}</td>
            <td>${formatNumber(movement.quantity)} ${escapeHtml(movement.unit)}</td>
            ${hasPdfAction ? `<td><button class="secondary-button small-button" type="button" data-action="download-receipt" data-id="${escapeAttribute(movementDoc.id)}">${escapeHtml(options.actionLabel || "PDF")}</button></td>` : ""}
          </tr>
        `;
      }).join("");
    }, (error) => {
      tableBody.innerHTML = `<tr><td class="empty-table" colspan="${columnCount}">${escapeHtml(error.message)}</td></tr>`;
    });
  }

  function subscribeRecentTransactions(tableBody) {
    const recentInQuery = query(stockInRef, orderBy("createdAt", "desc"), limit(5));
    const recentOutQuery = query(stockOutRef, orderBy("createdAt", "desc"), limit(5));
    let stockInItems = [];
    let stockOutItems = [];

    const render = () => {
      const transactions = [
        ...stockInItems.map((item) => ({ ...item, type: "Stock IN", detail: item.supplierName || "-" })),
        ...stockOutItems.map((item) => ({ ...item, type: "Stock OUT", detail: item.whereUsed || "-" }))
      ].sort((first, second) => getTimestampMs(second.createdAt) - getTimestampMs(first.createdAt)).slice(0, 8);

      if (!transactions.length) {
        tableBody.innerHTML = `<tr><td class="empty-table" colspan="5">No recent transactions yet.</td></tr>`;
        return;
      }

      tableBody.innerHTML = transactions.map((transaction) => `
        <tr>
          <td>${formatMovementDate(transaction.movementDate, transaction.createdAt)}</td>
          <td><span class="status ${transaction.type === "Stock IN" ? "good" : "out"}">${transaction.type}</span></td>
          <td>${escapeHtml(transaction.productName)}</td>
          <td>${escapeHtml(transaction.detail)}</td>
          <td>${formatNumber(transaction.quantity)} ${escapeHtml(transaction.unit)}</td>
        </tr>
      `).join("");
    };

    onSnapshot(recentInQuery, (snapshot) => {
      stockInItems = snapshot.docs.map((movementDoc) => movementDoc.data());
      render();
    }, (error) => {
      tableBody.innerHTML = `<tr><td class="empty-table" colspan="5">${escapeHtml(error.message)}</td></tr>`;
    });

    onSnapshot(recentOutQuery, (snapshot) => {
      stockOutItems = snapshot.docs.map((movementDoc) => movementDoc.data());
      render();
    }, (error) => {
      tableBody.innerHTML = `<tr><td class="empty-table" colspan="5">${escapeHtml(error.message)}</td></tr>`;
    });
  }

  function initReportsPage() {
    const stockReportBody = document.getElementById("stockReportBody");
    const usageReportBody = document.getElementById("usageReportBody");
    const purchaseReportBody = document.getElementById("purchaseReportBody");
    const reportStockValue = document.getElementById("reportStockValue");
    const reportPurchaseQty = document.getElementById("reportPurchaseQty");
    const reportUsageQty = document.getElementById("reportUsageQty");
    const reportProfitLoss = document.getElementById("reportProfitLoss");
    const exportPdfButton = document.getElementById("exportPdfButton");
    const exportExcelButton = document.getElementById("exportExcelButton");
    const printStockReportButton = document.getElementById("printStockReportButton");
    const exportBackupButton = document.getElementById("exportBackupButton");
    const importBackupInput = document.getElementById("importBackupInput");
    const backupStatus = document.getElementById("backupStatus");
    let products = [];
    let purchases = [];
    let usage = [];

    const renderReports = () => {
      const productById = new Map(products.map((product) => [product.id, product]));
      const stockValue = products.reduce((total, product) => total + (getQuantity(product) * Number(product.costPrice || 0)), 0);
      const purchaseQty = purchases.reduce((total, entry) => total + Number(entry.quantity || 0), 0);
      const usageQty = usage.reduce((total, entry) => total + Number(entry.quantity || 0), 0);
      const profitLoss = usage.reduce((total, entry) => {
        const product = productById.get(entry.productId) || {};
        return total + (Number(entry.quantity || 0) * (Number(product.sellingPrice || 0) - Number(product.costPrice || 0)));
      }, 0);

      reportStockValue.textContent = formatMoney(stockValue);
      reportPurchaseQty.textContent = formatNumber(purchaseQty);
      reportUsageQty.textContent = formatNumber(usageQty);
      reportProfitLoss.textContent = formatMoney(profitLoss);

      if (!products.length) {
        stockReportBody.innerHTML = `<tr><td class="empty-table" colspan="5">No stock report data yet.</td></tr>`;
      } else {
        stockReportBody.innerHTML = products.map((product) => {
          const stockStatus = getStockStatus(product);
          const costValue = getQuantity(product) * Number(product.costPrice || 0);
          return `
            <tr>
              <td>${escapeHtml(product.name)}</td>
              <td>${escapeHtml(product.category)}</td>
              <td>${formatNumber(getQuantity(product))} ${escapeHtml(product.unit)}</td>
              <td>${formatMoney(costValue)}</td>
              <td><span class="status ${stockStatus.className}">${stockStatus.label}</span></td>
            </tr>
          `;
        }).join("");
      }

      if (!usage.length) {
        usageReportBody.innerHTML = `<tr><td class="empty-table" colspan="4">No usage report data yet.</td></tr>`;
      } else {
        usageReportBody.innerHTML = usage.map((entry) => `
          <tr>
            <td>${formatMovementDate(entry.movementDate, entry.createdAt)}</td>
            <td>${escapeHtml(entry.productName)}</td>
            <td>${escapeHtml(entry.whereUsed)}</td>
            <td>${formatNumber(entry.quantity)} ${escapeHtml(entry.unit)}</td>
          </tr>
        `).join("");
      }

      if (!purchases.length) {
        purchaseReportBody.innerHTML = `<tr><td class="empty-table" colspan="4">No purchase report data yet.</td></tr>`;
      } else {
        purchaseReportBody.innerHTML = purchases.map((entry) => `
          <tr>
            <td>${formatMovementDate(entry.movementDate, entry.createdAt)}</td>
            <td>${escapeHtml(entry.supplierName)}</td>
            <td>${escapeHtml(entry.productName)}</td>
            <td>${formatNumber(entry.quantity)} ${escapeHtml(entry.unit)}</td>
          </tr>
        `).join("");
      }
    };

    window.StockService.subscribeProducts((items) => {
      products = items;
      renderReports();
    }, (error) => {
      stockReportBody.innerHTML = `<tr><td class="empty-table" colspan="5">${escapeHtml(error.message)}</td></tr>`;
    });

    onSnapshot(query(stockInRef, orderBy("createdAt", "desc")), (snapshot) => {
      purchases = snapshot.docs.map((entryDoc) => entryDoc.data());
      renderReports();
    }, (error) => {
      purchaseReportBody.innerHTML = `<tr><td class="empty-table" colspan="4">${escapeHtml(error.message)}</td></tr>`;
    });

    onSnapshot(query(stockOutRef, orderBy("createdAt", "desc")), (snapshot) => {
      usage = snapshot.docs.map((entryDoc) => entryDoc.data());
      renderReports();
    }, (error) => {
      usageReportBody.innerHTML = `<tr><td class="empty-table" colspan="4">${escapeHtml(error.message)}</td></tr>`;
    });

    exportPdfButton?.addEventListener("click", () => {
      window.print();
    });

    printStockReportButton?.addEventListener("click", () => {
      printTable("Stock Report", stockReportBody.closest("table").outerHTML);
    });

    exportExcelButton?.addEventListener("click", () => {
      const rows = [
        ["Report", "Date", "Product", "Category / Details", "Quantity", "Value"],
        ...products.map((product) => ["Stock", "", product.name || "", product.category || "", `${formatNumber(getQuantity(product))} ${product.unit || ""}`, getQuantity(product) * Number(product.costPrice || 0)]),
        ...purchases.map((entry) => ["Purchase", formatMovementDate(entry.movementDate, entry.createdAt), entry.productName || "", entry.supplierName || "", `${formatNumber(entry.quantity)} ${entry.unit || ""}`, ""]),
        ...usage.map((entry) => ["Usage", formatMovementDate(entry.movementDate, entry.createdAt), entry.productName || "", entry.whereUsed || "", `${formatNumber(entry.quantity)} ${entry.unit || ""}`, ""])
      ];

      downloadCsv("sai-sales-reports.csv", rows);
    });

    exportBackupButton?.addEventListener("click", async () => {
      setBackupStatus("Preparing full backup...");
      exportBackupButton.disabled = true;

      try {
        const backup = await createFullBackup();
        downloadJson(`sai-sales-full-backup-${getTodayInputValue()}.json`, backup);
        setBackupStatus("Full backup downloaded.");
      } catch (error) {
        setBackupStatus(error.message, true);
      } finally {
        exportBackupButton.disabled = false;
      }
    });

    importBackupInput?.addEventListener("change", async () => {
      const file = importBackupInput.files?.[0];

      if (!file) {
        return;
      }

      const shouldImport = confirm("Import this backup? Existing documents with the same IDs will be overwritten.");
      importBackupInput.value = "";

      if (!shouldImport) {
        return;
      }

      setBackupStatus("Importing backup...");

      try {
        const backup = JSON.parse(await file.text());
        const restoredCount = await restoreFullBackup(backup);
        setBackupStatus(`${restoredCount} document${restoredCount === 1 ? "" : "s"} restored from backup.`);
      } catch (error) {
        setBackupStatus(error.message, true);
      }
    });

    function setBackupStatus(message, isError = false) {
      if (!backupStatus) {
        return;
      }

      backupStatus.textContent = message;
      backupStatus.classList.toggle("error", Boolean(isError));
    }
  }

  function fillProductSelect(select, products) {
    const currentValue = select.value;
    select.innerHTML = getProductOptions(products);
    select.value = currentValue;
  }

  function getProductOptions(products) {
    return `<option value="">Select product</option>${products.map((product) => `
      <option value="${escapeAttribute(product.id)}">${escapeHtml(product.name)} - ${formatNumber(getQuantity(product))} ${escapeHtml(product.unit)}</option>
    `).join("")}`;
  }

  function getTodayInputValue() {
    const date = new Date();
    const offsetDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    return offsetDate.toISOString().slice(0, 10);
  }

  async function downloadStockReceipt(type, entries, products) {
    const receipt = buildStockReceipt(type, entries, products);
    const fileName = `${type.toLowerCase().replace(/\s+/g, "-")}-${receipt.date || getTodayInputValue()}-${Date.now()}.pdf`;
    const jsPdf = window.jspdf?.jsPDF;

    try {
      if (!jsPdf) {
        openPrintableReceipt(receipt);
        return;
      }

      const pdf = new jsPdf({ unit: "pt", format: "a4" });
      const margin = 42;
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      let y = 48;

      const addPageIfNeeded = (height = 24) => {
        if (y + height <= pageHeight - margin) {
          return;
        }

        pdf.addPage();
        y = margin;
      };

      const addText = (text, x, options = {}) => {
        const fontSize = options.fontSize || 10;
        const lineHeight = options.lineHeight || fontSize + 6;
        const maxWidth = options.maxWidth || pageWidth - margin - x;
        const lines = pdf.splitTextToSize(String(text || "-"), maxWidth);

        pdf.setFont("helvetica", options.style || "normal");
        pdf.setFontSize(fontSize);

        lines.forEach((line) => {
          addPageIfNeeded(lineHeight);
          pdf.text(line, x, y);
          y += lineHeight;
        });
      };

      pdf.setTextColor(22, 34, 42);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(20);
      pdf.text("Sai Sales", margin, y);
      pdf.setFontSize(13);
      pdf.text(`${type} Receipt`, pageWidth - margin, y, { align: "right" });
      y += 28;

      pdf.setDrawColor(229, 234, 237);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 24;

      addText(`Name: ${receipt.name}`, margin, { fontSize: 11, style: "bold" });
      addText(`Phone Number: ${receipt.phone}`, margin, { fontSize: 11 });
      addText(`Date: ${receipt.date}`, margin, { fontSize: 11 });
      addText(`Address: ${receipt.address}`, margin, { fontSize: 11, maxWidth: pageWidth - (margin * 2) });
      addText(`Created By: ${receipt.createdBy}`, margin, { fontSize: 10 });
      y += 10;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      addPageIfNeeded(24);
      pdf.text("No.", margin, y);
      pdf.text("Product", margin + 42, y);
      pdf.text("Quantity", pageWidth - margin, y, { align: "right" });
      y += 10;
      pdf.line(margin, y, pageWidth - margin, y);
      y += 18;

      receipt.items.forEach((item, index) => {
        addPageIfNeeded(26);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(10);
        pdf.text(String(index + 1), margin, y);
        pdf.text(pdf.splitTextToSize(item.productName, 300), margin + 42, y);
        pdf.text(item.quantityText, pageWidth - margin, y, { align: "right" });
        y += 24;
      });

      y += 8;
      pdf.line(margin, y, pageWidth - margin, y);
      y += 22;
      pdf.setFont("helvetica", "bold");
      pdf.text(`Total Items: ${receipt.items.length}`, margin, y);

      pdf.save(fileName);
    } catch (error) {
      console.error(error);
      openPrintableReceipt(receipt);
    }
  }

  function downloadLowStockReport(products) {
    const title = "Low Stock Alert Report";
    const dateText = formatDate(new Date());
    const fileName = `low-stock-alert-${getTodayInputValue()}.pdf`;
    const jsPdf = window.jspdf?.jsPDF;

    try {
      if (!jsPdf) {
        openPrintableLowStockReport(title, dateText, products);
        return;
      }

      const pdf = new jsPdf({ unit: "pt", format: "a4" });
      const margin = 42;
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      let y = 48;

      const addPageIfNeeded = (height = 24) => {
        if (y + height <= pageHeight - margin) {
          return;
        }

        pdf.addPage();
        y = margin;
      };

      pdf.setTextColor(22, 34, 42);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(20);
      pdf.text("Sai Sales", margin, y);
      pdf.setFontSize(13);
      pdf.text(title, pageWidth - margin, y, { align: "right" });
      y += 26;

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.text(`Generated: ${dateText}`, margin, y);
      pdf.text(`Alert Items: ${products.length}`, pageWidth - margin, y, { align: "right" });
      y += 18;

      pdf.setDrawColor(229, 234, 237);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 24;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.text("Product", margin, y);
      pdf.text("SKU", margin + 190, y);
      pdf.text("Current", margin + 295, y);
      pdf.text("Minimum", margin + 380, y);
      pdf.text("Status", pageWidth - margin, y, { align: "right" });
      y += 10;
      pdf.line(margin, y, pageWidth - margin, y);
      y += 18;

      if (!products.length) {
        pdf.setFont("helvetica", "normal");
        pdf.text("No low stock or out of stock products right now.", margin, y);
      }

      products.forEach((product) => {
        const status = getStockStatus(product);

        addPageIfNeeded(30);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9);
        pdf.text(pdf.splitTextToSize(String(product.name || "-"), 170), margin, y);
        pdf.text(String(product.sku || "-"), margin + 190, y);
        pdf.text(`${formatNumber(getQuantity(product))} ${product.unit || ""}`.trim(), margin + 295, y);
        pdf.text(`${formatNumber(product.lowStockLimit || 0)} ${product.unit || ""}`.trim(), margin + 380, y);
        pdf.text(status.label, pageWidth - margin, y, { align: "right" });
        y += 26;
      });

      pdf.save(fileName);
    } catch (error) {
      console.error(error);
      openPrintableLowStockReport(title, dateText, products);
    }
  }

  function openPrintableLowStockReport(title, dateText, products) {
    const win = window.open("", "_blank", "width=900,height=700");

    if (!win) {
      return;
    }

    win.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>${escapeHtml(title)}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 32px; color: #16222a; }
            h1 { margin: 0 0 4px; }
            p { margin: 6px 0 18px; }
            table { width: 100%; border-collapse: collapse; margin-top: 18px; }
            th, td { border-bottom: 1px solid #e6eaed; padding: 10px; text-align: left; }
            th:last-child, td:last-child { text-align: right; }
          </style>
        </head>
        <body>
          <h1>Sai Sales</h1>
          <h2>${escapeHtml(title)}</h2>
          <p>Generated: ${escapeHtml(dateText)} | Alert Items: ${products.length}</p>
          <table>
            <thead><tr><th>Product</th><th>SKU</th><th>Current</th><th>Minimum</th><th>Status</th></tr></thead>
            <tbody>
              ${products.length ? products.map((product) => {
                const status = getStockStatus(product);
                return `
                  <tr>
                    <td>${escapeHtml(product.name)}</td>
                    <td>${escapeHtml(product.sku)}</td>
                    <td>${formatNumber(getQuantity(product))} ${escapeHtml(product.unit)}</td>
                    <td>${formatNumber(product.lowStockLimit || 0)} ${escapeHtml(product.unit)}</td>
                    <td>${escapeHtml(status.label)}</td>
                  </tr>
                `;
              }).join("") : `<tr><td colspan="5">No low stock or out of stock products right now.</td></tr>`}
            </tbody>
          </table>
          <script>window.print();<\/script>
        </body>
      </html>
    `);
    win.document.close();
  }

  function buildStockReceipt(type, entries, products) {
    const firstEntry = entries[0] || {};
    const productById = new Map(products.map((product) => [product.id, product]));

    return {
      type,
      name: firstEntry.contactName || "-",
      phone: firstEntry.phoneNumber || "-",
      date: firstEntry.movementDate || "-",
      address: firstEntry.address || "-",
      createdBy: firstEntry.createdByEmail || firstEntry.createdBy || auth.currentUser?.email || auth.currentUser?.uid || "-",
      items: entries.map((entry) => {
        const product = productById.get(entry.productId) || {};
        const unit = product.unit || entry.unit || "";

        return {
          productName: product.name || entry.productName || entry.productId || "-",
          quantityText: `${formatNumber(entry.quantity)} ${unit}`.trim()
        };
      })
    };
  }

  function openPrintableReceipt(receipt) {
    const win = window.open("", "_blank", "width=900,height=700");

    if (!win) {
      return;
    }

    win.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>${escapeHtml(receipt.type)} Receipt</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 32px; color: #16222a; }
            h1 { margin: 0 0 4px; }
            h2 { margin: 0 0 24px; color: #44505a; }
            p { margin: 6px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 24px; }
            th, td { border-bottom: 1px solid #e6eaed; padding: 10px; text-align: left; }
            th:last-child, td:last-child { text-align: right; }
          </style>
        </head>
        <body>
          <h1>Sai Sales</h1>
          <h2>${escapeHtml(receipt.type)} Receipt</h2>
          <p><strong>Name:</strong> ${escapeHtml(receipt.name)}</p>
          <p><strong>Phone Number:</strong> ${escapeHtml(receipt.phone)}</p>
          <p><strong>Date:</strong> ${escapeHtml(receipt.date)}</p>
          <p><strong>Address:</strong> ${escapeHtml(receipt.address)}</p>
          <p><strong>Created By:</strong> ${escapeHtml(receipt.createdBy)}</p>
          <table>
            <thead><tr><th>No.</th><th>Product</th><th>Quantity</th></tr></thead>
            <tbody>
              ${receipt.items.map((item, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${escapeHtml(item.productName)}</td>
                  <td>${escapeHtml(item.quantityText)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          <script>window.print();<\/script>
        </body>
      </html>
    `);
    win.document.close();
  }

  function getQuantity(product) {
    return Number(product.quantity ?? product.stock ?? 0);
  }

  function getTotalStockQuantity(products) {
    return products.reduce((total, product) => total + getQuantity(product), 0);
  }

  function getProductDate(product) {
    const timestamp = product.updatedAt || product.createdAt;

    if (!timestamp) {
      return new Date(0);
    }

    if (typeof timestamp.toDate === "function") {
      return timestamp.toDate();
    }

    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? new Date(0) : date;
  }

  function parseDateInput(value, edge) {
    if (!value) {
      return null;
    }

    const date = new Date(`${value}T${edge === "end" ? "23:59:59" : "00:00:00"}`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function getStockStatus(product) {
    const quantity = getQuantity(product);
    const lowStockLimit = Number(product.lowStockLimit || 0);

    if (quantity <= 0) {
      return {
        className: "out",
        key: "out-of-stock",
        label: "Out of Stock"
      };
    }

    if (lowStockLimit > 0 && quantity <= lowStockLimit) {
      return {
        className: "low",
        key: "low-stock",
        label: "Low Stock"
      };
    }

    return {
      className: "good",
      key: "active",
      label: "Good"
    };
  }

  function setInlineStatus(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle("error", isError);
  }

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result));
      reader.addEventListener("error", () => reject(new Error("Image could not be read.")));
      reader.readAsDataURL(file);
    });
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

  function formatMoney(value) {
    return `₹${formatNumber(value)}`;
  }

  function formatDate(timestamp) {
    if (!timestamp) {
      return "-";
    }

    const date = typeof timestamp.toDate === "function" ? timestamp.toDate() : new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString("en-IN", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "short",
      year: "numeric"
    });
  }

  function getTimestampMs(timestamp) {
    if (!timestamp) {
      return 0;
    }

    if (typeof timestamp.toMillis === "function") {
      return timestamp.toMillis();
    }

    const date = typeof timestamp.toDate === "function" ? timestamp.toDate() : new Date(timestamp);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  function formatMovementDate(dateValue, fallbackTimestamp) {
    if (!dateValue) {
      return formatDate(fallbackTimestamp);
    }

    const date = new Date(`${dateValue}T00:00:00`);

    if (Number.isNaN(date.getTime())) {
      return formatDate(fallbackTimestamp);
    }

    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("en-IN", {
      maximumFractionDigits: 2
    });
  }

  function downloadCsv(filename, rows) {
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");

    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8;" });
    const link = document.createElement("a");

    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function createFullBackup() {
    const collections = {};

    for (const collectionName of backupCollections) {
      const snapshot = await getDocs(collection(db, collectionName));
      collections[collectionName] = snapshot.docs.map((entryDoc) => ({
        id: entryDoc.id,
        data: serializeBackupValue(entryDoc.data())
      }));
    }

    return {
      app: "sai-sales-inventory",
      version: 1,
      exportedAt: new Date().toISOString(),
      collections
    };
  }

  async function restoreFullBackup(backup) {
    if (!backup || backup.app !== "sai-sales-inventory" || !backup.collections) {
      throw new Error("Invalid Sai Sales backup file.");
    }

    let restoredCount = 0;
    let batch = writeBatch(db);
    let batchSize = 0;

    const commitBatch = async () => {
      if (!batchSize) {
        return;
      }

      await batch.commit();
      batch = writeBatch(db);
      batchSize = 0;
    };

    for (const collectionName of backupCollections) {
      const documents = Array.isArray(backup.collections[collectionName]) ? backup.collections[collectionName] : [];

      for (const backupDoc of documents) {
        if (!backupDoc?.id || !backupDoc.data || typeof backupDoc.data !== "object") {
          continue;
        }

        batch.set(doc(db, collectionName, backupDoc.id), deserializeBackupValue(backupDoc.data), { merge: true });
        restoredCount += 1;
        batchSize += 1;

        if (batchSize >= 450) {
          await commitBatch();
        }
      }
    }

    await commitBatch();
    return restoredCount;
  }

  function serializeBackupValue(value) {
    if (value && typeof value.toDate === "function" && typeof value.seconds === "number") {
      return {
        __type: "timestamp",
        seconds: value.seconds,
        nanoseconds: value.nanoseconds || 0
      };
    }

    if (Array.isArray(value)) {
      return value.map(serializeBackupValue);
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, serializeBackupValue(nestedValue)]));
    }

    return value;
  }

  function deserializeBackupValue(value) {
    if (Array.isArray(value)) {
      return value.map(deserializeBackupValue);
    }

    if (value && typeof value === "object") {
      if (value.__type === "timestamp" && typeof value.seconds === "number") {
        return new Timestamp(value.seconds, value.nanoseconds || 0);
      }

      return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, deserializeBackupValue(nestedValue)]));
    }

    return value;
  }

  function printTable(title, tableHtml) {
    const printWindow = window.open("", "_blank", "width=1100,height=800");

    if (!printWindow) {
      window.print();
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
          h1 { margin: 0 0 18px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 10px; border: 1px solid #d1d5db; text-align: left; }
          th { background: #f3f4f6; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        ${tableHtml}
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll("`", "&#096;");
  }
})();
