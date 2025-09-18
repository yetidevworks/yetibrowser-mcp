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
void refresh();
async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "yetibrowser/getState" });
  const activeTab = await getActiveTab();
  const connectedTab = state?.tabId ? await chrome.tabs.get(state.tabId).catch(() => void 0) : void 0;
  updateUi(state, activeTab, connectedTab);
}
function updateUi(state, activeTab, connectedTab) {
  const { tabId, socketConnected, wsPort } = state;
  const activeTabId = activeTab?.id ?? null;
  const isConnectedToActive = tabId !== null && tabId === activeTabId;
  connectButton.disabled = !activeTabId || isConnectedToActive || !isUrlAllowed(activeTab?.url ?? "");
  disconnectButton.disabled = tabId === null;
  goToTabButton.disabled = tabId === null;
  if (tabId && connectedTab) {
    const suffix = isConnectedToActive ? " (current)" : "";
    connectedTabEl.textContent = `#${tabId}${suffix}`;
    connectedTabEl.classList.remove("error");
  } else {
    connectedTabEl.textContent = "None";
    connectedTabEl.classList.add("error");
  }
  if (socketConnected) {
    serverStatusEl.textContent = `ws://localhost:${wsPort}`;
    serverStatusEl.classList.remove("error");
  } else {
    serverStatusEl.textContent = "No server found";
    serverStatusEl.classList.add("error");
  }
  statusEl.classList.remove("error");
  if (lastError) {
    statusEl.textContent = lastError;
    statusEl.classList.add("error");
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
//# sourceMappingURL=popup.js.map