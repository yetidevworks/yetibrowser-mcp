# YetiBrowser MCP

An open, hackable alternative to BrowserMCP that keeps the useful workflow (MCP server + Chrome extension) while avoiding closed-source dependencies. This repository is split into:

- `packages/shared` – shared TypeScript definitions for messages and tool schemas
- `packages/server` – the Model Context Protocol server that bridges MCP clients to a running Chrome tab
- `extension` – a Chrome extension that exposes the active tab to the server without hijacking navigation

Development still in progress – expect rough edges while we bootstrap the new stack.
