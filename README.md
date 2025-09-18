# YetiBrowser MCP

An open, hackable alternative to BrowserMCP that keeps the useful workflow (MCP server + Chrome extension) while avoiding closed-source dependencies. This repository is split into:

- `packages/shared` – shared TypeScript definitions for messages and tool schemas
- `packages/server` – the Model Context Protocol server that bridges MCP clients to a running Chrome tab
- `extensions/shared` – shared browser extension source (background/popup) and assets
- `extensions/chrome` – Chrome packaging for the shared extension code
- `extensions/firefox` – Firefox packaging for the shared extension code

Development still in progress – expect rough edges while we bootstrap the new stack.

## Current tooling

- DOM snapshots with diffing (`browser_snapshot`, `browser_snapshot_diff`) to understand how the page changes over time
- Console and error capture (`browser_get_console_logs`) including stack traces for quick debugging
- Page state extraction (`browser_page_state`) that gathers form inputs, storage contents, and cookies for reproduction steps

## MCP client configuration

### Codex CLI

- Edit your ~/.codex/config.toml and add the MCP entry

[mcp_servers.yetibrowser-mcp]
command = "npx"
args = ["yetibrowser-mcp", "--ws-port", "9010"]

### Claude Code / Claude Desktop
- Make sure the extension is installed and connected to a tab, then start the MCP server with `npx yetibrowser-mcp --ws-port 9010` (or run the locally built CLI).
- Create or update `~/Library/Application Support/Claude/claude_desktop_config.json`:
  ```json
  {
    "mcpServers": {
      "yetibrowser-mcp": {
        "command": "npx",
        "args": ["yetibrowser-mcp", "--ws-port", "9010"]
      }
    }
  }
  ```
- Restart Claude so it picks up the new MCP server; you should see `yetibrowser-mcp` listed under the MCP tools menu once the extension connects.

### MCP Inspector

- `npx @modelcontextprotocol/inspector yetibrowser-mcp -- --ws-port 9010` to run and inspect the MCP server in conjuction with the yetibrowser extension

### Other MCP-aware clients
- Any MCP client can connect by spawning the CLI (`npx yetibrowser-mcp --ws-port 9010`) and pointing it at the Chrome extension port.
- The server exposes the standard MCP transport over stdio, so use whatever configuration mechanism your client supports to run the command above when a tab is connected.

## Workspace commands

### MCP server (`packages/server`)
- `npm run build --workspace @yetidevworks/server` – bundle the server into `dist/`
- `npm run dev --workspace @yetidevworks/server` – start the server in watch mode for local development
- `npm run clean --workspace @yetidevworks/server` – remove build artifacts

### Chrome extension (`extensions/chrome`)
- `npm run build --workspace yetibrowser-extension` – compile the unpacked Chrome extension into `extensions/chrome/dist`
- `npm run lint --workspace yetibrowser-extension` – run eslint over the shared extension source

### Firefox extension (`extensions/firefox`)
- `npm run build --workspace yetibrowser-extension-firefox` – compile the unpacked Firefox extension into `extensions/firefox/dist`
- `npm run lint --workspace yetibrowser-extension-firefox` – run eslint over the shared extension source

### Repository-wide
- `npm run typecheck` – run the TypeScript project references build across all workspaces
- `npm run lint` – lint all packages and the extension
- `npm test` – placeholder hook (currently prints `No tests yet`)
