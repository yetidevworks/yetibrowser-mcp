// ../shared/src/popup/index.ts
var statusEl = document.getElementById("status");
var connectedTabEl = document.getElementById("connected-tab");
var serverStatusEl = document.getElementById("server-status");
var tabInfoContainer = document.getElementById("tab-info");
var nameEl = document.getElementById("tab-name");
var urlEl = document.getElementById("tab-url");
var goToTabButton = document.getElementById("go-to-tab");
var iconEl = document.getElementById("header-icon");
var connectButton = document.getElementById("connect");
var disconnectButton = document.getElementById("disconnect");
var portModeSelect = document.getElementById("port-mode");
var manualPortGroup = document.getElementById("port-manual-group");
var portSelect = document.getElementById("port-select");
var applyPortButton = document.getElementById("apply-port");
var applyTextEl = document.getElementById("apply-text");
var applySpinnerEl = document.getElementById("apply-spinner");
console.log("YetiBrowser popup loaded - NEW VERSION WITH PORT SELECT", { portSelect, applyTextEl, applySpinnerEl });
var lastError = null;
connectButton.addEventListener("click", async () => {
  lastError = null;
  try {
    const activeTab = await getActiveTab();
    if (!activeTab || activeTab.id === void 0) {
      throw new Error("Unable to determine active tab");
    }
    if (!isUrlAllowed(activeTab.url ?? "")) {
      throw new Error("This page cannot be controlled. Switch to an http(s) tab and try again.");
    }
    await chrome.runtime.sendMessage({ type: "yetibrowser/connect", tabId: activeTab.id });
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  } finally {
    await refresh();
  }
});
disconnectButton.addEventListener("click", async () => {
  lastError = null;
  try {
    await chrome.runtime.sendMessage({ type: "yetibrowser/disconnect" });
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  } finally {
    await refresh();
  }
});
portModeSelect.addEventListener("change", async () => {
  const mode = portModeSelect.value === "manual" ? "manual" : "auto";
  if (mode === "auto") {
    manualPortGroup.hidden = true;
    portSelect.disabled = true;
    applyPortButton.disabled = true;
    await applyPortConfiguration(mode);
  } else {
    manualPortGroup.hidden = false;
    portSelect.disabled = false;
    applyPortButton.disabled = false;
    portSelect.focus();
  }
});
applyPortButton.addEventListener("click", async () => {
  const portValue = Number.parseInt(portSelect.value, 10);
  if (!Number.isInteger(portValue) || portValue <= 0 || portValue > 65535) {
    lastError = "Invalid port selected";
    await refresh();
    return;
  }
  await applyPortConfiguration("manual", portValue);
});
void refresh();
async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "yetibrowser/getState" });
  const activeTab = await getActiveTab();
  const connectedTab = state?.tabId ? await chrome.tabs.get(state.tabId).catch(() => void 0) : void 0;
  updateUi(state, activeTab, connectedTab);
}
function updateUi(state, activeTab, connectedTab) {
  const { tabId, socketConnected, wsPort, portMode, socketStatus = "disconnected" } = state;
  const activeTabId = activeTab?.id ?? null;
  const isConnectedToActive = tabId !== null && tabId === activeTabId;
  connectButton.disabled = !activeTabId || isConnectedToActive || !isUrlAllowed(activeTab?.url ?? "");
  disconnectButton.disabled = tabId === null;
  goToTabButton.disabled = tabId === null;
  portModeSelect.value = portMode;
  manualPortGroup.hidden = portMode !== "manual";
  portSelect.disabled = portMode !== "manual";
  const isConnectingSocket = socketStatus === "connecting";
  applyPortButton.disabled = portMode !== "manual";
  portSelect.value = String(wsPort);
  if (tabId && connectedTab) {
    const suffix = isConnectedToActive ? " (current)" : "";
    connectedTabEl.textContent = `#${tabId}${suffix}`;
    connectedTabEl.classList.remove("error");
  } else {
    connectedTabEl.textContent = "None";
    connectedTabEl.classList.add("error");
  }
  const modeLabel = portMode === "auto" ? "auto" : "manual";
  if (socketStatus === "connecting") {
    serverStatusEl.textContent = `ws://localhost:${wsPort} (${modeLabel}) \u2014 connecting\u2026`;
    serverStatusEl.classList.add("error");
  } else if (socketConnected) {
    serverStatusEl.textContent = `ws://localhost:${wsPort} (${modeLabel})`;
    serverStatusEl.classList.remove("error");
  } else {
    serverStatusEl.textContent = `ws://localhost:${wsPort} (${modeLabel}) \u2014 not connected`;
    serverStatusEl.classList.add("error");
  }
  statusEl.classList.remove("error");
  if (lastError) {
    statusEl.textContent = lastError;
    statusEl.classList.add("error");
  } else if (socketStatus === "connecting") {
    statusEl.textContent = `Connecting to ws://localhost:${wsPort}\u2026`;
  } else if (tabId && !isConnectedToActive) {
    statusEl.textContent = "We\u2019ll interact with this tab even if another is focused.";
  } else {
    statusEl.textContent = tabId ? "Connected" : "Not connected";
    if (!tabId) {
      statusEl.classList.add("error");
    }
  }
  if (connectedTab) {
    tabInfoContainer.hidden = false;
    nameEl.textContent = truncate(connectedTab.title ?? "Untitled");
    const href = connectedTab.url ?? "";
    if (href) {
      urlEl.textContent = truncate(href, 60);
      urlEl.href = href;
      urlEl.hidden = false;
    } else {
      urlEl.textContent = "";
      urlEl.removeAttribute("href");
      urlEl.hidden = true;
    }
  } else {
    tabInfoContainer.hidden = true;
    nameEl.textContent = "";
    urlEl.textContent = "";
    urlEl.removeAttribute("href");
    urlEl.hidden = true;
  }
  iconEl.hidden = false;
}
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}
async function applyPortConfiguration(mode, port) {
  lastError = null;
  showSpinner(true);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "yetibrowser/setPortConfig",
      mode,
      port
    });
    if (!response?.ok) {
      throw new Error(response?.error ?? "Failed to update port configuration");
    }
    await waitForSocketConnection();
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  } finally {
    showSpinner(false);
    await refresh();
  }
}
async function waitForSocketConnection(maxWaitMs = 5e3) {
  const start = Date.now();
  let checkCount = 0;
  while (Date.now() - start < maxWaitMs) {
    const state = await chrome.runtime.sendMessage({ type: "yetibrowser/getState" });
    const activeTab = await getActiveTab();
    const connectedTab = state?.tabId ? await chrome.tabs.get(state.tabId).catch(() => void 0) : void 0;
    if (state) {
      updateUi(state, activeTab, connectedTab);
    }
    if (state?.socketConnected && state?.socketStatus === "open") {
      return;
    }
    const delayMs = checkCount < 10 ? 50 : checkCount < 20 ? 100 : 200;
    checkCount++;
    await delay(delayMs);
  }
}
goToTabButton.addEventListener("click", async () => {
  const state = await chrome.runtime.sendMessage({ type: "yetibrowser/getState" });
  if (!state?.tabId) {
    return;
  }
  try {
    await chrome.tabs.update(state.tabId, { active: true });
    const tab = await chrome.tabs.get(state.tabId);
    if (tab.windowId !== void 0) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    await refresh();
  }
});
function isUrlAllowed(url) {
  if (!url) {
    return false;
  }
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) {
    return false;
  }
  if (url.startsWith("edge://") || url.startsWith("about:")) {
    return false;
  }
  return true;
}
function truncate(value, max = 40) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}\u2026`;
}
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
function showSpinner(show) {
  if (show) {
    applyTextEl.hidden = true;
    applySpinnerEl.hidden = false;
    applyPortButton.disabled = true;
  } else {
    applyTextEl.hidden = false;
    applySpinnerEl.hidden = true;
    applyPortButton.disabled = false;
  }
}
//# sourceMappingURL=popup.js.map