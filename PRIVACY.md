# Privacy Policy

Last updated: September 18, 2025

YetiBrowser MCP is designed to keep all browser automation activity on your device. The Chrome/Firefox extension and the companion MCP server operate locally and do not transmit browsing data to external services.

## Data collection
- **No personal data leaves your device.** The extension communicates only with the YetiBrowser MCP server running on `localhost` and with the tab you explicitly connect.
- **Local storage only.** We store the connected tab ID and websocket port in `chrome.storage.local`/`browser.storage.local` so the extension can reconnect after a restart. This storage never leaves your machine.
- **No analytics or telemetry.** We do not collect metrics, device information, crash reports, or usage statistics.

## Permissions rationale
- **Tabs & host permissions** are used to connect specifically to the tab you select and to focus it when asked. No other tabs are inspected.
- **Storage** keeps only the minimal settings mentioned above.
- **Scripting** injects helper scripts into the connected tab to perform DOM snapshots, form reads, and related automation tasks that you trigger.
- **Debugger** is used temporarily to capture console output and screenshots from the connected tab. Attachment ends immediately after each action.

## Third parties
We do not integrate with third-party services, ad networks, or analytics providers. All communication occurs between the extension, the local MCP server, and the user-selected tab.

## Changes
If this policy changes, we will update this file in the GitHub repository. Your continued use after changes signifies acceptance.

## Contact
For privacy questions or concerns, open an issue on the project repository: https://github.com/yetidevworks/yetibrowser-mcp/issues
