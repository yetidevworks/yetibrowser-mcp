#!/usr/bin/env node
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Command, InvalidArgumentError } from "commander";

import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };
import { ExtensionBridge } from "./bridge.js";
import { createMcpServer } from "./server.js";

const AUTO_WS_PORTS = [9010, 9011, 9012, 9013, 9014, 9015, 9016, 9017, 9018, 9019, 9020];

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new InvalidArgumentError("Port must be an integer between 1 and 65535");
  }
  return port;
}

function buildPortCandidates(preferred: number): number[] {
  const index = AUTO_WS_PORTS.indexOf(preferred);
  if (index === -1) {
    return [preferred];
  }
  return [...AUTO_WS_PORTS.slice(index), ...AUTO_WS_PORTS.slice(0, index)];
}

async function startBridgeWithFallback(portCandidates: number[]): Promise<{ bridge: ExtensionBridge; port: number }> {
  let lastError: unknown;

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
        /* ignore */
      });
      if (error instanceof Error && error.message.includes("already in use")) {
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[yetibrowser] Failed to start WebSocket bridge: ${message}`);
      process.exit(1);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
  console.error(`[yetibrowser] Failed to find available WebSocket port near ${portCandidates[0]}: ${message}`);
  process.exit(1);
}

const program = new Command();

program
  .name("yetibrowser-mcp")
  .version(packageJson.version)
  .description("YetiBrowser MCP server")
  .option(
    "--ws-port <port>",
    "WebSocket port exposed for the browser extension",
    parsePort,
    9010,
  )
  .option(
    "--http-port <port>",
    "Optional Streamable HTTP endpoint for sharing the server across multiple MCP clients",
    parsePort,
  )
  .action(
    async ({ wsPort, httpPort }: { wsPort: number; httpPort?: number }) => {
      const portCandidates = buildPortCandidates(wsPort);
      const { bridge, port: activeWsPort } = await startBridgeWithFallback(portCandidates);
      wsPort = activeWsPort;

      const server = await createMcpServer({
        name: "YetiBrowser MCP",
        version: packageJson.version,
        bridge,
      });

      let httpServer: ReturnType<typeof createServer> | undefined;
      let httpTransport: StreamableHTTPServerTransport | undefined;
      let stdioTransport: StdioServerTransport | undefined;
      let shuttingDown = false;

      const shutdown = async () => {
        if (shuttingDown) {
          return;
        }
        shuttingDown = true;
        console.error("[yetibrowser] shutting down");
        const tasks: Array<Promise<unknown>> = [server.close(), bridge.close()];
        if (httpTransport) {
          tasks.push(httpTransport.close());
        }
        if (httpServer) {
          tasks.push(
            new Promise<void>((resolve) => {
              httpServer!.close(() => resolve());
            }),
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

      if (httpPort !== undefined) {
        httpTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
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
              const headerValues = acceptHeader as string[];
              const combined = headerValues.join(",");
              const entries = combined
                .split(",")
                .map((entry: string) => entry.trim())
                .filter((entry: string) => entry.length > 0);
              const parts = new Set(entries);
              parts.add("application/json");
              parts.add("text/event-stream");
              req.headers.accept = Array.from(parts).join(", ");
            } else {
              req.headers.accept = "application/json, text/event-stream";
            }

            await httpTransport!.handleRequest(req, res);
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
          }),
        ]);

        httpServer.listen(httpPort, "127.0.0.1");

        try {
          await listenPromise;
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          if (err?.code === "EADDRINUSE") {
            console.error(
              `[yetibrowser] Failed to start HTTP transport: port ${httpPort} is already in use. Pick a different --http-port value.`,
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
    },
  );

program.parse();
