import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { RawData } from "ws";

import type {
  BridgeClientMessage,
  BridgeServerMessage,
  CommandName,
  CommandPayload,
  CommandResult,
} from "@yetidevworks/shared";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  command: CommandName;
};

const DEFAULT_TIMEOUT_MS = 30_000;

export interface ExtensionBridgeOptions {
  port: number;
  requestTimeoutMs?: number;
}

export class ExtensionBridge {
  private readonly options: Required<ExtensionBridgeOptions>;
  private wss: WebSocketServer | undefined;
  private socket: WebSocket | undefined;
  private pending = new Map<string, PendingRequest>();
  private hello: { client: string; version?: string } | undefined;

  constructor(options: ExtensionBridgeOptions) {
    this.options = {
      requestTimeoutMs: DEFAULT_TIMEOUT_MS,
      ...options,
    };
  }

  async start(): Promise<void> {
    if (this.wss) {
      return;
    }

    this.wss = new WebSocketServer({ port: this.options.port });
    this.wss.on("connection", (socket, request) => this.handleConnection(socket, request));
    this.wss.on("error", (error) => {
      console.error("WebSocket server error", error);
    });

    await once(this.wss, "listening");
    console.error(`[yetibrowser] Waiting for extension on ws://localhost:${this.options.port}`);
  }

  isConnected(): boolean {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  getHelloInfo(): { client: string; version?: string } | undefined {
    return this.hello;
  }

  async close(): Promise<void> {
    this.rejectAllPending(new Error("Extension bridge shutting down"));

    if (this.socket) {
      try {
        this.socket.terminate();
      } catch (error) {
        console.error("Failed to terminate WebSocket", error);
      }
      this.socket.removeAllListeners();
      this.socket = undefined;
    }

    if (this.wss) {
      await new Promise<void>((resolve) => this.wss?.close(() => resolve()));
      this.wss.removeAllListeners();
      this.wss = undefined;
    }
  }

  async send<K extends CommandName>(
    command: K,
    payload: CommandPayload<K>,
  ): Promise<CommandResult<K>> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(
        "YetiBrowser extension not connected. Click the extension icon and connect a tab before using this tool.",
      );
    }

    const id = randomUUID();
    const message: BridgeServerMessage = {
      type: "call",
      id,
      command,
      payload,
    };

    const raw = JSON.stringify(message);

    return await new Promise<CommandResult<K>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Extension response timed out for command "${command}"`));
      }, this.options.requestTimeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as CommandResult<K>),
        reject,
        timeout,
        command,
      });

      try {
        this.socket!.send(raw);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    if (this.socket) {
      console.warn("Existing extension connection detected. Closing previous socket.");
      this.socket.terminate();
      this.rejectAllPending(new Error("Previous connection was replaced by a new socket"));
    }

    this.socket = socket;
    console.error(`[yetibrowser] Extension connected from ${request.socket.remoteAddress ?? "unknown"}`);

    socket.on("message", (data: RawData) => this.handleMessage(data));
    socket.on("error", (error: Error) => {
      console.error("Extension socket error", error);
      this.rejectAllPending(new Error("Extension socket error"));
    });
    socket.on("close", () => {
      console.error("[yetibrowser] Extension disconnected");
      this.socket = undefined;
      this.rejectAllPending(new Error("Extension disconnected"));
    });
  }

  private handleMessage(data: RawData): void {
    let message: BridgeClientMessage;

    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      console.error("Failed to parse message from extension", error);
      return;
    }

    if (message.type === "hello") {
      this.hello = { client: message.client, version: message.version };
      console.error(
        `[yetibrowser] Extension hello from ${message.client}${message.version ? ` v${message.version}` : ""}`,
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

      resolve(message.result as unknown);
      return;
    }

    console.warn("Received unsupported message from extension", message);
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
