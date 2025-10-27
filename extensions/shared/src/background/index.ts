import type {
  BridgeClientMessage,
  BridgeResultMessage,
  BridgeServerMessage,
  CommandName,
  CommandPayload,
  CommandPayloadMap,
  CommandResult,
  ConsoleLogEntry,
  DomSnapshot,
  DomSnapshotEntry,
  PageStateSnapshot,
} from "@yetidevworks/shared";

const STORAGE_KEYS = {
  connectedTabId: "yetibrowser:connectedTabId",
  wsPort: "yetibrowser:wsPort",
  wsPortMode: "yetibrowser:wsPortMode",
};

const DEFAULT_WS_PORT = 9010;
const DEFAULT_PORT_MODE = "auto" satisfies PortMode;
const FALLBACK_WS_PORTS = [
  9010, 9011, 9012, 9013, 9014, 9015, 9016, 9017, 9018, 9019, 9020,
];

globalThis.addEventListener(
  "error",
  (event) => {
    const message = typeof event.message === "string" ? event.message : "";
    if (message.includes("Error in connection establishment: net::ERR_CONNECTION_REFUSED")) {
      event.preventDefault();
      if ("stopImmediatePropagation" in event && typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    }
  },
  { capture: true },
);

globalThis.onerror = (message) => {
  if (typeof message === "string" && message.includes("Error in connection establishment: net::ERR_CONNECTION_REFUSED")) {
    return true;
  }
  return false;
};

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === "string" && first.includes("WebSocket connection to 'ws://localhost:") && first.includes("Error in connection establishment: net::ERR_CONNECTION_REFUSED")) {
    return;
  }
  originalConsoleError(...args);
};
const CONNECT_ATTEMPT_TIMEOUT_MS = 1_000;
const AUTO_SCAN_FAST_DELAY_MS = 100;
const AUTO_SCAN_SLOW_DELAY_MS = 750;
const AUTO_RECOVERY_DELAY_MS = 250;
const MANUAL_RETRY_BASE_DELAY_MS = 250;
const MANUAL_RETRY_MAX_DELAY_MS = 3_000;
const FAILURE_RESET_WINDOW_MS = 10_000;

let connectedTabId: number | null = null;
let wsPort = DEFAULT_WS_PORT;
let portMode: PortMode = DEFAULT_PORT_MODE;
let socket: WebSocket | null = null;
let socketStatus: SocketStatus = "disconnected";
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

function setSocketStatus(status: SocketStatus): void {
  if (socketStatus !== status) {
    socketStatus = status;
    void updateBadge();
  }
}

class WebSocketConnectionManager {
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attemptTimer: ReturnType<typeof setTimeout> | null = null;
  private attemptId = 0;
  private expectingClose = false;
  private running = false;
  private nextAutoIndex = 0;
  private pendingInitialAutoPort: number | null = null;
  private lastSuccessfulPort: number | null = null;
  private preferLastSuccessful = false;
  private manualPort = DEFAULT_WS_PORT;
  private failurePort: number | null = null;
  private failureCount = 0;
  private lastFailureAt = 0;
  private scanIterations = 0;
  private activeSocket: WebSocket | null = null;

  initialize(mode: PortMode, port: number): void {
    if (mode === "manual") {
      this.manualPort = isValidPort(port) ? port : DEFAULT_WS_PORT;
      this.pendingInitialAutoPort = null;
    } else {
      this.manualPort = DEFAULT_WS_PORT;
      this.resetAutoSequence(port);
    }
    this.resetFailureCounters();
    this.lastSuccessfulPort = mode === "auto" && isAutoPort(port) ? port : null;
    this.preferLastSuccessful = false;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    setSocketStatus("connecting");
    this.scheduleReconnect(0, { reason: "startup", preferLastSuccessful: portMode === "auto" });
  }

  setManualMode(port: number, options: { fromStorage?: boolean } = {}): void {
    this.manualPort = port;
    this.resetFailureCounters();
    this.preferLastSuccessful = false;
    this.pendingInitialAutoPort = null;
    this.lastSuccessfulPort = null;
    if (!options.fromStorage) {
      chrome.storage.local.set({
        [STORAGE_KEYS.wsPort]: port,
        [STORAGE_KEYS.wsPortMode]: "manual",
      });
    }
    this.triggerReconnect({ immediate: true, reason: "manual" });
  }

  setAutoMode(startPort: number, options: { fromStorage?: boolean } = {}): void {
    const target = isAutoPort(startPort) ? startPort : DEFAULT_WS_PORT;
    this.resetAutoSequence(target);
    this.resetFailureCounters();
    this.preferLastSuccessful = false;
    if (!options.fromStorage) {
      chrome.storage.local.set({
        [STORAGE_KEYS.wsPort]: target,
        [STORAGE_KEYS.wsPortMode]: "auto",
      });
    }
    this.triggerReconnect({ immediate: true, reason: "auto", resetAuto: true });
  }

  updateManualPortFromStorage(port: number, options: { scheduleReconnect: boolean }): void {
    this.manualPort = port;
    this.resetFailureCounters();
    if (options.scheduleReconnect) {
      this.triggerReconnect({ immediate: true, reason: "storage-manual" });
    }
  }

  updateAutoPortFromStorage(port: number, options: { scheduleReconnect: boolean }): void {
    if (!isAutoPort(port)) {
      return;
    }
    this.resetAutoSequence(port);
    this.resetFailureCounters();
    if (options.scheduleReconnect) {
      this.triggerReconnect({ immediate: true, reason: "storage-auto", resetAuto: true });
    }
  }

  triggerReconnect(options: {
    immediate?: boolean;
    reason?: string;
    resetAuto?: boolean;
    preferLastSuccessful?: boolean;
  } = {}): void {
    if (!this.running) {
      this.start();
    }

    if (options.resetAuto && portMode === "auto") {
      this.resetAutoSequence(wsPort);
    }
    if (options.preferLastSuccessful !== undefined) {
      this.preferLastSuccessful = options.preferLastSuccessful;
    }

    setSocketStatus("connecting");
    this.teardownActiveSocket();
    const delay = options.immediate ? 0 : this.computeDelay();
    this.scheduleReconnect(delay, {
      reason: options.reason,
      preferLastSuccessful: this.preferLastSuccessful,
    });
  }

  private scheduleReconnect(
    delayMs: number,
    options: { reason?: string; resetAuto?: boolean; preferLastSuccessful?: boolean } = {},
  ): void {
    if (!this.running) {
      return;
    }

    if (options.resetAuto && portMode === "auto") {
      this.resetAutoSequence(wsPort);
    }
    if (options.preferLastSuccessful !== undefined) {
      this.preferLastSuccessful = options.preferLastSuccessful;
    }

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.beginConnection();
    }, Math.max(0, delayMs));
  }

  private beginConnection(): void {
    if (!this.running) {
      return;
    }

    const attemptToken = ++this.attemptId;
    const port = this.selectNextPort();
    wsPort = port;

    setSocketStatus("connecting");
    console.log(`[yetibrowser] connecting to ws://localhost:${port} (mode: ${portMode})`);

    let candidate: WebSocket;
    try {
      candidate = new WebSocket(`ws://localhost:${port}`);
    } catch (error) {
      console.error("[yetibrowser] failed to create WebSocket", error);
      this.handleEarlyFailure(port);
      this.scheduleReconnect(this.computeDelay(), { reason: "constructor-failed" });
      return;
    }

    this.registerAttemptTimeout(attemptToken, candidate, port);

    candidate.addEventListener("open", () => this.handleOpen(attemptToken, candidate, port));
    candidate.addEventListener("message", (event) => this.handleMessage(attemptToken, candidate, event.data));
    candidate.addEventListener("close", (event) => this.handleClose(attemptToken, candidate, port, event));
    candidate.addEventListener("error", (event) => {
      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if ("stopImmediatePropagation" in event && typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      this.handleError(attemptToken, candidate, port, event);
    });
  }

  private handleOpen(token: number, candidate: WebSocket, port: number): void {
    if (this.attemptId !== token) {
      return;
    }

    this.expectingClose = false;
    this.clearAttemptTimer();
    this.attachSocket(candidate);
    this.lastSuccessfulPort = port;
    this.preferLastSuccessful = true;
    this.scanIterations = 0;
    this.resetFailureCounters();

    if (portMode === "auto") {
      this.pendingInitialAutoPort = null;
    }

    setSocketStatus("open");

    persistWsPortIfNeeded(port).catch((error) => {
      console.error("[yetibrowser] failed to persist websocket port", error);
    });
    sendHello(candidate);
    startKeepAlive();
  }

  private handleMessage(token: number, candidate: WebSocket, data: unknown): void {
    if (this.attemptId !== token || this.activeSocket !== candidate) {
      return;
    }

    handleSocketMessage(data).catch((error) => {
      console.error("[yetibrowser] failed to handle message", error);
    });
  }

  private handleClose(token: number, candidate: WebSocket, port: number, event: CloseEvent): void {
    if (this.attemptId !== token) {
      return;
    }

    this.clearAttemptTimer();

    const wasActive = this.activeSocket === candidate;
    if (wasActive) {
      console.warn(
        "[yetibrowser] MCP socket closed",
        JSON.stringify({ code: event.code, reason: event.reason, wasClean: event.wasClean }),
      );
      this.detachSocket();
    }

    const intentional = this.expectingClose;
    this.expectingClose = false;

    if (intentional) {
      return;
    }

    this.recordFailure(port);
    setSocketStatus("connecting");
    const preferLast = wasActive && portMode === "auto";
    this.scheduleReconnect(this.computeDelay(), { reason: "close", preferLastSuccessful: preferLast });
  }

  private handleError(token: number, candidate: WebSocket, port: number, event: Event): void {
    if (this.attemptId !== token) {
      return;
    }

    this.recordFailure(port);

    if (this.activeSocket === candidate) {
      console.debug("[yetibrowser] socket error", {
        port,
        readyState: candidate.readyState,
        type: event.type,
      });
    }
  }

  private handleEarlyFailure(port: number): void {
    this.recordFailure(port);
    this.preferLastSuccessful = false;
  }

  private registerAttemptTimeout(token: number, candidate: WebSocket, port: number): void {
    this.clearAttemptTimer();
    this.attemptTimer = setTimeout(() => {
      if (this.attemptId !== token) {
        return;
      }
      if (candidate.readyState !== WebSocket.CONNECTING) {
        return;
      }
      console.warn(`[yetibrowser] connection attempt on port ${port} timed out`);
      try {
        candidate.close();
      } catch (error) {
        console.error("[yetibrowser] failed to close timed-out socket", error);
      }
    }, CONNECT_ATTEMPT_TIMEOUT_MS);
  }

  private clearAttemptTimer(): void {
    if (this.attemptTimer !== null) {
      clearTimeout(this.attemptTimer);
      this.attemptTimer = null;
    }
  }

  private attachSocket(instance: WebSocket): void {
    this.activeSocket = instance;
    socket = instance;
  }

  private detachSocket(): void {
    stopKeepAlive();
    this.activeSocket = null;
    socket = null;
  }

  private teardownActiveSocket(): void {
    this.clearAttemptTimer();
    if (this.activeSocket) {
      this.expectingClose = true;
      try {
        this.activeSocket.close();
      } catch (error) {
        console.error("[yetibrowser] failed to close socket", error);
      }
      this.detachSocket();
    }
  }

  private selectNextPort(): number {
    if (portMode === "manual") {
      return this.manualPort;
    }

    if (this.pendingInitialAutoPort !== null) {
      const initial = this.pendingInitialAutoPort;
      this.pendingInitialAutoPort = null;
      return initial;
    }

    if (this.preferLastSuccessful && this.lastSuccessfulPort !== null) {
      this.preferLastSuccessful = false;
      return this.lastSuccessfulPort;
    }

    const port = FALLBACK_WS_PORTS[this.nextAutoIndex];
    this.nextAutoIndex = (this.nextAutoIndex + 1) % FALLBACK_WS_PORTS.length;
    return port;
  }

  private resetAutoSequence(startPort: number): void {
    const target = isAutoPort(startPort) ? startPort : DEFAULT_WS_PORT;
    const startIndex = FALLBACK_WS_PORTS.indexOf(target);
    this.pendingInitialAutoPort = target;
    this.nextAutoIndex = (startIndex + 1) % FALLBACK_WS_PORTS.length;
  }

  private resetFailureCounters(): void {
    this.failurePort = null;
    this.failureCount = 0;
    this.lastFailureAt = 0;
    this.scanIterations = 0;
  }

  private recordFailure(port: number): void {
    const now = Date.now();
    if (this.failurePort !== port || now - this.lastFailureAt > FAILURE_RESET_WINDOW_MS) {
      this.failurePort = port;
      this.failureCount = 0;
    }
    this.failureCount += 1;
    this.lastFailureAt = now;

    if (this.lastSuccessfulPort === null) {
      this.scanIterations += 1;
    }

    if (portMode === "auto" && this.failureCount >= 2) {
      this.preferLastSuccessful = false;
      if (this.lastSuccessfulPort === port) {
        this.lastSuccessfulPort = null;
      }
    }
  }

  private computeDelay(): number {
    if (portMode === "manual") {
      const attempt = Math.min(
        this.failureCount + 1,
        Math.ceil(MANUAL_RETRY_MAX_DELAY_MS / MANUAL_RETRY_BASE_DELAY_MS),
      );
      return Math.min(MANUAL_RETRY_BASE_DELAY_MS * attempt, MANUAL_RETRY_MAX_DELAY_MS);
    }

    if (this.lastSuccessfulPort === null) {
      return this.scanIterations >= FALLBACK_WS_PORTS.length * 3 ? AUTO_SCAN_SLOW_DELAY_MS : AUTO_SCAN_FAST_DELAY_MS;
    }

    return this.failureCount >= 3 ? AUTO_SCAN_SLOW_DELAY_MS : AUTO_RECOVERY_DELAY_MS;
  }
}

const connectionManager = new WebSocketConnectionManager();

chrome.runtime.onInstalled.addListener(() => {
  console.log("[yetibrowser] extension installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "yetibrowser/connect") {
    const { tabId } = message as { tabId: number };
    setConnectedTab(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "yetibrowser/disconnect") {
    clearConnectedTab()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "yetibrowser/getState") {
    sendResponse({
      tabId: connectedTabId,
      wsPort,
      socketConnected: socket?.readyState === WebSocket.OPEN,
      portMode,
      socketStatus,
    });
    return;
  }

  if (message.type === "yetibrowser/setPortConfig") {
    const { mode, port } = message as { mode: PortMode; port?: number };
    void setPortConfiguration(mode, port)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }

  if (message.type === "yetibrowser/reconnect") {
    triggerManualReconnect();
    sendResponse({ ok: true });
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
  const modeChange = changes[STORAGE_KEYS.wsPortMode];
  const portChange = changes[STORAGE_KEYS.wsPort];

  if (modeChange) {
    const parsed = modeChange.newValue === "manual" ? "manual" : DEFAULT_PORT_MODE;
    if (parsed !== portMode) {
      if (parsed === "manual") {
        const rawPort = portChange?.newValue;
        const manualPort =
          typeof rawPort === "number" && Number.isFinite(rawPort) ? rawPort : wsPort;
        portMode = "manual";
        wsPort = isValidPort(manualPort) ? manualPort : DEFAULT_WS_PORT;
        connectionManager.setManualMode(wsPort, { fromStorage: true });
        setSocketStatus("connecting");
      } else {
        const rawPort = portChange?.newValue;
        const autoPort =
          typeof rawPort === "number" && Number.isFinite(rawPort) ? rawPort : wsPort;
        portMode = "auto";
        wsPort = isAutoPort(autoPort) ? autoPort : DEFAULT_WS_PORT;
        connectionManager.setAutoMode(wsPort, { fromStorage: true });
        setSocketStatus("connecting");
      }
    }
  }

  if (portChange) {
    const parsed = typeof portChange.newValue === "number" && Number.isFinite(portChange.newValue)
      ? portChange.newValue
      : DEFAULT_WS_PORT;

    if (parsed === wsPort) {
      return;
    }

    wsPort = parsed;

    if (portMode === "manual") {
      connectionManager.updateManualPortFromStorage(parsed, { scheduleReconnect: !modeChange });
    } else if (portMode === "auto") {
      connectionManager.updateAutoPortFromStorage(parsed, { scheduleReconnect: !modeChange });
    }
  }
});

void bootstrap();

async function bootstrap(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS);
  const storedTabId = stored[STORAGE_KEYS.connectedTabId];
  const storedPort = stored[STORAGE_KEYS.wsPort];
  const storedMode = stored[STORAGE_KEYS.wsPortMode];

  if (typeof storedTabId === "number") {
    connectedTabId = storedTabId;
    await initializeTab(storedTabId);
  }

  if (storedMode === "manual" || storedMode === "auto") {
    portMode = storedMode;
  }

  if (typeof storedPort === "number" && Number.isFinite(storedPort)) {
    wsPort =
      portMode === "auto" ? (isAutoPort(storedPort) ? storedPort : DEFAULT_WS_PORT) : storedPort;
  }

  connectionManager.initialize(portMode, wsPort);
  connectionManager.start();
}

function triggerManualReconnect(): void {
  const options =
    portMode === "auto"
      ? { immediate: true, reason: "manual", resetAuto: true, preferLastSuccessful: false }
      : { immediate: true, reason: "manual" };
  connectionManager.triggerReconnect(options);
}

function isAutoPort(port: number): boolean {
  return FALLBACK_WS_PORTS.includes(port);
}

async function persistWsPortIfNeeded(port: number): Promise<void> {
  if (portMode !== "auto") {
    return;
  }
  const stored = await chrome.storage.local.get(STORAGE_KEYS.wsPort);
  if (stored[STORAGE_KEYS.wsPort] === port) {
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.wsPort]: port });
}

async function setPortConfiguration(mode: PortMode, port: number | undefined): Promise<void> {
  if (mode === "manual") {
    if (!isValidPort(port)) {
      throw new Error("Port must be an integer between 1 and 65535");
    }
    portMode = "manual";
    wsPort = port!;
    connectionManager.setManualMode(port!, { fromStorage: false });
    return;
  }

  const candidate = typeof port === "number" && Number.isInteger(port) ? port : wsPort;
  portMode = "auto";
  wsPort = isAutoPort(candidate) ? candidate : DEFAULT_WS_PORT;
  connectionManager.setAutoMode(wsPort, { fromStorage: false });
}

function isValidPort(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535;
}

type PortMode = "auto" | "manual";
type SocketStatus = "disconnected" | "connecting" | "open";

function sendHello(targetSocket: WebSocket | null = socket): void {
  if (!targetSocket || targetSocket.readyState !== WebSocket.OPEN) {
    return;
  }

  const message: BridgeClientMessage = {
    type: "hello",
    client: "yetibrowser-extension",
    version: chrome.runtime.getManifest().version,
  };
  targetSocket.send(JSON.stringify(message));
}

function startKeepAlive(): void {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const message: BridgeClientMessage = {
      type: "event",
      event: "heartbeat",
      payload: Date.now(),
    };
    socket.send(JSON.stringify(message));
  }, 20_000);
}

function stopKeepAlive(): void {
  if (keepAliveTimer !== null) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

async function handleSocketMessage(data: unknown): Promise<void> {
  if (!socket) {
    return;
  }

  let message: BridgeServerMessage;
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
    const result = await dispatchCommand(message.command, message.payload as CommandPayload<CommandName>);
    respond({
      type: "result",
      id: message.id,
      command: message.command,
      ok: true,
      result,
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    respond({
      type: "result",
      id: message.id,
      command: message.command,
      ok: false,
      error: messageText,
    });
  }
}

function respond(message: BridgeResultMessage): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(message));
}

async function dispatchCommand<K extends CommandName>(
  command: K,
  payload: CommandPayload<K>,
): Promise<CommandResult<K>> {
  switch (command) {
    case "ping":
      return { ok: true } as CommandResult<K>;
    case "getUrl":
      return { url: (await ensureTab()).url ?? "about:blank" } as CommandResult<K>;
    case "getTitle":
      return { title: (await ensureTab()).title ?? "" } as CommandResult<K>;
    case "snapshot": {
      const snapshot = await captureSnapshot();
      return snapshot as CommandResult<K>;
    }
    case "navigate": {
      const { url } = payload as CommandPayloadMap["navigate"];
      await navigateTo(url);
      return { ok: true } as CommandResult<K>;
    }
    case "goBack":
      await goBack();
      return { ok: true } as CommandResult<K>;
    case "goForward":
      await goForward();
      return { ok: true } as CommandResult<K>;
    case "wait": {
      const { seconds } = payload as CommandPayloadMap["wait"];
      await delay(seconds * 1000);
      return { ok: true } as CommandResult<K>;
    }
    case "pressKey": {
      const { key } = payload as CommandPayloadMap["pressKey"];
      await simulateKeyPress(key);
      return { ok: true } as CommandResult<K>;
    }
    case "click": {
      const { selector, description } = payload as CommandPayloadMap["click"];
      await clickElement(selector, description);
      return { ok: true } as CommandResult<K>;
    }
    case "hover": {
      const { selector, description } = payload as CommandPayloadMap["hover"];
      await hoverElement(selector, description);
      return { ok: true } as CommandResult<K>;
    }
    case "type": {
      const { selector, text, submit, description } = payload as CommandPayloadMap["type"];
      await typeIntoElement(selector, text, submit ?? false, description);
      return { ok: true } as CommandResult<K>;
    }
    case "selectOption": {
      const { selector, values, description } = payload as CommandPayloadMap["selectOption"];
      await selectOptions(selector, values, description);
      return { ok: true } as CommandResult<K>;
    }
    case "screenshot": {
      const { fullPage } = payload as CommandPayloadMap["screenshot"];
      const { data, mimeType } = await takeScreenshot(fullPage ?? false);
      return { data, mimeType } as CommandResult<K>;
    }
    case "getConsoleLogs": {
      const logs = await readConsoleLogs();
      return logs as CommandResult<K>;
    }
    case "pageState": {
      const state = await capturePageState();
      return state as CommandResult<K>;
    }
    case "waitFor": {
      const { selector, timeoutMs, visible } = payload as CommandPayloadMap["waitFor"];
      await waitForSelector(selector, timeoutMs ?? 5_000, visible ?? false);
      return { ok: true } as CommandResult<K>;
    }
    case "fillForm": {
      const { fields } = payload as CommandPayloadMap["fillForm"];
      const result = await fillFormFields(fields ?? []);
      return result as CommandResult<K>;
    }
    case "evaluate": {
      const { script, args, timeoutMs } = payload as CommandPayloadMap["evaluate"];
      const evaluationPromise = evaluateInPage(script, args);
      const value =
        typeof timeoutMs === "number" && timeoutMs > 0
          ? await Promise.race([
              evaluationPromise,
              new Promise<unknown>((_, reject) =>
                setTimeout(
                  () => reject(new Error(`Script evaluation timed out after ${timeoutMs}ms`)),
                  timeoutMs,
                ),
              ),
            ])
          : await evaluationPromise;
      return { value } as CommandResult<K>;
    }
    case "handleDialog": {
      const { action, promptText } = payload as CommandPayloadMap["handleDialog"];
      await handleJavaScriptDialog(action, promptText);
      return { ok: true } as CommandResult<K>;
    }
    case "drag": {
      const { fromSelector, toSelector, steps, description } = payload as CommandPayloadMap["drag"];
      await dragElement(fromSelector, toSelector, steps ?? 12, description);
      return { ok: true } as CommandResult<K>;
    }
    default:
      throw new Error(`Unsupported command ${command satisfies never}`);
  }
}

async function ensureTab(): Promise<chrome.tabs.Tab> {
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

async function setConnectedTab(tabId: number): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.connectedTabId]: tabId });
  connectedTabId = tabId;
  await initializeTab(tabId);
  void updateBadge();
}

async function clearConnectedTab(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.connectedTabId);
  connectedTabId = null;
  void updateBadge();
}

async function navigateTo(url: string): Promise<void> {
  const tab = await ensureTab();
  await chrome.tabs.update(tab.id!, { url });
  await waitForTabComplete(tab.id!);
  await initializeTab(tab.id!);
}

async function goBack(): Promise<void> {
  const tab = await ensureTab();
  try {
    await chrome.tabs.goBack(tab.id!);
  } catch (error) {
    console.warn("[yetibrowser] unable to navigate back", error);
  }
  await waitForTabComplete(tab.id!);
  await initializeTab(tab.id!);
}

async function goForward(): Promise<void> {
  const tab = await ensureTab();
  try {
    await chrome.tabs.goForward(tab.id!);
  } catch (error) {
    console.warn("[yetibrowser] unable to navigate forward", error);
  }
  await waitForTabComplete(tab.id!);
  await initializeTab(tab.id!);
}

async function waitForTabComplete(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") {
    return;
  }

  await new Promise<void>((resolve) => {
    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function captureSnapshot(): Promise<{ formatted: string; raw: DomSnapshot }> {
  const tab = await ensureTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: collectSnapshot,
  });

  const scriptResult = results[0]?.result as { snapshot: DomSnapshot } | string | undefined;
  if (!scriptResult || typeof scriptResult === "string") {
    const fallback: DomSnapshot = {
      title: tab.title ?? "",
      url: tab.url ?? "about:blank",
      capturedAt: new Date().toISOString(),
      entries: [],
    };
    return {
      formatted: typeof scriptResult === "string" ? scriptResult : formatSnapshot(fallback),
      raw: fallback,
    };
  }

  const snapshot = scriptResult.snapshot;
  if (!snapshot.capturedAt) {
    snapshot.capturedAt = new Date().toISOString();
  }
  return {
    formatted: formatSnapshot(snapshot),
    raw: snapshot,
  };
}

async function capturePageState(): Promise<PageStateSnapshot> {
  const fallback: PageStateSnapshot = {
    forms: [],
    localStorage: [],
    sessionStorage: [],
    cookies: [],
    capturedAt: new Date().toISOString(),
  };

  const response = await runInPage(() => {
    const computeSelector = (element: Element): string => {
      if (element.id) {
        return `#${element.id}`;
      }

      const parts: string[] = [];
      let current: Element | null = element;

      while (current && parts.length < 5) {
        const tag = current.tagName.toLowerCase();
        const classes = (current.className || "")
          .toString()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((cls) => cls.replace(/[^a-zA-Z0-9_-]/g, ""))
          .filter(Boolean);
        let part = tag;
        if (classes.length) {
          part += `.${classes.join(".")}`;
        }
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((child) => child.tagName === current!.tagName);
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            part += `:nth-of-type(${index})`;
          }
        }
        parts.push(part);
        current = current.parentElement;
      }

      return parts.reverse().join(" > ");
    };

    const readStorage = (storage: Storage) => {
      const entries: Array<{ key: string; value: string }> = [];
      const limit = Math.min(storage.length, 100);
      for (let index = 0; index < limit; index += 1) {
        const key = storage.key(index);
        if (!key) {
          continue;
        }
        try {
          const value = storage.getItem(key) ?? "";
          entries.push({ key, value });
        } catch (error) {
          entries.push({ key, value: "<unavailable>" });
        }
      }
      return entries;
    };

    const readCookies = () => {
      const raw = document.cookie;
      if (!raw) {
        return [] as Array<{ key: string; value: string }>;
      }
      return raw.split(";").slice(0, 50).map((part) => {
        const [name, ...rest] = part.split("=");
        return { key: name.trim(), value: rest.join("=").trim() };
      });
    };

    const forms = Array.from(document.querySelectorAll("form"))
      .slice(0, 25)
      .map((form) => {
        const fields: Array<{ selector: string; name?: string; type?: string; value?: string; label?: string }> = [];
        const elements = Array.from(form.elements ?? []).slice(0, 50);

        for (const element of elements) {
          if (
            !(
              element instanceof HTMLInputElement ||
              element instanceof HTMLTextAreaElement ||
              element instanceof HTMLSelectElement
            )
          ) {
            continue;
          }

          const selector = computeSelector(element);
          const base: { selector: string; name?: string; type?: string; value?: string; label?: string } = {
            selector,
            name: element.getAttribute("name") ?? undefined,
          };

          if (element instanceof HTMLInputElement) {
            base.type = element.type;
            if (element.type === "password") {
              base.value = "[redacted]";
            } else if (element.type === "file") {
              base.value = element.files?.length ? `${element.files.length} file(s)` : "";
            } else {
              base.value = element.value;
            }
            base.label = element.labels?.[0]?.innerText.trim() || element.placeholder || undefined;
          } else if (element instanceof HTMLTextAreaElement) {
            base.type = "textarea";
            base.value = element.value;
            base.label = element.labels?.[0]?.innerText.trim() || element.placeholder || undefined;
          } else if (element instanceof HTMLSelectElement) {
            base.type = "select";
            base.value = Array.from(element.selectedOptions)
              .map((option) => option.value || option.label)
              .join(", ");
            base.label = element.labels?.[0]?.innerText.trim() || undefined;
          }

          fields.push(base);
        }

        return {
          selector: computeSelector(form),
          name: form.getAttribute("name") ?? undefined,
          method: form.getAttribute("method")?.toUpperCase() ?? undefined,
          action: form.getAttribute("action") ?? undefined,
          fields,
        };
      });

    const snapshot: PageStateSnapshot = {
      forms,
      localStorage: readStorage(window.localStorage),
      sessionStorage: readStorage(window.sessionStorage),
      cookies: readCookies(),
      capturedAt: new Date().toISOString(),
    };

    return { ok: true, value: snapshot } as const;
  }, []);

  return response ?? fallback;
}

function collectSnapshot(): { snapshot: DomSnapshot } {
  function computeSelector(element: Element): string {
    if (element.id) {
      return `#${element.id}`;
    }

    const parts: string[] = [];
    let current: Element | null = element;

    while (current && parts.length < 5) {
      const tag = current.tagName.toLowerCase();
      const classes = (current.className || "")
        .toString()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((cls) => cls.replace(/[^a-zA-Z0-9_-]/g, ""))
        .filter(Boolean);
      let part = tag;
      if (classes.length) {
        part += `.${classes.join(".")}`;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current!.tagName);
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

  function makeName(element: Element): string {
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
    document.querySelectorAll("a, button, input, textarea, select, [role='button'], [role='link']"),
  ) as Element[];

  const entries: DomSnapshotEntry[] = targets.slice(0, 100).map((element) => ({
    selector: computeSelector(element),
    role: element.getAttribute("role") ?? element.tagName.toLowerCase(),
    name: makeName(element),
  }));

  return {
    snapshot: {
      title: document.title,
      url: location.href,
      capturedAt: new Date().toISOString(),
      entries,
    },
  };
}

function formatSnapshot(snapshot: DomSnapshot): string {
  const lines: string[] = [];
  lines.push(`title: ${snapshot.title}`);
  lines.push(`url: ${snapshot.url}`);
  lines.push(`capturedAt: ${snapshot.capturedAt}`);
  lines.push("elements:");
  for (const entry of snapshot.entries) {
    lines.push(`  - selector: "${entry.selector.replace(/"/g, '\\"')}"`);
    lines.push(`    role: ${entry.role}`);
    lines.push(`    name: "${entry.name.replace(/"/g, '\\"')}"`);
  }
  return lines.join("\n");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ScriptResponse<R> = { ok: true; value?: R } | { error: string };

type FillFormFieldRequest = CommandPayloadMap["fillForm"]["fields"][number];

async function runInPage<A extends unknown[], R>(
  func: (...args: A) => ScriptResponse<R> | Promise<ScriptResponse<R>>,
  args: A,
): Promise<R | undefined> {
  const tab = await ensureTab();
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func,
    args,
    world: "MAIN",
  });

  const response = execution?.result as ScriptResponse<R> | undefined;
  if (!response) {
    throw new Error("Injected script did not return a result");
  }
  if ("error" in response) {
    throw new Error(response.error);
  }
  return response.value;
}

async function waitForSelector(
  selector: string,
  timeoutMs: number,
  requireVisible: boolean,
): Promise<void> {
  await runInPage(
    (sel: string, timeout: number, visible: boolean) => {
      const deadline = timeout > 0 ? Date.now() + timeout : Number.POSITIVE_INFINITY;
      const visibilityCheck = (element: Element) => {
        if (!visible) {
          return true;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          return false;
        }
        const style = window.getComputedStyle(element);
        if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) {
          return false;
        }
        return true;
      };

      const locate = () => {
        const element = document.querySelector(sel);
        if (!element) {
          return null;
        }
        if (!visibilityCheck(element)) {
          return null;
        }
        return element;
      };

      return new Promise<ScriptResponse<void>>((resolve) => {
        const existing = locate();
        if (existing) {
          resolve({ ok: true });
          return;
        }

        const abort = () => {
          observer.disconnect();
          clearInterval(intervalId);
        };

        const observer = new MutationObserver(() => {
          const match = locate();
          if (match) {
            abort();
            resolve({ ok: true });
          }
        });

        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: visible,
          attributeFilter: visible ? ["style", "class", "hidden", "aria-hidden"] : undefined,
        });

        const intervalId = window.setInterval(() => {
          const match = locate();
          if (match) {
            abort();
            resolve({ ok: true });
            return;
          }
          if (Date.now() > deadline) {
            abort();
            resolve({ error: `Timed out after ${timeout}ms waiting for selector ${sel}` });
          }
        }, 50);

        if (!Number.isFinite(deadline)) {
          // No timeout configured; keep a lightweight RAF poll to ensure resolution.
          const frameCheck = () => {
            const match = locate();
            if (match) {
              abort();
              resolve({ ok: true });
              return;
            }
            window.requestAnimationFrame(frameCheck);
          };
          window.requestAnimationFrame(frameCheck);
        }
      });
    },
    [selector, timeoutMs, requireVisible],
  );
}

async function fillFormFields(
  fields: FillFormFieldRequest[],
): Promise<{ filled: number; attempted: number; errors: string[] }> {
  let filled = 0;
  const errors: string[] = [];
  const submitSelectors = new Set<string>();

  for (const field of fields) {
    try {
      const description = field.description ?? field.selector;
      const targetType = field.type ?? "auto";

      if (Array.isArray(field.values) && field.values.length > 0) {
        await selectOptions(field.selector, field.values, field.description);
        filled++;
      } else if (targetType === "select" && typeof field.value !== "undefined") {
        await selectOptions(field.selector, [String(field.value)], field.description);
        filled++;
      } else if (typeof field.value === "boolean" || targetType === "checkbox") {
        const desired = typeof field.value === "boolean" ? field.value : coerceBoolean(field.value);
        await setCheckboxState(field.selector, desired, description);
        filled++;
      } else if (targetType === "radio") {
        await setRadioState(field.selector, field.value, description);
        filled++;
      } else {
        const text =
          field.value === null || typeof field.value === "undefined" ? "" : String(field.value);
        await typeIntoElement(field.selector, text, false, field.description);
        filled++;
      }

      if (field.submit) {
        submitSelectors.add(field.selector);
      }
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : `Failed to fill ${field.selector}: ${String(error)}`,
      );
    }
  }

  for (const selector of submitSelectors) {
    try {
      await submitContainingForm(selector);
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : `Failed to submit form for ${selector}: ${String(error)}`,
      );
    }
  }

  return { filled, attempted: fields.length, errors };
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["true", "1", "yes", "on"].includes(normalized);
  }
  return false;
}

async function setCheckboxState(selector: string, checked: boolean, description?: string): Promise<void> {
  await runInPage(
    (sel: string, state: boolean, label: string | null) => {
      const element = document.querySelector(sel);
      if (!(element instanceof HTMLInputElement) || element.type !== "checkbox") {
        return { error: `Element is not a checkbox: ${label ?? sel}` };
      }
      if (element.checked === state) {
        return { ok: true };
      }
      element.checked = state;
      element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      return { ok: true };
    },
    [selector, checked, description ?? null],
  );
}

async function setRadioState(selector: string, value: unknown, description?: string): Promise<void> {
  await runInPage(
    (sel: string, selected: unknown, label: string | null) => {
      const element = document.querySelector(sel);
      if (!(element instanceof HTMLInputElement) || element.type !== "radio") {
        return { error: `Element is not a radio button: ${label ?? sel}` };
      }
      if (typeof selected === "string" || typeof selected === "number") {
        const stringValue = String(selected);
        element.checked = element.value === stringValue;
      } else if (typeof selected === "boolean") {
        element.checked = selected;
      } else {
        element.checked = true;
      }
      element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      return { ok: true };
    },
    [selector, value, description ?? null],
  );
}

async function submitContainingForm(selector: string): Promise<void> {
  await runInPage(
    (sel: string) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }
      const form =
        element instanceof HTMLFormElement
          ? element
          : element.closest("form") ?? undefined;
      if (!form) {
        return { error: "No containing form to submit" };
      }
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        form.submit();
      }
      return { ok: true };
    },
    [selector],
  );
}

async function evaluateInPage(
  script: string,
  args: unknown[] | undefined,
): Promise<unknown> {
  return await runInPage(
    async (source: string, functionArgs: unknown[]) => {
      let fn: unknown;
      try {
        fn = globalThis.eval(`(${source})`);
      } catch (error) {
        return {
          error: `Failed to parse script: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      if (typeof fn !== "function") {
        return { error: "Script must evaluate to a function" };
      }

      try {
        const result = await (fn as (...innerArgs: unknown[]) => unknown)(...functionArgs);
        let cloned: unknown;
        if (typeof structuredClone === "function") {
          cloned = structuredClone(result);
        } else {
          cloned = JSON.parse(JSON.stringify(result));
        }
        return { ok: true, value: cloned };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    [script, args ?? []],
  );
}

async function handleJavaScriptDialog(action: "accept" | "dismiss", promptText?: string): Promise<void> {
  const tab = await ensureTab();
  const target: chrome.debugger.Debuggee = { tabId: tab.id! };
  await attachDebugger(target);
  try {
    await sendDebuggerCommand(target, "Page.enable");
    await sendDebuggerCommand(target, "Page.handleJavaScriptDialog", {
      accept: action === "accept",
      promptText,
    });
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : `Failed to handle dialog: ${String(error)}`,
    );
  } finally {
    await detachDebugger(target);
  }
}

async function dragElement(
  fromSelector: string,
  toSelector: string,
  steps: number,
  description?: string,
): Promise<void> {
  const resolvedSteps =
    typeof steps === "number" && Number.isFinite(steps) ? Math.max(1, Math.floor(steps)) : 12;
  await runInPage(
    (
      sourceSelector: string,
      targetSelector: string,
      stepCount: number,
      label: string | null,
    ) => {
      const source = document.querySelector(sourceSelector);
      const target = document.querySelector(targetSelector);
      if (!source || !(source instanceof HTMLElement)) {
        return { error: `Drag source not found: ${label ?? sourceSelector}` };
      }
      if (!target || !(target instanceof HTMLElement)) {
        return { error: `Drop target not found: ${label ?? targetSelector}` };
      }

      const startRect = source.getBoundingClientRect();
      const endRect = target.getBoundingClientRect();
      const startX = startRect.left + startRect.width / 2;
      const startY = startRect.top + startRect.height / 2;
      const endX = endRect.left + endRect.width / 2;
      const endY = endRect.top + endRect.height / 2;

      const dataTransfer = typeof DataTransfer === "function" ? new DataTransfer() : undefined;
      const pointerId = 1;

      const firePointerEvent = (type: string, x: number, y: number, buttons: number) => {
        const targetElement = document.elementFromPoint(x, y) as HTMLElement | null;
        (targetElement ?? document.body).dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId,
            pointerType: "mouse",
            clientX: x,
            clientY: y,
            buttons,
          }),
        );
      };

      const fireDragEvent = (element: HTMLElement, type: string, x: number, y: number) => {
        if (typeof DragEvent !== "function") {
          return;
        }
        element.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer,
          }),
        );
      };

      firePointerEvent("pointerover", startX, startY, 0);
      firePointerEvent("pointerenter", startX, startY, 0);
      firePointerEvent("pointerdown", startX, startY, 1);
      source.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          clientX: startX,
          clientY: startY,
          buttons: 1,
        }),
      );
      fireDragEvent(source, "dragstart", startX, startY);

      const totalSteps =
        typeof stepCount === "number" && Number.isFinite(stepCount) && stepCount > 0
          ? Math.floor(stepCount)
          : 12;
      for (let i = 1; i <= totalSteps; i++) {
        const progress = i / totalSteps;
        const currentX = startX + (endX - startX) * progress;
        const currentY = startY + (endY - startY) * progress;
        firePointerEvent("pointermove", currentX, currentY, 1);
        fireDragEvent(target, "dragover", currentX, currentY);
      }

      fireDragEvent(target, "drop", endX, endY);
      firePointerEvent("pointerup", endX, endY, 0);
      target.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          clientX: endX,
          clientY: endY,
          buttons: 0,
        }),
      );
      firePointerEvent("pointerout", endX, endY, 0);
      firePointerEvent("pointerleave", endX, endY, 0);

      return { ok: true };
    },
    [fromSelector, toSelector, resolvedSteps, description ?? null],
  );
}

async function simulateKeyPress(key: string): Promise<void> {
  await runInPage(
    (keyValue: string) => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) {
        return { error: "No element is focused" };
      }
      const init: KeyboardEventInit = { key: keyValue, bubbles: true, cancelable: true };
      active.dispatchEvent(new KeyboardEvent("keydown", init));
      active.dispatchEvent(new KeyboardEvent("keypress", init));
      active.dispatchEvent(new KeyboardEvent("keyup", init));
      return { ok: true };
    },
    [key],
  );
}

async function clickElement(selector: string, description?: string): Promise<void> {
  await runInPage(
    (sel: string, label: string | null) => {
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
    [selector, description ?? null],
  );
}

async function hoverElement(selector: string, description?: string): Promise<void> {
  await runInPage(
    (sel: string, label: string | null) => {
      const element = document.querySelector(sel);
      if (!element || !(element instanceof HTMLElement)) {
        return { error: `Element not found: ${label ?? sel}` };
      }
      element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true }));
      element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true }));
      element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true }));
      return { ok: true };
    },
    [selector, description ?? null],
  );
}

async function typeIntoElement(
  selector: string,
  text: string,
  submit: boolean,
  description?: string,
): Promise<void> {
  await runInPage(
    (sel: string, value: string, shouldSubmit: boolean, label: string | null) => {
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
        const init: KeyboardEventInit = { key: "Enter", bubbles: true, cancelable: true };
        element.dispatchEvent(new KeyboardEvent("keydown", init));
        element.dispatchEvent(new KeyboardEvent("keyup", init));
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          element.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }
      }

      return { ok: true };
    },
    [selector, text, submit, description ?? null],
  );
}

async function selectOptions(selector: string, values: string[], description?: string): Promise<void> {
  await runInPage(
    (sel: string, valueList: string[], label: string | null) => {
      const element = document.querySelector(sel);
      if (!(element instanceof HTMLSelectElement)) {
        return { error: `Element is not a <select>: ${label ?? sel}` };
      }

      const targets = new Set(valueList);
      let matched = 0;
      for (const option of Array.from(element.options)) {
        const shouldSelect =
          targets.has(option.value) || targets.has(option.label) || targets.has(option.textContent ?? "");
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
    [selector, values, description ?? null],
  );
}

async function takeScreenshot(fullPage: boolean): Promise<{ data: string; mimeType: string }> {
  const tab = await ensureTab();
  let base64: string | undefined;

  if (canUseDebugger()) {
    try {
      base64 = await captureScreenshotWithDebugger(tab.id!, fullPage);
    } catch (error) {
      console.warn("[yetibrowser] debugger capture failed, falling back", error);
    }
  }

  if (!base64) {
    base64 = await captureVisibleTabFallback(tab.windowId!);
  }

  return await encodeScreenshot(base64);
}

function canUseDebugger(): boolean {
  const manifest = chrome.runtime.getManifest();
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const optionalPermissions = Array.isArray(manifest.optional_permissions) ? manifest.optional_permissions : [];
  if (!permissions.includes("debugger") && !optionalPermissions.includes("debugger")) {
    return false;
  }
  return typeof chrome.debugger?.attach === "function";
}

const DEBUGGER_PROTOCOL_VERSION = "1.3";

async function captureScreenshotWithDebugger(tabId: number, fullPage: boolean): Promise<string | undefined> {
  const target: chrome.debugger.Debuggee = { tabId };
  await attachDebugger(target);
  let metricsOverridden = false;

  try {
    await sendDebuggerCommand(target, "Page.enable");

    if (fullPage) {
      try {
        const metrics = await sendDebuggerCommand<{ contentSize?: { width?: number; height?: number } }>(
          target,
          "Page.getLayoutMetrics",
        );
        const width = Math.ceil(metrics.contentSize?.width ?? 0);
        const height = Math.ceil(metrics.contentSize?.height ?? 0);
        if (width > 0 && height > 0) {
          await sendDebuggerCommand(target, "Emulation.setDeviceMetricsOverride", {
            mobile: false,
            deviceScaleFactor: 1,
            width,
            height,
            screenWidth: width,
            screenHeight: height,
            viewport: {
              x: 0,
              y: 0,
              width,
              height,
              scale: 1,
            },
          });
          metricsOverridden = true;
        }
      } catch (error) {
        console.warn("[yetibrowser] layout metrics unavailable, skipping full-page override", error);
      }
    }

    const screenshot = await sendDebuggerCommand<{ data: string }>(target, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: fullPage,
    });

    if (metricsOverridden) {
      await sendDebuggerCommand(target, "Emulation.clearDeviceMetricsOverride");
    }

    return screenshot.data;
  } finally {
    await detachDebugger(target);
  }
}

async function captureVisibleTabFallback(windowId: number): Promise<string> {
  if (windowId === undefined) {
    throw new Error("Unable to determine window for active tab");
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!result) {
        reject(new Error("Failed to capture screenshot"));
        return;
      }
      resolve(result);
    });
  });

  const [, base64] = dataUrl.split(",");
  if (!base64) {
    throw new Error("Unexpected screenshot data format");
  }
  return base64;
}

async function attachDebugger(target: chrome.debugger.Debuggee): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    chrome.debugger.attach(target, DEBUGGER_PROTOCOL_VERSION, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        if (error.message?.includes("Another debugger is already attached")) {
          resolve();
          return;
        }
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

async function detachDebugger(target: chrome.debugger.Debuggee): Promise<void> {
  await new Promise<void>((resolve) => {
    chrome.debugger.detach(target, () => {
      const error = chrome.runtime.lastError;
      if (error && !error.message?.includes("No debugger is connected")) {
        console.warn("[yetibrowser] failed to detach debugger", error);
      }
      resolve();
    });
  });
}

async function encodeScreenshot(base64Png: string): Promise<{ data: string; mimeType: string }> {
  const bytes = Uint8Array.from(atob(base64Png), (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: "image/png" });
  const bitmap = await createImageBitmap(blob);

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

  let outputBlob: Blob;
  let mimeType = "image/webp";
  try {
    outputBlob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
  } catch (error) {
    console.warn("[yetibrowser] webp conversion failed, falling back to jpeg", error);
    outputBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    mimeType = "image/jpeg";
  }

  const arrayBuffer = await outputBlob.arrayBuffer();
  const outputBytes = new Uint8Array(arrayBuffer);
  let binary = "";
  outputBytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return { data: btoa(binary), mimeType };
}

async function sendDebuggerCommand<T>(
  target: chrome.debugger.Debuggee,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve((result ?? {}) as T);
    });
  });
}

async function readConsoleLogs(): Promise<ConsoleLogEntry[]> {
  const tab = await ensureTab();
  await ensurePageHelpers(tab.id!);
  const logs = await runInPage(() => {
    const win = window as typeof window & { __yetibrowser?: { logs?: ConsoleLogEntry[] } };
    const entries = Array.isArray(win.__yetibrowser?.logs) ? win.__yetibrowser!.logs! : [];
    return { ok: true, value: entries.slice(-200) };
  }, []);
  return logs ?? [];
}

async function initializeTab(tabId: number): Promise<void> {
  try {
    await ensurePageHelpers(tabId);
  } catch (error) {
    console.warn("[yetibrowser] failed to initialize tab helpers", error);
  }
  void updateBadge();
}

async function ensurePageHelpers(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const win = window as typeof window & {
        __yetibrowser?: {
          initialized?: boolean;
          logs: ConsoleLogEntry[];
        };
      };

      const install = () => {
        const maxEntries = 500;
        const state = win.__yetibrowser ?? { logs: [] as ConsoleLogEntry[] };
        const logs = Array.isArray(state.logs) ? state.logs : [];

        const originals = {
          log: console.log.bind(console),
          info: console.info.bind(console),
          warn: console.warn.bind(console),
          error: console.error.bind(console),
        };

        const serialize = (value: unknown) => {
          if (typeof value === "string") {
            return value;
          }
          if (value instanceof Error) {
            return value.message;
          }
          try {
            const serialized = JSON.stringify(value);
            return serialized ?? String(value);
          } catch (error) {
            return String(value);
          }
        };

        const extractStack = (values: unknown[]): string | undefined => {
          for (const value of values) {
            if (value instanceof Error && value.stack) {
              return value.stack;
            }
            if (typeof value === "string" && value.includes("\n    at ")) {
              return value;
            }
          }
          return undefined;
        };

        const pushEntry = (
          level: keyof typeof originals,
          args: unknown[],
          explicitStack?: string,
        ) => {
          const message = args
            .map((arg) => serialize(arg))
            .filter((part) => part.length > 0)
            .join(" ") || level;
          const stack = explicitStack ?? extractStack(args);
          logs.push({ level, message, timestamp: Date.now(), stack });
          if (logs.length > maxEntries) {
            logs.shift();
          }
        };

        const wrap = (level: keyof typeof originals) =>
          (...args: unknown[]) => {
            pushEntry(level, args);
            originals[level](...args);
          };

        console.log = wrap("log") as typeof console.log;
        console.info = wrap("info") as typeof console.info;
        console.warn = wrap("warn") as typeof console.warn;
        console.error = wrap("error") as typeof console.error;

        window.addEventListener("error", (event) => {
          const details: unknown[] = [event.message];
          if (event.filename) {
            const locationParts = [event.filename];
            if (typeof event.lineno === "number") {
              locationParts.push(String(event.lineno));
            }
            if (typeof event.colno === "number") {
              locationParts.push(String(event.colno));
            }
            details.push(locationParts.join(":"));
          }
          const stack = event.error instanceof Error ? event.error.stack ?? undefined : undefined;
          pushEntry("error", details, stack);
          originals.error(event.message, event.error ?? event);
        });

        window.addEventListener("unhandledrejection", (event) => {
          const reason = event.reason;
          let message: string;
          let stack: string | undefined;
          if (reason instanceof Error) {
            message = reason.message;
            stack = reason.stack ?? undefined;
          } else {
            message = serialize(reason);
          }
          pushEntry("error", ["Unhandled promise rejection", message], stack);
          originals.error("Unhandled promise rejection", reason);
        });

        logs.push({ level: "debug", message: "[yetibrowser] console hooks installed", timestamp: Date.now() });

        win.__yetibrowser = {
          initialized: true,
          logs,
        };
      };

      if (!win.__yetibrowser?.initialized) {
        install();
        return;
      }

      if (!Array.isArray(win.__yetibrowser.logs)) {
        install();
      }
    },
  });

  const tab = await chrome.tabs.get(tabId);
  if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("edge://") || tab.url?.startsWith("about:")) {
    console.warn("[yetibrowser] unable to inject helpers into special page", tab.url);
  }
}

async function updateBadge(): Promise<void> {
  const isConnected = connectedTabId !== null && socketStatus === "open";
  try {
    const text = isConnected ? "●" : "";
    await chrome.action.setBadgeText({ text });
    if (isConnected) {
      try {
        await chrome.action.setBadgeBackgroundColor({ color: "#111827" });
      } catch (error) {
        console.warn("[yetibrowser] failed to set badge background", error);
      }
      if (chrome.action.setBadgeTextColor) {
        try {
          await chrome.action.setBadgeTextColor({ color: "#facc15" });
        } catch (error) {
          console.warn("[yetibrowser] failed to set badge text color", error);
        }
      }
    }
  } catch (error) {
    console.warn("[yetibrowser] failed to set badge", error);
  }
}
