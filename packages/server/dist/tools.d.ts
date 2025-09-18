import type { ToolResponse } from "@yetidevworks/shared";
import { ExtensionContext } from "./context.js";
export interface Tool {
    schema: {
        name: string;
        description: string;
        inputSchema: unknown;
    };
    handle: (context: ExtensionContext, params: unknown) => Promise<ToolResponse>;
}
export declare function createTools(): Tool[];
//# sourceMappingURL=tools.d.ts.map