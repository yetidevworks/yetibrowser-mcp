import type { CommandName, CommandPayload, CommandResult } from "@yetidevworks/shared";
export interface ExtensionBridgeOptions {
    port: number;
    requestTimeoutMs?: number;
}
export declare class ExtensionBridge {
    private readonly options;
    private wss;
    private socket;
    private pending;
    private hello;
    constructor(options: ExtensionBridgeOptions);
    start(): Promise<void>;
    isConnected(): boolean;
    getHelloInfo(): {
        client: string;
        version?: string;
    } | undefined;
    getPort(): number;
    close(): Promise<void>;
    send<K extends CommandName>(command: K, payload: CommandPayload<K>): Promise<CommandResult<K>>;
    private handleConnection;
    private handleMessage;
    private rejectAllPending;
}
//# sourceMappingURL=bridge.d.ts.map