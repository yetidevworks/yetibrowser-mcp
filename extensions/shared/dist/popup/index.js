"use strict";
const statusEl = document.getElementById("status");
const connectedTabEl = document.getElementById("connected-tab");
const serverStatusEl = document.getElementById("server-status");
const tabInfoContainer = document.getElementById("tab-info");
const nameEl = document.getElementById("tab-name");
const urlEl = document.getElementById("tab-url");
const goToTabButton = document.getElementById("go-to-tab");
const iconEl = document.getElementById("header-icon");
const connectButton = document.getElementById("connect");
const disconnectButton = document.getElementById("disconnect");
const portModeSelect = document.getElementById("port-mode");
const manualPortGroup = document.getElementById("port-manual-group");
const portInput = document.getElementById("port-input");
const applyPortButton = document.getElementById("apply-port");
let lastError = null;
connectButton.addEventListener("click", async () => {
    lastError = null;
    try {
        const activeTab = await getActiveTab();
        if (!activeTab || activeTab.id === undefined) {
            throw new Error("Unable to determine active tab");
        }
        if (!isUrlAllowed(activeTab.url ?? "")) {
            throw new Error("This page cannot be controlled. Switch to an http(s) tab and try again.");
        }
        await chrome.runtime.sendMessage({ type: "yetibrowser/connect", tabId: activeTab.id });
    }
    catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
    }
    finally {
        await refresh();
    }
});
disconnectButton.addEventListener("click", async () => {
    lastError = null;
    try {
        await chrome.runtime.sendMessage({ type: "yetibrowser/disconnect" });
    }
    catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
    }
    finally {
        await refresh();
    }
});
portModeSelect.addEventListener("change", async () => {
    const mode = portModeSelect.value === "manual" ? "manual" : "auto";
    if (mode === "auto") {
        manualPortGroup.hidden = true;
        portInput.disabled = true;
        applyPortButton.disabled = true;
        portInput.value = "";
        await applyPortConfiguration(mode);
    }
    else {
        manualPortGroup.hidden = false;
        portInput.disabled = false;
        applyPortButton.disabled = false;
        portInput.focus();
    }
});
applyPortButton.addEventListener("click", async () => {
    const trimmed = portInput.value.trim();
    const portValue = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(portValue) || portValue <= 0 || portValue > 65535) {
        lastError = "Enter a port between 1 and 65535";
        await refresh();
        return;
    }
    await applyPortConfiguration("manual", portValue);
});
void refresh();
async function refresh() {
    const state = await chrome.runtime.sendMessage({ type: "yetibrowser/getState" });
    const activeTab = await getActiveTab();
    const connectedTab = state?.tabId
        ? await chrome.tabs
            .get(state.tabId)
            .catch(() => undefined)
        : undefined;
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
    portInput.disabled = portMode !== "manual";
    const isConnectingSocket = socketStatus === "connecting";
    applyPortButton.disabled = portMode !== "manual" || isConnectingSocket;
    portInput.value = portMode === "manual" ? String(wsPort) : "";
    if (tabId && connectedTab) {
        const suffix = isConnectedToActive ? " (current)" : "";
        connectedTabEl.textContent = `#${tabId}${suffix}`;
        connectedTabEl.classList.remove("error");
    }
    else {
        connectedTabEl.textContent = "None";
        connectedTabEl.classList.add("error");
    }
    const modeLabel = portMode === "auto" ? "auto" : "manual";
    if (socketStatus === "connecting") {
        serverStatusEl.textContent = `ws://localhost:${wsPort} (${modeLabel}) — connecting…`;
        serverStatusEl.classList.add("error");
    }
    else if (socketConnected) {
        serverStatusEl.textContent = `ws://localhost:${wsPort} (${modeLabel})`;
        serverStatusEl.classList.remove("error");
    }
    else {
        serverStatusEl.textContent = `ws://localhost:${wsPort} (${modeLabel}) — not connected`;
        serverStatusEl.classList.add("error");
    }
    statusEl.classList.remove("error");
    if (lastError) {
        statusEl.textContent = lastError;
        statusEl.classList.add("error");
    }
    else if (socketStatus === "connecting") {
        statusEl.textContent = `Connecting to ws://localhost:${wsPort}…`;
    }
    else if (tabId && !isConnectedToActive) {
        statusEl.textContent = "We’ll interact with this tab even if another is focused.";
    }
    else {
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
        }
        else {
            urlEl.textContent = "";
            urlEl.removeAttribute("href");
            urlEl.hidden = true;
        }
    }
    else {
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
    try {
        const response = await chrome.runtime.sendMessage({
            type: "yetibrowser/setPortConfig",
            mode,
            port,
        });
        if (!response?.ok) {
            throw new Error(response?.error ?? "Failed to update port configuration");
        }
    }
    catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
    }
    finally {
        await refresh();
        await waitForSocketConnection();
    }
}
async function waitForSocketConnection(maxWaitMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        const state = await chrome.runtime.sendMessage({ type: "yetibrowser/getState" });
        const activeTab = await getActiveTab();
        const connectedTab = state?.tabId
            ? await chrome.tabs
                .get(state.tabId)
                .catch(() => undefined)
            : undefined;
        if (state) {
            updateUi(state, activeTab, connectedTab);
        }
        if (state?.socketStatus === "open") {
            return;
        }
        await delay(250);
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
        if (tab.windowId !== undefined) {
            await chrome.windows.update(tab.windowId, { focused: true });
        }
    }
    catch (error) {
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
    return `${value.slice(0, max - 1)}…`;
}
function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
