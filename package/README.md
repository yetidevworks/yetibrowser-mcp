# MCP server

### Inspector

- The client UI runs on port 9001 (the default of 5173 conflicts with the extension's Vite server)
- The MCP proxy server runs on port 9002 (the default of 3000 conflicts with the `marketing` app)

1. Run `pnpm build` or `pnpm watch` to build `dist/index.js`
2. Run `pnpm inspector` to start the inspector
3. Navigate to `http://localhost:9001?proxyPort=9002` to open the inspector UI
4. Click the `Connect` button to run `dist/index.js` and start the MCP server

### Publishing

1. `npm login`
2. `npm publish --access public`
