# Technical Screenshot Tool Notes

The `browser_screenshot` tool now targets the connected tab directly:

- Chrome/Chromium: uses the DevTools Protocol (`Page.captureScreenshot`) via `chrome.debugger`. When `fullPage` is true, it captures beyond the viewport and restores the original metrics afterwards.
- Fallback: if the debugger call is unavailable or fails (for example on restricted pages or in browsers without the debugger API), the extension falls back to `chrome.tabs.captureVisibleTab`.
- Output: images are re-encoded to WebP (or JPEG fallback) and scaled down to a maximum width of 1280px to keep payload sizes small for MCP clients.

### Firefox Status

Firefox’s debugger API is available, but DevTools screenshot support differs. The fallback (`browser.tabs.captureTab`) still captures the active tab. A Firefox-specific implementation using `browser.debugger.sendCommand` should be evaluated separately.
