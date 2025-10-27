import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ExtensionBridge } from "./bridge.js";
export interface CreateMcpServerOptions {
    name: string;
    version: string;
    bridge: ExtensionBridge;
}
export declare function createMcpServer(options: CreateMcpServerOptions): Promise<Server>;
//# sourceMappingURL=server.d.ts.map