import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { ToolResponse } from "@yetidevworks/shared";

import { ExtensionBridge } from "./bridge.js";
import { ExtensionContext } from "./context.js";
import { createTools, type Tool } from "./tools.js";

export interface CreateMcpServerOptions {
  name: string;
  version: string;
  bridge: ExtensionBridge;
}

export async function createMcpServer(options: CreateMcpServerOptions): Promise<Server> {
  const { name, version, bridge } = options;
  const context = new ExtensionContext(bridge);
  const tools = createTools();

  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((tool) => tool.schema),
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: [] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((candidate) => candidate.schema.name === request.params.name);
    if (!tool) {
      const response: ToolResponse = {
        content: [
          {
            type: "text",
            text: `Tool "${request.params.name}" not found`,
          },
        ],
        isError: true,
      };
      return response as unknown as Record<string, unknown>;
    }

    try {
      const result = await tool.handle(context, request.params.arguments ?? {});
      return result as unknown as Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const response: ToolResponse = {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
      return response as unknown as Record<string, unknown>;
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async () => ({ contents: [] }));

  return server;
}
