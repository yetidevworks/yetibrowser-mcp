#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Command, InvalidArgumentError } from "commander";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };
import { ExtensionBridge } from "./bridge.js";
import { createMcpServer } from "./server.js";

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new InvalidArgumentError("Port must be an integer between 1 and 65535");
  }
  return port;
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
  .action(async ({ wsPort }: { wsPort: number }) => {
    const bridge = new ExtensionBridge({ port: wsPort });
    await bridge.start();

    const server = await createMcpServer({
      name: "YetiBrowser MCP",
      version: packageJson.version,
      bridge,
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);

    const shutdown = async () => {
      console.log("[yetibrowser] shutting down");
      await Promise.allSettled([server.close(), bridge.close()]);
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.stdin.on("close", shutdown);
  });

program.parse();
