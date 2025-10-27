import type { CommandName, CommandPayload, CommandResult, ToolResponse } from "@yetidevworks/shared";
import { ExtensionBridge } from "./bridge.js";
export declare class ExtensionContext {
    private readonly bridge;
    private readonly snapshotHistory;
    constructor(bridge: ExtensionBridge);
    call<K extends CommandName>(command: K, payload?: CommandPayload<K> | undefined): Promise<CommandResult<K>>;
    captureSnapshot(statusMessage?: string): Promise<ToolResponse>;
    diffLatestSnapshots(): Promise<ToolResponse>;
    getConnectionInfo(): ConnectionInfo;
}
interface ConnectionInfo {
    wsPort: number;
    connected: boolean;
    extension: {
        client: string;
        version?: string;
    } | undefined;
}
export {};
//# sourceMappingURL=context.d.ts.map