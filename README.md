# YetiBrowser MCP

YetiBrowser MCP is a fully open-source implementation of the Browser MCP workflow. It links a Node-based MCP server with Chrome/Firefox extensions so Model Context Protocol clients—Codex/Claude Code, Cursor, Windsurf, MCP Inspector, or your own tools—can automate a real browser tab while keeping every byte on your machine and auditable.

## Why pick YetiBrowser MCP?

- **Transparent and hackable** – no blob downloads. Inspect, fork, and extend every component.
- **Local-first** – the extension talks only to a localhost MCP server; browsing data never leaves your device.
- **Cross-browser** – shared logic powers both Chrome and Firefox packages (Firefox build is pending better Manifest V3 support, so connection UX may be limited until Mozilla ships full MV3 APIs).
- **Developer-focused tooling** – richer console capture, DOM diffing, page-state dumps, and full-page screenshots built for debugging and QA.
- **Production-friendly** – scripts and docs for packaging, publishing, and integrating with IDE workflows.

### Repository layout

- `packages/shared` – shared TypeScript definitions for messages and tool schemas.
- `packages/server` – the MCP server that bridges MCP clients to a running browser tab.
- `extensions/shared` – shared extension source (background/popup) and assets.
- `extensions/chrome` / `extensions/firefox` – per-browser packaging layers.
- `docs/` – workspace commands, publishing checklists, and feature notes.
- `scripts/` – helper utilities such as `package-extensions.sh` for release zips.

## MCP Tools Available

- `browser_snapshot` – capture an accessibility-oriented snapshot of the current page
- `browser_snapshot_diff` – compare the two most recent snapshots to highlight DOM/ARIA changes
- `browser_navigate` – load a new URL in the connected tab and return an updated snapshot
- `browser_go_back` / `browser_go_forward` – move through history while keeping MCP in sync
- `browser_wait` – pause automation for a set number of seconds
- `browser_press_key` – simulate a keyboard key press on the focused element
- `browser_click` – click the element identified by a CSS selector
- `browser_hover` – hover the pointer over the targeted element
- `browser_type` – type text (optionally submitting with Enter) into an editable element
- `browser_select_option` – choose one or more options in a `<select>` element
- `browser_screenshot` – capture a viewport or full-page screenshot via the DevTools protocol
- `browser_get_console_logs` – return recent console output, including errors with stack traces
- `browser_page_state` – dump forms, storage keys, and cookies for the connected page
- `browser_connection_info` – report bridge WebSocket port, connection status, and extension version

## MCP Server Installation

### Codex CLI

- Edit your ~/.codex/config.toml and add the MCP entry:
  ```toml
  [mcp_servers.yetibrowser-mcp]
  command = "npx"
  args = ["yetibrowser-mcp", "--ws-port", "9010"]
  ```
- Restart `codex` CLI command; you should see `yetibrowser-mcp` listing under `/mcp` tools.

### Claude Code

- Make sure the extension is installed and connected to a tab, then start the MCP server with `npx yetibrowser-mcp --ws-port 9010` (or run the locally built CLI).
- Add the server entry to `~/Library/Application Support/Claude/claude_desktop_config.json` (see the example in [`docs/publishing.md`](docs/publishing.md)).
- Restart `claude` so it picks up the new MCP server; you should see `yetibrowser-mcp` listed under the `/mcp` tools menu once the extension connects.

### Other MCP-aware clients

- Any MCP client can connect by spawning the CLI (`npx yetibrowser-mcp --ws-port 9010`) and pointing it at the Chrome extension port.
- The server exposes the standard MCP transport over stdio, so use whatever configuration mechanism your client supports to run the command above when a tab is connected.

### MCP Inspector

- For testing and debugging outside a coding agent.
- `npx @modelcontextprotocol/inspector yetibrowser-mcp -- --ws-port 9010` to run and inspect the MCP server in conjunction with the YetiBrowser MCP browser extension.

### Troubleshooting

- The CLI automatically tries the range `9010-9020` if the default WebSocket port is busy, and the extension follows suit. Watch the log for `switched to` messages to see which port was picked.
- If you prefer a specific port outside that range, pass `--ws-port <port>`; the extension will stick to that exact number.
- The extension popup lets you toggle between automatic rotation and a manual WebSocket port. Choose “Manual port”, enter the value, and click Apply. Switch back to “Automatic” to return to the 9010-9020 pool.

### Sharing one MCP server across multiple clients

You can expose a Streamable HTTP endpoint for clients that prefer HTTP transport, but the MCP SDK currently limits each endpoint to a single active session. If a second client asks to initialize, it will receive `Server already initialized` until the first session ends (or you restart the server).

Run the CLI manually if you want an HTTP endpoint:

```bash
npx yetibrowser-mcp --ws-port 9010 
```

- The extension still connects via WebSocket.
- Point your MCP client at `http://127.0.0.1:9400/mcp`.
- When you’re done, close the client so the session releases; otherwise restart the CLI before another client connects.

For concurrent IDE sessions, launch separate CLI instances—port rotation keeps them from colliding.

## Documentation & build scripts

- Workspace commands live in [`docs/workspace-commands.md`](docs/workspace-commands.md).
- Publishing steps (npm + extension stores) are in [`docs/publishing.md`](docs/publishing.md).
- Screenshot behaviour is documented in [`docs/screenshot.md`](docs/screenshot.md).
- Generate distributable Chrome/Firefox zips with `./scripts/package-extensions.sh` (outputs to `artifacts/`).
- A repository-level privacy policy is available in [`PRIVACY.md`](PRIVACY.md).
