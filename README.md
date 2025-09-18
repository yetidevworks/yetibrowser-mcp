# YetiBrowser MCP

An open, hackable alternative to BrowserMCP that keeps the useful workflow (MCP server + Chrome extension) while avoiding closed-source dependencies. This repository is split into:

- `packages/shared` – shared TypeScript definitions for messages and tool schemas
- `packages/server` – the Model Context Protocol server that bridges MCP clients to a running Chrome tab
- `extension` – a Chrome extension that exposes the active tab to the server without hijacking navigation

Development still in progress – expect rough edges while we bootstrap the new stack.

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

### Other MCP-aware clients
- Any MCP client can connect by spawning the CLI (`npx yetibrowser-mcp --ws-port 9010`) and pointing it at the Chrome extension port.
- The server exposes the standard MCP transport over stdio, so use whatever configuration mechanism your client supports to run the command above when a tab is connected.

## Development Workspace commands

### MCP server (`packages/server`)
- `npm run build --workspace @yetidevworks/server` – bundle the server into `dist/`
- `npm run dev --workspace @yetidevworks/server` – start the server in watch mode for local development
- `npm run clean --workspace @yetidevworks/server` – remove build artifacts

### Chrome extension (`extension`)
- `npm run build --workspace extension` – compile the unpacked extension into `extension/dist`
- `npm run lint --workspace extension` – run eslint over the extension source

### Repository-wide
- `npm run typecheck` – run the TypeScript project references build across all workspaces
- `npm run lint` – lint all packages and the extension
- `npm test` – placeholder hook (currently prints `No tests yet`)

