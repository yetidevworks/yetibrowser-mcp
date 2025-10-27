# Publishing Guide

This file outlines the steps we followed for preparing the MCP server and browser extensions for distribution. Use it as a checklist when moving the project under the new organization. Useful for me with my terrible memory, but also for anyone who wants to help and improve the project.

## npm Packages

We publish two workspaces: shared types and the MCP server CLI.

### Automated prep

Run the release helper to bump versions, rebuild, and refresh lockfiles:

```bash
npm run prepare-release -- 1.1.0   # replace with the next version
```

The script updates all package.json files, sets the server’s dependency on the shared package, runs `npm install`, and rebuilds both workspaces. Review the git diff before publishing.

### @yetidevworks/shared (types)

1. Ensure `package.json` contains:
   - `"files": ["dist"]`
   - `"scripts.prepublishOnly": "npm run clean && npm run build"`
   - `"publishConfig.access": "public"`
2. Build before publishing: `npm run build --workspace @yetidevworks/shared`.
3. Publish: `npm publish --workspace @yetidevworks/shared`.

### @yetidevworks/server (CLI)

1. `package.json` requirements:
   - `"bin": { "yetibrowser-mcp": "dist/index.js" }`
   - `"files": ["dist"]`
   - `"scripts.prepublishOnly": "npm run clean && npm run build"`
   - `"dependencies": { "@yetidevworks/shared": "<matching version>" }`
2. Build the CLI: `npm run build --workspace @yetidevworks/server`.
3. Publish after the shared package: `npm publish --workspace @yetidevworks/server`.
4. Once both are live, Codex config can use:
   ```toml
   [mcp_servers.yetibrowser-mcp]
   command = "npx"
   args = ["yetibrowser-mcp", "--ws-port", "9010"]
   ```

### Local NPX Smoke Test

Before publishing, you can simulate `npx` by running the compiled entry directly:

```bash
npm run build --workspace @yetidevworks/shared
npm run build --workspace @yetidevworks/server
node packages/server/dist/index.js --ws-port 9010
```

From another terminal: `npx --yes /path/to/packages/server --ws-port 9010` (or `npm link`).

## Chrome Web Store Packaging

1. Update `extensions/chrome/manifest.json` with final metadata (`name`, `description`, `version`, optional `homepage_url`).
2. Ensure icons (16/32/48/128) exist under `extensions/shared/public/icons/`.
3. Build the bundle: `npm run build --workspace yetibrowser-extension`.
4. Zip the `extensions/chrome/dist` directory for upload: `cd extensions/chrome/dist && zip -r ../yetibrowser-mcp-chrome.zip .`.
5. In the Chrome Web Store dashboard:
   - Upload the zip.
   - Provide screenshots (1280×800 or 1280×720), icon, short/long description.
   - Complete the privacy questionnaire explaining the use of `debugger`, `tabs`, `scripting`, and `<all_urls`.
   - Submit for review.
6. For updates, bump the `version` field in `manifest.json`, rebuild, re-zip, and upload.

## Firefox Add-ons Packaging

1. Update `extensions/firefox/manifest.json` with Firefox-specific metadata (especially `browser_specific_settings.gecko`).
2. Verify shared icons under `extensions/shared/public/icons/` still meet Mozilla's size requirements.
3. Build the bundle: `npm run build --workspace yetibrowser-extension-firefox`.
4. Zip the `extensions/firefox/dist` directory for upload: `cd extensions/firefox/dist && zip -r ../yetibrowser-mcp-firefox.zip .`.
5. In the Firefox Add-ons dashboard:
   - Upload the zip and choose the appropriate channel (listed/unlisted/self-hosted).
   - Provide metadata, screenshots, and privacy disclosures matching the Chrome listing.
   - Submit for review.
6. For updates, bump the `version` field in `manifest.json`, rebuild, re-zip, and upload.

## Extension Permissions Justification

- `debugger`: attaches to the active tab to capture console logs and DOM snapshots locally.
- `tabs`: read tab URL/title and manage navigation.
- `scripting`: injects helper scripts for snapshots, clicks, typing, and logging.
- `host_permissions` `<all_urls>`: allows acting on whichever tab the user connects.

Everything stays local; the extension does not send tab data off-device.
