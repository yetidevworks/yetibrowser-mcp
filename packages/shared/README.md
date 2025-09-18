# @yetidevworks/shared

Shared TypeScript schemas and utility types used by the YetiBrowser MCP server and browser extensions. Install this package if you want to build custom MCP tooling, write tests, or extend the protocol.

- Command payload/result maps for every YetiBrowser tool (`browser_snapshot`, `browser_click`, etc.).
- Convenience helpers for tool names and response types.
- Published as ES modules with type definitions.

## Installation

```bash
npm install @yetidevworks/shared
```

## Usage

```ts
import {
  TOOL_NAMES,
  CommandPayloadMap,
  CommandResultMap,
} from "@yetidevworks/shared";

// Example: strongly-typed payload for browser_click
const payload: CommandPayloadMap["click"] = {
  selector: "button.submit",
  description: "Submit order",
};

console.log(TOOL_NAMES.CLICK); // "browser_click"
```

## Exports

- `CommandPayloadMap` / `CommandResultMap` – payload and result shapes for each YetiBrowser tool.
- `CommandName` / `CommandPayload<K>` / `CommandResult<K>` – generics for building typed helpers.
- `TOOL_NAMES` – constant list of tool identifiers exposed by the server.
- `ToolResponse` – standard response wrapper used by the CLI.

See the [monorepo documentation](https://github.com/yetidevworks/yetibrowser-mcp) for the full list of tools and usage examples.

