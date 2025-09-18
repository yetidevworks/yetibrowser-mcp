interface DomSnapshotEntry {
    selector: string;
    role: string;
    name: string;
}
interface DomSnapshot {
    title: string;
    url: string;
    capturedAt: string;
    entries: DomSnapshotEntry[];
}
interface ConsoleLogEntry {
    level: string;
    message: string;
    timestamp: number;
    stack?: string;
}
interface PageStateStorageEntry {
    key: string;
    value: string;
}
interface PageStateFormField {
    selector: string;
    name?: string;
    type?: string;
    value?: string;
    label?: string;
}
interface PageStateForm {
    selector: string;
    name?: string;
    method?: string;
    action?: string;
    fields: PageStateFormField[];
}
interface PageStateSnapshot {
    forms: PageStateForm[];
    localStorage: PageStateStorageEntry[];
    sessionStorage: PageStateStorageEntry[];
    cookies: PageStateStorageEntry[];
    capturedAt: string;
}
type EmptyPayload = Record<string, never>;
interface CommandPayloadMap {
    ping: EmptyPayload;
    getUrl: EmptyPayload;
    getTitle: EmptyPayload;
    snapshot: EmptyPayload;
    navigate: {
        url: string;
    };
    goBack: EmptyPayload;
    goForward: EmptyPayload;
    wait: {
        seconds: number;
    };
    pressKey: {
        key: string;
    };
    click: {
        selector: string;
        description?: string;
    };
    hover: {
        selector: string;
        description?: string;
    };
    type: {
        selector: string;
        text: string;
        submit?: boolean;
        description?: string;
    };
    selectOption: {
        selector: string;
        values: string[];
        description?: string;
    };
    screenshot: {
        fullPage?: boolean;
    };
    getConsoleLogs: EmptyPayload;
    pageState: EmptyPayload;
}
interface CommandResultMap {
    ping: {
        ok: true;
    };
    getUrl: {
        url: string;
    };
    getTitle: {
        title: string;
    };
    snapshot: {
        formatted: string;
        raw: DomSnapshot;
    };
    navigate: {
        ok: true;
    };
    goBack: {
        ok: true;
    };
    goForward: {
        ok: true;
    };
    wait: {
        ok: true;
    };
    pressKey: {
        ok: true;
    };
    click: {
        ok: true;
    };
    hover: {
        ok: true;
    };
    type: {
        ok: true;
    };
    selectOption: {
        ok: true;
    };
    screenshot: {
        data: string;
        mimeType: string;
    };
    getConsoleLogs: ConsoleLogEntry[];
    pageState: PageStateSnapshot;
}
type CommandName = keyof CommandPayloadMap;
type CommandPayload<K extends CommandName> = CommandPayloadMap[K];
type CommandResult<K extends CommandName> = CommandResultMap[K];
interface BridgeCallMessage<K extends CommandName = CommandName> {
    type: "call";
    id: string;
    command: K;
    payload: CommandPayload<K>;
}
interface BridgeResultMessage<K extends CommandName = CommandName> {
    type: "result";
    id: string;
    command: K;
    ok: boolean;
    result?: CommandResult<K>;
    error?: string;
}
interface BridgeHelloMessage {
    type: "hello";
    client: string;
    version?: string;
}
interface BridgeEventMessage {
    type: "event";
    event: "log" | "status" | "heartbeat";
    payload: unknown;
}
type BridgeServerMessage = BridgeCallMessage;
type BridgeClientMessage = BridgeHelloMessage | BridgeResultMessage | BridgeEventMessage;
declare const TOOL_NAMES: {
    readonly SNAPSHOT: "browser_snapshot";
    readonly SNAPSHOT_DIFF: "browser_snapshot_diff";
    readonly NAVIGATE: "browser_navigate";
    readonly GO_BACK: "browser_go_back";
    readonly GO_FORWARD: "browser_go_forward";
    readonly WAIT: "browser_wait";
    readonly PRESS_KEY: "browser_press_key";
    readonly CLICK: "browser_click";
    readonly HOVER: "browser_hover";
    readonly TYPE: "browser_type";
    readonly SELECT_OPTION: "browser_select_option";
    readonly SCREENSHOT: "browser_screenshot";
    readonly CONSOLE_LOGS: "browser_get_console_logs";
    readonly PAGE_STATE: "browser_page_state";
};
type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];
interface ToolResponse {
    content: Array<{
        type: "text";
        text: string;
    } | {
        type: "image";
        data: string;
        mimeType: string;
    }>;
    isError?: boolean;
}

export { type BridgeCallMessage, type BridgeClientMessage, type BridgeEventMessage, type BridgeHelloMessage, type BridgeResultMessage, type BridgeServerMessage, type CommandName, type CommandPayload, type CommandPayloadMap, type CommandResult, type CommandResultMap, type ConsoleLogEntry, type DomSnapshot, type DomSnapshotEntry, type EmptyPayload, type PageStateForm, type PageStateFormField, type PageStateSnapshot, type PageStateStorageEntry, TOOL_NAMES, type ToolName, type ToolResponse };
