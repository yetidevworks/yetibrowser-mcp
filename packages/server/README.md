# YetiBrowser MCP Server

This package exposes the CLI that bridges Model Context Protocol (MCP) clients to a live browser tab. It works together with the YetiBrowser MCP browser extension (Chrome/Firefox) so IDEs and agents can automate the tab you explicitly connect.

- **Transparent & local-first** – the CLI and extension only communicate on `localhost`; no browsing data is sent elsewhere.
- **Feature-rich tooling** – DOM snapshots, diffs, console capture, page state dumps, full-page screenshots, and standard navigation/input helpers.
- **Cross-client** – compatible with Codex/Claude Code, Cursor, Windsurf, MCP Inspector, or any other MCP-aware client.

## Installation

```bash
npm install -g @yetidevworks/server
# or run without installing
npx yetibrowser-mcp --ws-port 9010
```

## Usage

1. Install and load the [YetiBrowser MCP browser extension](https://github.com/yetidevworks/yetibrowser-mcp).
2. Start the server:
   ```bash
   yetibrowser-mcp --ws-port 9010
   ```
3. Connect the tab via the extension popup and configure your MCP client to call the CLI (see the main repository README for examples).

The CLI communicates over stdio, so any MCP client can spawn it and exchange requests/responses.

## Tools exposed

- `browser_snapshot` – capture an accessibility-oriented snapshot of the current page.
- `browser_snapshot_diff` – compare the two most recent snapshots to highlight DOM/ARIA changes.
- `browser_navigate` – load a new URL in the connected tab and return an updated snapshot.
- `browser_go_back` / `browser_go_forward` – move through history while keeping MCP in sync.
- `browser_wait` – pause automation for a specified number of seconds.
- `browser_press_key` – simulate a keyboard key press on the focused element.
- `browser_click` – click the element identified by a CSS selector.
- `browser_hover` – hover the pointer over the targeted element.
- `browser_type` – type text (optionally submitting with Enter) into an editable element.
- `browser_select_option` – choose one or more options in a `<select>` element.
- `browser_screenshot` – capture a viewport or full-page screenshot via the DevTools protocol.
- `browser_get_console_logs` – return recent console output, including errors with stack traces.
- `browser_page_state` – dump forms, storage keys, and cookies for the connected page.

## Development

This package is part of the [YetiBrowser MCP monorepo](https://github.com/yetidevworks/yetibrowser-mcp). Clone the repo for contribution instructions, publishing steps, and privacy policy.

