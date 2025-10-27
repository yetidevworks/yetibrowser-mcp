import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { ExtensionContext } from "./context.js";
import { createTools } from "./tools.js";
export async function createMcpServer(options) {
    const { name, version, bridge } = options;
    const context = new ExtensionContext(bridge);
    const tools = createTools();
    const server = new Server({ name, version }, {
        capabilities: {
            tools: {},
            resources: {},
        },
    });
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
            const response = {
                content: [
                    {
                        type: "text",
                        text: `Tool "${request.params.name}" not found`,
                    },
                ],
                isError: true,
            };
            return response;
        }
        try {
            const result = await tool.handle(context, request.params.arguments ?? {});
            return result;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const response = {
                content: [
                    {
                        type: "text",
                        text: message,
                    },
                ],
                isError: true,
            };
            return response;
        }
    });
    server.setRequestHandler(ReadResourceRequestSchema, async () => ({ contents: [] }));
    return server;
}
//# sourceMappingURL=server.js.map