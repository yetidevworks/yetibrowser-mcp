import type { CommandName, CommandPayload, CommandResult, ToolResponse } from "@yetidevworks/shared";
import { ExtensionBridge } from "./bridge.js";
export declare class ExtensionContext {
    private readonly bridge;
    constructor(bridge: ExtensionBridge);
    call<K extends CommandName>(command: K, payload?: CommandPayload<K> | undefined): Promise<CommandResult<K>>;
    captureSnapshot(statusMessage?: string): Promise<ToolResponse>;
}
//# sourceMappingURL=context.d.ts.map