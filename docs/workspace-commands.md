## Workspace commands

### MCP shared (`packages/shared`)
- `npm run build --workspace @yetidevworks/shared` – bundle the server into `dist/`
- `npm run dev --workspace @yetidevworks/shared` – start the server in watch mode for local development
- `npm run clean --workspace @yetidevworks/shared` – remove build artifacts

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

### NPM Publishing Packages
- Rebuild the `shared` and `dev` packages 
- `npm publish --workspace @yetidevworks/shared`
- `npm publish --workspace @yetidevworks/server`

### Extension Release packaging
- `./scripts/package-extensions.sh` – rebuilds both Chrome and Firefox bundles and writes publish-ready zips to `artifacts/`