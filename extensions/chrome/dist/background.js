// ../shared/src/background/index.ts
var STORAGE_KEYS = {
  connectedTabId: "yetibrowser:connectedTabId",
  wsPort: "yetibrowser:wsPort"
};
var DEFAULT_WS_PORT = 9010;
var connectedTabId = null;
var wsPort = DEFAULT_WS_PORT;
var socket = null;
var reconnectTimeout = null;
var keepAliveTimer = null;
chrome.runtime.onInstalled.addListener(() => {
  console.log("[yetibrowser] extension installed");
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "yetibrowser/connect") {
    const { tabId } = message;
    setConnectedTab(tabId).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message.type === "yetibrowser/disconnect") {
    clearConnectedTab().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message.type === "yetibrowser/getState") {
    sendResponse({
      tabId: connectedTabId,
      wsPort,
      socketConnected: socket?.readyState === WebSocket.OPEN
    });
    return;
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }
  if (STORAGE_KEYS.connectedTabId in changes) {
    const value = changes[STORAGE_KEYS.connectedTabId]?.newValue;
    connectedTabId = typeof value === "number" ? value : null;
    console.log("[yetibrowser] connected tab changed", connectedTabId);
  }
  if (STORAGE_KEYS.wsPort in changes) {
    const value = changes[STORAGE_KEYS.wsPort]?.newValue;
    wsPort = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_WS_PORT;
    console.log("[yetibrowser] websocket port changed", wsPort);
    reconnectWebSocket();
  }
});
void bootstrap();
async function bootstrap() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS);
  const storedTabId = stored[STORAGE_KEYS.connectedTabId];
  const storedPort = stored[STORAGE_KEYS.wsPort];
  if (typeof storedTabId === "number") {
    connectedTabId = storedTabId;
    await initializeTab(storedTabId);
  }
  if (typeof storedPort === "number" && Number.isFinite(storedPort)) {
    wsPort = storedPort;
  }
  connectWebSocket();
}
function connectWebSocket() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    return;
  }
  if (socket && socket.readyState === WebSocket.CONNECTING) {
    return;
  }
  try {
    socket = new WebSocket(`ws://localhost:${wsPort}`);
  } catch (error) {
    console.error("[yetibrowser] failed to create WebSocket", error);
    scheduleReconnect();
    return;
  }
  socket.addEventListener("open", () => {
    console.log("[yetibrowser] connected to MCP server");
    if (reconnectTimeout !== null) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    sendHello();
    startKeepAlive();
  });
  socket.addEventListener("message", (event) => {
    handleSocketMessage(event.data).catch((error) => {
      console.error("[yetibrowser] failed to handle message", error);
    });
  });
  socket.addEventListener("close", () => {
    console.warn("[yetibrowser] MCP socket closed");
    socket = null;
    stopKeepAlive();
    scheduleReconnect();
  });
  socket.addEventListener("error", (error) => {
    console.error("[yetibrowser] MCP socket error", error);
  });
}
function reconnectWebSocket() {
  if (socket) {
    try {
      socket.close();
    } catch (error) {
      console.error("[yetibrowser] failed to close socket before reconnect", error);
    }
    socket = null;
  }
  stopKeepAlive();
  connectWebSocket();
}
function scheduleReconnect() {
  if (reconnectTimeout !== null) {
    return;
  }
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    connectWebSocket();
  }, 2e3);
}
function sendHello() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  const message = {
    type: "hello",
    client: "yetibrowser-extension",
    version: chrome.runtime.getManifest().version
  };
  socket.send(JSON.stringify(message));
}
function startKeepAlive() {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const message = {
      type: "event",
      event: "heartbeat",
      payload: Date.now()
    };
    socket.send(JSON.stringify(message));
  }, 2e4);
}
function stopKeepAlive() {
  if (keepAliveTimer !== null) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}
async function handleSocketMessage(data) {
  if (!socket) {
    return;
  }
  let message;
  try {
    message = JSON.parse(String(data));
  } catch (error) {
    console.error("[yetibrowser] invalid message from server", error);
    return;
  }
  if (message.type !== "call") {
    console.warn("[yetibrowser] unsupported message type", message);
    return;
  }
  try {
    const result = await dispatchCommand(message.command, message.payload);
    respond({
      type: "result",
      id: message.id,
      command: message.command,
      ok: true,
      result
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    respond({
      type: "result",
      id: message.id,
      command: message.command,
      ok: false,
      error: messageText
    });
  }
}
function respond(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(message));
}
async function dispatchCommand(command, payload) {
  switch (command) {
    case "ping":
      return { ok: true };
    case "getUrl":
      return { url: (await ensureTab()).url ?? "about:blank" };
    case "getTitle":
      return { title: (await ensureTab()).title ?? "" };
    case "snapshot": {
      const snapshot = await captureSnapshot();
      return { snapshot };
    }
    case "navigate": {
      const { url } = payload;
      await navigateTo(url);
      return { ok: true };
    }
    case "goBack":
      await goBack();
      return { ok: true };
    case "goForward":
      await goForward();
      return { ok: true };
    case "wait": {
      const { seconds } = payload;
      await delay(seconds * 1e3);
      return { ok: true };
    }
    case "pressKey": {
      const { key } = payload;
      await simulateKeyPress(key);
      return { ok: true };
    }
    case "click": {
      const { selector, description } = payload;
      await clickElement(selector, description);
      return { ok: true };
    }
    case "hover": {
      const { selector, description } = payload;
      await hoverElement(selector, description);
      return { ok: true };
    }
    case "type": {
      const { selector, text, submit, description } = payload;
      await typeIntoElement(selector, text, submit ?? false, description);
      return { ok: true };
    }
    case "selectOption": {
      const { selector, values, description } = payload;
      await selectOptions(selector, values, description);
      return { ok: true };
    }
    case "screenshot": {
      const { fullPage } = payload;
      const { data, mimeType } = await takeScreenshot(fullPage ?? false);
      return { data, mimeType };
    }
    case "getConsoleLogs": {
      const logs = await readConsoleLogs();
      return logs;
    }
    default:
      throw new Error(`Unsupported command ${command}`);
  }
}
async function ensureTab() {
  if (connectedTabId === null) {
    throw new Error("No tab connected. Open the YetiBrowser popup and connect the target tab.");
  }
  try {
    return await chrome.tabs.get(connectedTabId);
  } catch (error) {
    console.warn("[yetibrowser] failed to get connected tab", error);
    await clearConnectedTab();
    throw new Error("Connected tab is no longer available. Reconnect from the popup and try again.");
  }
}
async function setConnectedTab(tabId) {
  await chrome.storage.local.set({ [STORAGE_KEYS.connectedTabId]: tabId });
  connectedTabId = tabId;
  await initializeTab(tabId);
}
async function clearConnectedTab() {
  await chrome.storage.local.remove(STORAGE_KEYS.connectedTabId);
  connectedTabId = null;
}
async function navigateTo(url) {
  const tab = await ensureTab();
  await chrome.tabs.update(tab.id, { url });
  await waitForTabComplete(tab.id);
  await initializeTab(tab.id);
}
async function goBack() {
  const tab = await ensureTab();
  try {
    await chrome.tabs.goBack(tab.id);
  } catch (error) {
    console.warn("[yetibrowser] unable to navigate back", error);
  }
  await waitForTabComplete(tab.id);
  await initializeTab(tab.id);
}
async function goForward() {
  const tab = await ensureTab();
  try {
    await chrome.tabs.goForward(tab.id);
  } catch (error) {
    console.warn("[yetibrowser] unable to navigate forward", error);
  }
  await waitForTabComplete(tab.id);
  await initializeTab(tab.id);
}
async function waitForTabComplete(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") {
    return;
  }
  await new Promise((resolve) => {
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}
async function captureSnapshot() {
  const tab = await ensureTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectSnapshot
  });
  const scriptResult = results[0]?.result;
  if (!scriptResult) {
    return "{}";
  }
  if (typeof scriptResult === "string") {
    return scriptResult;
  }
  return formatSnapshot(scriptResult.snapshot);
}
function collectSnapshot() {
  function computeSelector(element) {
    if (element.id) {
      return `#${element.id}`;
    }
    const parts = [];
    let current = element;
    while (current && parts.length < 5) {
      const tag = current.tagName.toLowerCase();
      const classes = (current.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 2).map((cls) => cls.replace(/[^a-zA-Z0-9_-]/g, "")).filter(Boolean);
      let part = tag;
      if (classes.length) {
        part += `.${classes.join(".")}`;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          part += `:nth-of-type(${index})`;
        }
      }
      parts.push(part);
      current = current.parentElement;
    }
    return parts.reverse().join(" > ");
  }
  function makeName(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.placeholder || element.value || element.name || element.id || element.type;
    }
    if (element instanceof HTMLSelectElement) {
      return element.options[element.selectedIndex]?.label || element.name || element.id || "select";
    }
    const text = element.textContent?.trim();
    if (text) {
      return text.slice(0, 160);
    }
    return element.getAttribute("aria-label") || element.getAttribute("title") || element.tagName.toLowerCase();
  }
  const targets = Array.from(
    document.querySelectorAll("a, button, input, textarea, select, [role='button'], [role='link']")
  );
  const entries = targets.slice(0, 100).map((element) => ({
    selector: computeSelector(element),
    role: element.getAttribute("role") ?? element.tagName.toLowerCase(),
    name: makeName(element)
  }));
  return {
    snapshot: {
      title: document.title,
      url: location.href,
      entries
    }
  };
}
function formatSnapshot(snapshot) {
  const lines = [];
  lines.push(`title: ${snapshot.title}`);
  lines.push(`url: ${snapshot.url}`);
  lines.push("elements:");
  for (const entry of snapshot.entries) {
    lines.push(`  - selector: "${entry.selector.replace(/"/g, '\\"')}"`);
    lines.push(`    role: ${entry.role}`);
    lines.push(`    name: "${entry.name.replace(/"/g, '\\"')}"`);
  }
  return lines.join("\n");
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function runInPage(func, args) {
  const tab = await ensureTab();
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func,
    args,
    world: "MAIN"
  });
  const response = execution?.result;
  if (!response) {
    throw new Error("Injected script did not return a result");
  }
  if ("error" in response) {
    throw new Error(response.error);
  }
  return response.value;
}
async function simulateKeyPress(key) {
  await runInPage(
    (keyValue) => {
      const active = document.activeElement;
      if (!active) {
        return { error: "No element is focused" };
      }
      const init = { key: keyValue, bubbles: true, cancelable: true };
      active.dispatchEvent(new KeyboardEvent("keydown", init));
      active.dispatchEvent(new KeyboardEvent("keypress", init));
      active.dispatchEvent(new KeyboardEvent("keyup", init));
      return { ok: true };
    },
    [key]
  );
}
async function clickElement(selector, description) {
  await runInPage(
    (sel, label) => {
      const element = document.querySelector(sel);
      if (!element || !(element instanceof HTMLElement)) {
        return { error: `Element not found: ${label ?? sel}` };
      }
      element.focus({ preventScroll: false });
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
      element.click();
      return { ok: true };
    },
    [selector, description ?? null]
  );
}
async function hoverElement(selector, description) {
  await runInPage(
    (sel, label) => {
      const element = document.querySelector(sel);
      if (!element || !(element instanceof HTMLElement)) {
        return { error: `Element not found: ${label ?? sel}` };
      }
      element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true }));
      element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true }));
      element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true }));
      return { ok: true };
    },
    [selector, description ?? null]
  );
}
async function typeIntoElement(selector, text, submit, description) {
  await runInPage(
    (sel, value, shouldSubmit, label) => {
      const element = document.querySelector(sel);
      if (!element || !(element instanceof HTMLElement)) {
        return { error: `Element not found: ${label ?? sel}` };
      }
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.focus({ preventScroll: false });
        element.value = value;
        element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
        element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      } else if (element.isContentEditable) {
        element.focus({ preventScroll: false });
        element.textContent = value;
        element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      } else {
        return { error: "Element is not editable" };
      }
      if (shouldSubmit) {
        const init = { key: "Enter", bubbles: true, cancelable: true };
        element.dispatchEvent(new KeyboardEvent("keydown", init));
        element.dispatchEvent(new KeyboardEvent("keyup", init));
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          element.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }
      }
      return { ok: true };
    },
    [selector, text, submit, description ?? null]
  );
}
async function selectOptions(selector, values, description) {
  await runInPage(
    (sel, valueList, label) => {
      const element = document.querySelector(sel);
      if (!(element instanceof HTMLSelectElement)) {
        return { error: `Element is not a <select>: ${label ?? sel}` };
      }
      const targets = new Set(valueList);
      let matched = 0;
      for (const option of Array.from(element.options)) {
        const shouldSelect = targets.has(option.value) || targets.has(option.label) || targets.has(option.textContent ?? "");
        if (shouldSelect) {
          option.selected = true;
          matched++;
          if (!element.multiple) {
            break;
          }
        } else if (!element.multiple) {
          option.selected = false;
        }
      }
      if (matched === 0) {
        return { error: "None of the provided values matched" };
      }
      element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      return { ok: true };
    },
    [selector, values, description ?? null]
  );
}
async function takeScreenshot(fullPage) {
  const tab = await ensureTab();
  const windowId = tab.windowId;
  if (windowId === void 0) {
    throw new Error("Unable to determine window for active tab");
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  if (!dataUrl) {
    throw new Error("Failed to capture screenshot");
  }
  const pngBlob = await fetch(dataUrl).then((response) => response.blob());
  const bitmap = await createImageBitmap(pngBlob);
  const maxWidth = 1280;
  const scale = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
  const targetWidth = Math.round(bitmap.width * scale);
  const targetHeight = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to create drawing context for screenshot");
  }
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  let outputBlob;
  let mimeType = "image/webp";
  try {
    outputBlob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
  } catch (error) {
    console.warn("[yetibrowser] webp conversion failed, falling back to jpeg", error);
    outputBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
    mimeType = "image/jpeg";
  }
  const arrayBuffer = await outputBlob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return { data: btoa(binary), mimeType };
}
async function readConsoleLogs() {
  const logs = await runInPage(() => {
    const win = window;
    const entries = Array.isArray(win.__yetibrowser?.logs) ? win.__yetibrowser.logs : [];
    return { ok: true, value: entries.slice(-200) };
  }, []);
  return logs ?? [];
}
async function initializeTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const win = window;
        if (win.__yetibrowser?.initialized) {
          return;
        }
        const maxEntries = 500;
        const state = win.__yetibrowser ?? { logs: [] };
        const logs = Array.isArray(state.logs) ? state.logs : [];
        const originals = {
          log: console.log.bind(console),
          info: console.info.bind(console),
          warn: console.warn.bind(console),
          error: console.error.bind(console)
        };
        const serialize = (value) => {
          if (typeof value === "string") {
            return value;
          }
          try {
            return JSON.stringify(value);
          } catch (error) {
            return String(value);
          }
        };
        const wrap = (level) => (...args) => {
          const message = args.map((arg) => serialize(arg)).join(" ");
          logs.push({ level, message, timestamp: Date.now() });
          if (logs.length > maxEntries) {
            logs.shift();
          }
          originals[level](...args);
        };
        console.log = wrap("log");
        console.info = wrap("info");
        console.warn = wrap("warn");
        console.error = wrap("error");
        win.__yetibrowser = {
          initialized: true,
          logs
        };
      }
    });
  } catch (error) {
    console.warn("[yetibrowser] failed to initialize tab helpers", error);
  }
}
//# sourceMappingURL=background.js.map