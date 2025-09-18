export interface DomSnapshotEntry {
  selector: string;
  role: string;
  name: string;
}

export interface DomSnapshot {
  title: string;
  url: string;
  capturedAt: string;
  entries: DomSnapshotEntry[];
}

export interface ConsoleLogEntry {
  level: string;
  message: string;
  timestamp: number;
  stack?: string;
}

export interface PageStateStorageEntry {
  key: string;
  value: string;
}

export interface PageStateFormField {
  selector: string;
  name?: string;
  type?: string;
  value?: string;
  label?: string;
}

export interface PageStateForm {
  selector: string;
  name?: string;
  method?: string;
  action?: string;
  fields: PageStateFormField[];
}

export interface PageStateSnapshot {
  forms: PageStateForm[];
  localStorage: PageStateStorageEntry[];
  sessionStorage: PageStateStorageEntry[];
  cookies: PageStateStorageEntry[];
  capturedAt: string;
}

export type EmptyPayload = Record<string, never>;

export interface CommandPayloadMap {
  ping: EmptyPayload;
  getUrl: EmptyPayload;
  getTitle: EmptyPayload;
  snapshot: EmptyPayload;
  navigate: { url: string };
  goBack: EmptyPayload;
  goForward: EmptyPayload;
  wait: { seconds: number };
  pressKey: { key: string };
  click: { selector: string; description?: string };
  hover: { selector: string; description?: string };
  type: { selector: string; text: string; submit?: boolean; description?: string };
  selectOption: { selector: string; values: string[]; description?: string };
  screenshot: { fullPage?: boolean };
  getConsoleLogs: EmptyPayload;
  pageState: EmptyPayload;
}

export interface CommandResultMap {
  ping: { ok: true };
  getUrl: { url: string };
  getTitle: { title: string };
  snapshot: { formatted: string; raw: DomSnapshot };
  navigate: { ok: true };
  goBack: { ok: true };
  goForward: { ok: true };
  wait: { ok: true };
  pressKey: { ok: true };
  click: { ok: true };
  hover: { ok: true };
  type: { ok: true };
  selectOption: { ok: true };
  screenshot: { data: string; mimeType: string };
  getConsoleLogs: ConsoleLogEntry[];
  pageState: PageStateSnapshot;
}

export type CommandName = keyof CommandPayloadMap;

export type CommandPayload<K extends CommandName> = CommandPayloadMap[K];
export type CommandResult<K extends CommandName> = CommandResultMap[K];

export interface BridgeCallMessage<K extends CommandName = CommandName> {
  type: "call";
  id: string;
  command: K;
  payload: CommandPayload<K>;
}

export interface BridgeResultMessage<K extends CommandName = CommandName> {
  type: "result";
  id: string;
  command: K;
  ok: boolean;
  result?: CommandResult<K>;
  error?: string;
}

export interface BridgeHelloMessage {
  type: "hello";
  client: string;
  version?: string;
}

export interface BridgeEventMessage {
  type: "event";
  event: "log" | "status" | "heartbeat";
  payload: unknown;
}

export type BridgeServerMessage = BridgeCallMessage;
export type BridgeClientMessage =
  | BridgeHelloMessage
  | BridgeResultMessage
  | BridgeEventMessage;

export const TOOL_NAMES = {
  SNAPSHOT: "browser_snapshot",
  SNAPSHOT_DIFF: "browser_snapshot_diff",
  NAVIGATE: "browser_navigate",
  GO_BACK: "browser_go_back",
  GO_FORWARD: "browser_go_forward",
  WAIT: "browser_wait",
  PRESS_KEY: "browser_press_key",
  CLICK: "browser_click",
  HOVER: "browser_hover",
  TYPE: "browser_type",
  SELECT_OPTION: "browser_select_option",
  SCREENSHOT: "browser_screenshot",
  CONSOLE_LOGS: "browser_get_console_logs",
  PAGE_STATE: "browser_page_state",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

export interface ToolResponse {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
}
