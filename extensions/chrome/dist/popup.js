// ../shared/src/popup/index.ts
var statusEl = document.getElementById("status");
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
  updateUi(state, activeTab);
}
function updateUi(state, activeTab) {
  const { tabId, socketConnected, wsPort } = state;
  const activeTabId = activeTab?.id ?? null;
  const isConnectedToActive = tabId !== null && tabId === activeTabId;
  connectButton.disabled = !activeTabId || isConnectedToActive || !isUrlAllowed(activeTab?.url ?? "");
  disconnectButton.disabled = tabId === null;
  const parts = [];
  if (tabId) {
    parts.push(`Connected: tab ${tabId}`);
    if (!isConnectedToActive) {
      parts.push("(switch to the connected tab to interact)");
    }
  } else {
    parts.push("No tab connected");
  }
  parts.push(socketConnected ? `Server: ws://localhost:${wsPort}` : "Server: not connected");
  if (lastError) {
    parts.push(`Error: ${lastError}`);
  }
  statusEl.textContent = parts.join("\n");
}
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}
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
//# sourceMappingURL=popup.js.map