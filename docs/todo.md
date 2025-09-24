# Future Enhancements

The items below capture follow-up ideas discussed for improving the YetiBrowser MCP tooling: 

- [x] **Multi-instance port management**: allow multiple MCP clients to launch servers without conflicting ports (discover running instances, auto-select/free ports, or expose port switching in the extension UI).
- [ ] **Network insights**: surface recent requests/responses, timings, and export HAR data for auditing APIs and asset performance.
- [ ] **Request stubbing & blocking**: allow developers to mock or block specific URLs directly from the MCP session to simulate backend states.
- [ ] **Automated test boilerplate**: generate Playwright/Cypress snippets from recent MCP actions to bootstrap automated regression coverage.
- [ ] **Performance hooks**: trigger lightweight audits (Lighthouse metrics, long-task detection) and report layout shifts or paint timings.
- [ ] **CSS inspection helpers**: capture computed styles, box metrics, and provide element-highlighting utilities geared toward debugging layout issues.
- [ ] **Enhanced capture tools**: add element-only screenshots, clipped selections, or short recordings (GIF/WebM) for richer bug reports.
- [ ] **CLI utilities**: expose headless scripts (e.g., `yetibrowser-ci`) so teams can run repeatable smoke flows in CI without custom harnesses.



