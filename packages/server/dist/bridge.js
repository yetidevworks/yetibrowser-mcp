import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
const DEFAULT_TIMEOUT_MS = 30_000;
export class ExtensionBridge {
    options;
    wss;
    socket;
    pending = new Map();
    hello;
    constructor(options) {
        this.options = {
            requestTimeoutMs: DEFAULT_TIMEOUT_MS,
            ...options,
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
                    reject(new Error(`WebSocket port ${this.options.port} is already in use. Another YetiBrowser MCP instance might be running. Use --ws-port to pick a different port.`));
                }
                else {
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
        }
        catch (error) {
            this.wss = undefined;
            wss.removeAllListeners();
            try {
                wss.close();
            }
            catch (closeError) {
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
            }
            catch (error) {
                console.error("Failed to terminate WebSocket", error);
            }
            this.socket.removeAllListeners();
            this.socket = undefined;
        }
        if (this.wss) {
            await new Promise((resolve) => this.wss?.close(() => resolve()));
            this.wss.removeAllListeners();
            this.wss = undefined;
        }
    }
    async send(command, payload) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw new Error("YetiBrowser extension not connected. Click the extension icon and connect a tab before using this tool.");
        }
        const id = randomUUID();
        const message = {
            type: "call",
            id,
            command,
            payload,
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
                command,
            });
            try {
                this.socket.send(raw);
            }
            catch (error) {
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
            this.socket = undefined;
            this.rejectAllPending(new Error("Extension disconnected"));
        });
    }
    handleMessage(data) {
        let message;
        try {
            message = JSON.parse(data.toString());
        }
        catch (error) {
            console.error("Failed to parse message from extension", error);
            return;
        }
        if (message.type === "hello") {
            this.hello = { client: message.client, version: message.version };
            console.error(`[yetibrowser] Extension hello from ${message.client}${message.version ? ` v${message.version}` : ""}`);
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
}
//# sourceMappingURL=bridge.js.map