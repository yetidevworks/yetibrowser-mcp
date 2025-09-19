#!/usr/bin/env node

// src/index.ts
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Command, InvalidArgumentError } from "commander";
import { randomUUID as randomUUID2 } from "crypto";
import { once } from "events";
import { createServer } from "http";
import { createRequire } from "module";

// src/bridge.ts
import { randomUUID } from "crypto";
import { WebSocketServer, WebSocket } from "ws";
var DEFAULT_TIMEOUT_MS = 3e4;
var ExtensionBridge = class {
  options;
  wss;
  socket;
  pending = /* @__PURE__ */ new Map();
  hello;
  constructor(options) {
    this.options = {
      requestTimeoutMs: DEFAULT_TIMEOUT_MS,
      ...options
    };
  }
  async start() {
    if (this.wss) {
      return;
    }
    const wss = new WebSocketServer({ port: this.options.port });
    this.wss = wss;
    wss.on("connection", (socket, request) => this.handleConnection(socket, request));
    const listenPromise = new Promise((resolve, reject) => {
      const handleError = (error) => {
        const err = error;
        if (err?.code === "EADDRINUSE") {
          reject(
            new Error(
              `WebSocket port ${this.options.port} is already in use. Another YetiBrowser MCP instance might be running. Use --ws-port to pick a different port.`
            )
          );
        } else {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      wss.once("error", handleError);
      wss.once("listening", () => {
        wss.off("error", handleError);
        resolve();
      });
    });
    try {
      await listenPromise;
    } catch (error) {
      this.wss = void 0;
      wss.removeAllListeners();
      try {
        wss.close();
      } catch (closeError) {
        console.error("Failed to close WebSocket server after startup error", closeError);
      }
      throw error;
    }
    wss.on("error", (error) => {
      console.error("WebSocket server error", error);
    });
    console.error(`[yetibrowser] Waiting for extension on ws://localhost:${this.options.port}`);
  }
  isConnected() {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }
  getHelloInfo() {
    return this.hello;
  }
  getPort() {
    return this.options.port;
  }
  async close() {
    this.rejectAllPending(new Error("Extension bridge shutting down"));
    if (this.socket) {
      try {
        this.socket.terminate();
      } catch (error) {
        console.error("Failed to terminate WebSocket", error);
      }
      this.socket.removeAllListeners();
      this.socket = void 0;
    }
    if (this.wss) {
      await new Promise((resolve) => this.wss?.close(() => resolve()));
      this.wss.removeAllListeners();
      this.wss = void 0;
    }
  }
  async send(command, payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(
        "YetiBrowser extension not connected. Click the extension icon and connect a tab before using this tool."
      );
    }
    const id = randomUUID();
    const message = {
      type: "call",
      id,
      command,
      payload
    };
    const raw = JSON.stringify(message);
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Extension response timed out for command "${command}"`));
      }, this.options.requestTimeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value),
        reject,
        timeout,
        command
      });
      try {
        this.socket.send(raw);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  handleConnection(socket, request) {
    if (this.socket) {
      console.warn("Existing extension connection detected. Closing previous socket.");
      this.socket.terminate();
      this.rejectAllPending(new Error("Previous connection was replaced by a new socket"));
    }
    this.socket = socket;
    console.error(`[yetibrowser] Extension connected from ${request.socket.remoteAddress ?? "unknown"}`);
    socket.on("message", (data) => this.handleMessage(data));
    socket.on("error", (error) => {
      console.error("Extension socket error", error);
      this.rejectAllPending(new Error("Extension socket error"));
    });
    socket.on("close", () => {
      console.error("[yetibrowser] Extension disconnected");
      this.socket = void 0;
      this.rejectAllPending(new Error("Extension disconnected"));
    });
  }
  handleMessage(data) {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      console.error("Failed to parse message from extension", error);
      return;
    }
    if (message.type === "hello") {
      this.hello = { client: message.client, version: message.version };
      console.error(
        `[yetibrowser] Extension hello from ${message.client}${message.version ? ` v${message.version}` : ""}`
      );
      return;
    }
    if (message.type === "event") {
      console.error("[yetibrowser] extension event", message.event, message.payload);
      return;
    }
    if (message.type === "result") {
      const pending = this.pending.get(message.id);
      if (!pending) {
        console.warn(`Received result for unknown id ${message.id}`);
        return;
      }
      const { resolve, reject, timeout, command } = pending;
      clearTimeout(timeout);
      this.pending.delete(message.id);
      if (!message.ok) {
        reject(new Error(message.error ?? `Command "${command}" failed`));
        return;
      }
      resolve(message.result);
      return;
    }
    console.warn("Received unsupported message from extension", message);
  }
  rejectAllPending(error) {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
};

// src/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

// src/context.ts
var ExtensionContext = class {
  constructor(bridge) {
    this.bridge = bridge;
  }
  snapshotHistory = [];
  async call(command, payload = void 0) {
    const finalPayload = payload ?? {};
    return await this.bridge.send(command, finalPayload);
  }
  async captureSnapshot(statusMessage = "") {
    const [{ url }, { title }, snapshotResult] = await Promise.all([
      this.call("getUrl"),
      this.call("getTitle"),
      this.call("snapshot")
    ]);
    const record = {
      capturedAt: snapshotResult.raw.capturedAt,
      message: statusMessage,
      snapshot: snapshotResult.raw,
      formatted: snapshotResult.formatted,
      url,
      title
    };
    this.snapshotHistory.push(record);
    if (this.snapshotHistory.length > 20) {
      this.snapshotHistory.shift();
    }
    const index = this.snapshotHistory.length;
    const statusLines = [statusMessage, `Snapshot #${index} captured at ${record.capturedAt}`].filter(Boolean).join("\n");
    const prefix = statusLines ? `${statusLines}
` : "";
    const text = `${prefix}- Page URL: ${url}
- Page Title: ${title}
- Page Snapshot
\`\`\`yaml
${snapshotResult.formatted}
\`\`\`
`;
    return {
      content: [
        {
          type: "text",
          text
        }
      ]
    };
  }
  async diffLatestSnapshots() {
    if (this.snapshotHistory.length < 2) {
      return {
        content: [
          {
            type: "text",
            text: "At least two snapshots are required to compute a diff. Capture another snapshot first."
          }
        ],
        isError: true
      };
    }
    const current = this.snapshotHistory.at(-1);
    const previous = this.snapshotHistory.at(-2);
    const diff = diffSnapshots(previous.snapshot, current.snapshot);
    const summaryLines = [];
    summaryLines.push(
      `Diffing snapshot captured ${current.capturedAt} (Snapshot #${this.snapshotHistory.length}) against ${previous.capturedAt}`
    );
    summaryLines.push(`Current URL: ${current.url}`);
    if (current.url !== previous.url) {
      summaryLines.push(`Previous URL: ${previous.url}`);
    }
    summaryLines.push("Summary:");
    summaryLines.push(`- Added elements: ${diff.added.length}`);
    summaryLines.push(`- Removed elements: ${diff.removed.length}`);
    summaryLines.push(`- Changed elements: ${diff.changed.length}`);
    const formatEntry = (entry) => `selector: ${entry.selector}
      role: ${entry.role}
      name: ${entry.name}`;
    if (diff.added.length) {
      summaryLines.push("Added:");
      for (const entry of diff.added.slice(0, 5)) {
        summaryLines.push(`  - ${entry.selector} (${entry.role}) \u2192 "${entry.name}"`);
      }
      if (diff.added.length > 5) {
        summaryLines.push(`  - \u2026 ${diff.added.length - 5} more`);
      }
    }
    if (diff.removed.length) {
      summaryLines.push("Removed:");
      for (const entry of diff.removed.slice(0, 5)) {
        summaryLines.push(`  - ${entry.selector} (${entry.role}) \u2192 "${entry.name}"`);
      }
      if (diff.removed.length > 5) {
        summaryLines.push(`  - \u2026 ${diff.removed.length - 5} more`);
      }
    }
    if (diff.changed.length) {
      summaryLines.push("Changed:");
      for (const change of diff.changed.slice(0, 5)) {
        summaryLines.push(
          `  - ${change.selector}
    before: role=${change.before.role}, name="${change.before.name}"
    after:  role=${change.after.role}, name="${change.after.name}"`
        );
      }
      if (diff.changed.length > 5) {
        summaryLines.push(`  - \u2026 ${diff.changed.length - 5} more`);
      }
    }
    if (!diff.added.length && !diff.removed.length && !diff.changed.length) {
      summaryLines.push("No element-level differences detected.");
    }
    return {
      content: [
        {
          type: "text",
          text: summaryLines.join("\n")
        }
      ]
    };
  }
  getConnectionInfo() {
    return {
      wsPort: this.bridge.getPort(),
      connected: this.bridge.isConnected(),
      extension: this.bridge.getHelloInfo()
    };
  }
};
function diffSnapshots(previous, current) {
  const prevMap = /* @__PURE__ */ new Map();
  const currentMap = /* @__PURE__ */ new Map();
  for (const entry of previous.entries) {
    if (!prevMap.has(entry.selector)) {
      prevMap.set(entry.selector, entry);
    }
  }
  for (const entry of current.entries) {
    if (!currentMap.has(entry.selector)) {
      currentMap.set(entry.selector, entry);
    }
  }
  const added = [];
  const removed = [];
  const changed = [];
  for (const [selector, entry] of currentMap.entries()) {
    const previousEntry = prevMap.get(selector);
    if (!previousEntry) {
      added.push(entry);
      continue;
    }
    if (previousEntry.role !== entry.role || previousEntry.name !== entry.name) {
      changed.push({ selector, before: previousEntry, after: entry });
    }
  }
  for (const [selector, entry] of prevMap.entries()) {
    if (!currentMap.has(selector)) {
      removed.push(entry);
    }
  }
  return { added, removed, changed };
}

// src/tools.ts
import zodToJsonSchema from "zod-to-json-schema";
import { z } from "zod";
var ElementTargetSchema = z.object({
  selector: z.string().min(1).describe("CSS selector that uniquely identifies the target element"),
  description: z.string().optional().describe("Optional human-readable description of the element")
});
var NavigateSchema = z.object({
  url: z.string().describe("The URL to navigate to")
});
var WaitSchema = z.object({
  seconds: z.number().min(0).describe("The time to wait in seconds")
});
var PressKeySchema = z.object({
  key: z.string().min(1).describe("Name of the key to press or a character to generate, such as `ArrowLeft` or `a`")
});
var TypeSchema = ElementTargetSchema.extend({
  text: z.string().describe("Text to type into the element"),
  submit: z.boolean().default(false).describe("Whether to submit entered text (press Enter after)")
});
var SelectOptionSchema = ElementTargetSchema.extend({
  values: z.array(z.string()).nonempty().describe(
    "Array of values to select in the dropdown. This can be a single value or multiple values."
  )
});
var ScreenshotSchema = z.object({
  fullPage: z.boolean().optional().describe("Whether to capture the full page instead of the visible viewport")
});
function noInputSchema() {
  return zodToJsonSchema(z.object({}));
}
function buildSnapshotTool(name, description, command) {
  const isNavigate = command === "navigate";
  const inputSchema = isNavigate ? zodToJsonSchema(NavigateSchema) : noInputSchema();
  return {
    schema: {
      name,
      description,
      inputSchema
    },
    handle: async (context, params) => {
      if (isNavigate) {
        const { url } = NavigateSchema.parse(params);
        await context.call("navigate", { url });
        return context.captureSnapshot(`Navigated to ${url}`);
      }
      if (command === "goBack") {
        await context.call("goBack", {});
        return context.captureSnapshot("Navigated back");
      }
      await context.call("goForward", {});
      return context.captureSnapshot("Navigated forward");
    }
  };
}
function createTools() {
  const snapshotTool = {
    schema: {
      name: "browser_snapshot",
      description: "Capture accessibility snapshot of the current page. Use this for getting references to elements to interact with.",
      inputSchema: noInputSchema()
    },
    handle: async (context) => {
      return context.captureSnapshot();
    }
  };
  const snapshotDiffTool = {
    schema: {
      name: "browser_snapshot_diff",
      description: "Compare the most recent snapshot with the previous one to highlight DOM changes",
      inputSchema: noInputSchema()
    },
    handle: async (context) => {
      return context.diffLatestSnapshots();
    }
  };
  const waitTool = {
    schema: {
      name: "browser_wait",
      description: "Wait for a specified time in seconds",
      inputSchema: zodToJsonSchema(WaitSchema)
    },
    handle: async (context, params) => {
      const { seconds } = WaitSchema.parse(params);
      await context.call("wait", { seconds });
      return {
        content: [
          {
            type: "text",
            text: `Waited for ${seconds} seconds`
          }
        ]
      };
    }
  };
  const pressKeyTool = {
    schema: {
      name: "browser_press_key",
      description: "Press a key on the keyboard",
      inputSchema: zodToJsonSchema(PressKeySchema)
    },
    handle: async (context, params) => {
      const { key } = PressKeySchema.parse(params);
      await context.call("pressKey", { key });
      return {
        content: [
          {
            type: "text",
            text: `Pressed key ${key}`
          }
        ]
      };
    }
  };
  const clickTool = {
    schema: {
      name: "browser_click",
      description: "Perform click on a web page",
      inputSchema: zodToJsonSchema(ElementTargetSchema)
    },
    handle: async (context, params) => {
      const parsed = ElementTargetSchema.parse(params);
      await context.call("click", { selector: parsed.selector, description: parsed.description });
      return context.captureSnapshot(
        `Clicked "${parsed.description ?? parsed.selector}"`
      );
    }
  };
  const hoverTool = {
    schema: {
      name: "browser_hover",
      description: "Hover over element on page",
      inputSchema: zodToJsonSchema(ElementTargetSchema)
    },
    handle: async (context, params) => {
      const parsed = ElementTargetSchema.parse(params);
      await context.call("hover", { selector: parsed.selector, description: parsed.description });
      return context.captureSnapshot(
        `Hovered over "${parsed.description ?? parsed.selector}"`
      );
    }
  };
  const typeTool = {
    schema: {
      name: "browser_type",
      description: "Type text into editable element",
      inputSchema: zodToJsonSchema(TypeSchema)
    },
    handle: async (context, params) => {
      const { selector, text, submit, description } = TypeSchema.parse(params);
      await context.call("type", { selector, text, submit, description });
      return context.captureSnapshot(
        `Typed "${text}" into "${description ?? selector}"`
      );
    }
  };
  const selectOptionTool = {
    schema: {
      name: "browser_select_option",
      description: "Select an option in a dropdown",
      inputSchema: zodToJsonSchema(SelectOptionSchema)
    },
    handle: async (context, params) => {
      const { selector, values, description } = SelectOptionSchema.parse(params);
      await context.call("selectOption", { selector, values, description });
      return context.captureSnapshot(
        `Selected option in "${description ?? selector}"`
      );
    }
  };
  const screenshotTool = {
    schema: {
      name: "browser_screenshot",
      description: "Take a screenshot of the current page",
      inputSchema: zodToJsonSchema(ScreenshotSchema)
    },
    handle: async (context, params) => {
      const { fullPage } = ScreenshotSchema.parse(params);
      const result = await context.call("screenshot", { fullPage });
      return {
        content: [
          {
            type: "image",
            data: result.data,
            mimeType: result.mimeType
          }
        ]
      };
    }
  };
  const consoleLogsTool = {
    schema: {
      name: "browser_get_console_logs",
      description: "Get the console logs from the browser",
      inputSchema: noInputSchema()
    },
    handle: async (context) => {
      const logs = await context.call("getConsoleLogs", {});
      const text = logs.map((log) => {
        const time = new Date(log.timestamp).toISOString();
        const lines = [`[${time}] [${log.level}] ${log.message}`];
        if (log.stack) {
          lines.push(log.stack);
        }
        return lines.join("\n");
      }).join("\n\n");
      return {
        content: [
          {
            type: "text",
            text: text || "No console output captured"
          }
        ]
      };
    }
  };
  const pageStateTool = {
    schema: {
      name: "browser_page_state",
      description: "Extract form data, storage values, and cookies from the active page",
      inputSchema: noInputSchema()
    },
    handle: async (context) => {
      const state = await context.call("pageState", {});
      const summary = [
        `Page state captured ${state.capturedAt}`,
        `- Forms inspected: ${state.forms.length}`,
        `- localStorage keys: ${state.localStorage.length}`,
        `- sessionStorage keys: ${state.sessionStorage.length}`,
        `- Cookies: ${state.cookies.length}`,
        "",
        "```json",
        JSON.stringify(state, null, 2),
        "```"
      ].join("\n");
      return {
        content: [
          {
            type: "text",
            text: summary
          }
        ]
      };
    }
  };
  const connectionInfoTool = {
    schema: {
      name: "browser_connection_info",
      description: "Show the MCP bridge WebSocket port, connection state, and extension info",
      inputSchema: noInputSchema()
    },
    handle: async (context) => {
      const info = context.getConnectionInfo();
      const lines = [
        `WebSocket port: ${info.wsPort}`,
        `Extension connected: ${info.connected ? "yes" : "no"}`
      ];
      if (info.extension) {
        const versionSuffix = info.extension.version ? ` v${info.extension.version}` : "";
        lines.push(`Extension hello: ${info.extension.client}${versionSuffix}`);
      }
      return {
        content: [
          {
            type: "text",
            text: lines.join("\n")
          }
        ]
      };
    }
  };
  return [
    snapshotTool,
    snapshotDiffTool,
    buildSnapshotTool("browser_navigate", "Navigate to a URL", "navigate"),
    buildSnapshotTool("browser_go_back", "Go back to the previous page", "goBack"),
    buildSnapshotTool("browser_go_forward", "Go forward to the next page", "goForward"),
    waitTool,
    pressKeyTool,
    clickTool,
    hoverTool,
    typeTool,
    selectOptionTool,
    screenshotTool,
    consoleLogsTool,
    pageStateTool,
    connectionInfoTool
  ];
}

// src/server.ts
async function createMcpServer(options) {
  const { name, version, bridge } = options;
  const context = new ExtensionContext(bridge);
  const tools = createTools();
  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((tool) => tool.schema)
    };
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: [] };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((candidate) => candidate.schema.name === request.params.name);
    if (!tool) {
      const response = {
        content: [
          {
            type: "text",
            text: `Tool "${request.params.name}" not found`
          }
        ],
        isError: true
      };
      return response;
    }
    try {
      const result = await tool.handle(context, request.params.arguments ?? {});
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const response = {
        content: [
          {
            type: "text",
            text: message
          }
        ],
        isError: true
      };
      return response;
    }
  });
  server.setRequestHandler(ReadResourceRequestSchema, async () => ({ contents: [] }));
  return server;
}

// src/index.ts
var require2 = createRequire(import.meta.url);
var packageJson = require2("../package.json");
var AUTO_WS_PORTS = [9010, 9011, 9012, 9013, 9014, 9015, 9016, 9017, 9018, 9019, 9020];
function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new InvalidArgumentError("Port must be an integer between 1 and 65535");
  }
  return port;
}
function buildPortCandidates(preferred) {
  const index = AUTO_WS_PORTS.indexOf(preferred);
  if (index === -1) {
    return [preferred];
  }
  return [...AUTO_WS_PORTS.slice(index), ...AUTO_WS_PORTS.slice(0, index)];
}
async function startBridgeWithFallback(portCandidates) {
  let lastError;
  for (const candidatePort of portCandidates) {
    const candidateBridge = new ExtensionBridge({ port: candidatePort });
    try {
      await candidateBridge.start();
      if (candidatePort !== portCandidates[0]) {
        console.error(`[yetibrowser] WebSocket port ${portCandidates[0]} busy, switched to ${candidatePort}`);
      }
      return { bridge: candidateBridge, port: candidatePort };
    } catch (error) {
      lastError = error;
      await candidateBridge.close().catch(() => {
      });
      if (error instanceof Error && error.message.includes("already in use")) {
        continue;
      }
      const message2 = error instanceof Error ? error.message : String(error);
      console.error(`[yetibrowser] Failed to start WebSocket bridge: ${message2}`);
      process.exit(1);
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
  console.error(`[yetibrowser] Failed to find available WebSocket port near ${portCandidates[0]}: ${message}`);
  process.exit(1);
}
var program = new Command();
program.name("yetibrowser-mcp").version(packageJson.version).description("YetiBrowser MCP server").option(
  "--ws-port <port>",
  "WebSocket port exposed for the browser extension",
  parsePort,
  9010
).option(
  "--http-port <port>",
  "Optional Streamable HTTP endpoint for sharing the server across multiple MCP clients",
  parsePort
).action(
  async ({ wsPort, httpPort }) => {
    const portCandidates = buildPortCandidates(wsPort);
    const { bridge, port: activeWsPort } = await startBridgeWithFallback(portCandidates);
    wsPort = activeWsPort;
    const server = await createMcpServer({
      name: "YetiBrowser MCP",
      version: packageJson.version,
      bridge
    });
    let httpServer;
    let httpTransport;
    let stdioTransport;
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      console.error("[yetibrowser] shutting down");
      const tasks = [server.close(), bridge.close()];
      if (httpTransport) {
        tasks.push(httpTransport.close());
      }
      if (httpServer) {
        tasks.push(
          new Promise((resolve) => {
            httpServer.close(() => resolve());
          })
        );
      }
      if (stdioTransport) {
        tasks.push(stdioTransport.close());
      }
      await Promise.allSettled(tasks);
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    if (httpPort !== void 0) {
      httpTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID2(),
        enableJsonResponse: true
      });
      httpTransport.onerror = (error) => {
        console.error("[yetibrowser] HTTP transport error", error);
      };
      await server.connect(httpTransport);
      httpServer = createServer(async (req, res) => {
        try {
          if (!req.url) {
            res.writeHead(400).end("Missing request URL");
            return;
          }
          const requestUrl = new URL(req.url, `http://${req.headers.host ?? `localhost:${httpPort}`}`);
          if (requestUrl.pathname !== "/mcp") {
            res.writeHead(404).end("Not Found");
            return;
          }
          const acceptHeader = req.headers.accept;
          if (typeof acceptHeader === "string") {
            const parts = acceptHeader.split(",").map((value) => value.trim());
            if (!parts.includes("text/event-stream")) {
              parts.push("text/event-stream");
            }
            if (!parts.includes("application/json")) {
              parts.unshift("application/json");
            }
            req.headers.accept = parts.join(", ");
          } else if (Array.isArray(acceptHeader)) {
            const headerValues = acceptHeader;
            const combined = headerValues.join(",");
            const entries = combined.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
            const parts = new Set(entries);
            parts.add("application/json");
            parts.add("text/event-stream");
            req.headers.accept = Array.from(parts).join(", ");
          } else {
            req.headers.accept = "application/json, text/event-stream";
          }
          await httpTransport.handleRequest(req, res);
        } catch (error) {
          console.error("[yetibrowser] Failed to handle HTTP request", error);
          if (!res.headersSent) {
            res.writeHead(500).end("Internal Server Error");
          } else {
            res.end();
          }
        }
      });
      const listenPromise = Promise.race([
        once(httpServer, "listening"),
        once(httpServer, "error").then(([error]) => {
          throw error;
        })
      ]);
      httpServer.listen(httpPort, "127.0.0.1");
      try {
        await listenPromise;
      } catch (error) {
        const err = error;
        if (err?.code === "EADDRINUSE") {
          console.error(
            `[yetibrowser] Failed to start HTTP transport: port ${httpPort} is already in use. Pick a different --http-port value.`
          );
        } else {
          console.error("[yetibrowser] Failed to start HTTP transport", err);
        }
        await shutdown();
        return;
      }
      console.error(`[yetibrowser] Streamable HTTP endpoint ready at http://127.0.0.1:${httpPort}/mcp`);
      process.stdin.on("close", shutdown);
    } else {
      stdioTransport = new StdioServerTransport();
      await server.connect(stdioTransport);
      process.stdin.on("close", shutdown);
    }
  }
);
program.parse();
