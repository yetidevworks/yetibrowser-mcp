export class ExtensionContext {
    bridge;
    snapshotHistory = [];
    constructor(bridge) {
        this.bridge = bridge;
    }
    async call(command, payload = undefined) {
        const finalPayload = (payload ?? {});
        return (await this.bridge.send(command, finalPayload));
    }
    async captureSnapshot(statusMessage = "") {
        const [{ url }, { title }, snapshotResult] = await Promise.all([
            this.call("getUrl"),
            this.call("getTitle"),
            this.call("snapshot"),
        ]);
        const record = {
            capturedAt: snapshotResult.raw.capturedAt,
            message: statusMessage,
            snapshot: snapshotResult.raw,
            formatted: snapshotResult.formatted,
            url,
            title,
        };
        this.snapshotHistory.push(record);
        if (this.snapshotHistory.length > 20) {
            this.snapshotHistory.shift();
        }
        const index = this.snapshotHistory.length;
        const statusLines = [statusMessage, `Snapshot #${index} captured at ${record.capturedAt}`]
            .filter(Boolean)
            .join("\n");
        const prefix = statusLines ? `${statusLines}\n` : "";
        const text = `${prefix}- Page URL: ${url}\n- Page Title: ${title}\n` +
            `- Page Snapshot\n\`\`\`yaml\n${snapshotResult.formatted}\n\`\`\`\n`;
        return {
            content: [
                {
                    type: "text",
                    text,
                },
            ],
        };
    }
    async diffLatestSnapshots() {
        if (this.snapshotHistory.length < 2) {
            return {
                content: [
                    {
                        type: "text",
                        text: "At least two snapshots are required to compute a diff. Capture another snapshot first.",
                    },
                ],
                isError: true,
            };
        }
        const current = this.snapshotHistory.at(-1);
        const previous = this.snapshotHistory.at(-2);
        const diff = diffSnapshots(previous.snapshot, current.snapshot);
        const summaryLines = [];
        summaryLines.push(`Diffing snapshot captured ${current.capturedAt} (Snapshot #${this.snapshotHistory.length}) against ${previous.capturedAt}`);
        summaryLines.push(`Current URL: ${current.url}`);
        if (current.url !== previous.url) {
            summaryLines.push(`Previous URL: ${previous.url}`);
        }
        summaryLines.push("Summary:");
        summaryLines.push(`- Added elements: ${diff.added.length}`);
        summaryLines.push(`- Removed elements: ${diff.removed.length}`);
        summaryLines.push(`- Changed elements: ${diff.changed.length}`);
        const formatEntry = (entry) => `selector: ${entry.selector}\n      role: ${entry.role}\n      name: ${entry.name}`;
        if (diff.added.length) {
            summaryLines.push("Added:");
            for (const entry of diff.added.slice(0, 5)) {
                summaryLines.push(`  - ${entry.selector} (${entry.role}) → "${entry.name}"`);
            }
            if (diff.added.length > 5) {
                summaryLines.push(`  - … ${diff.added.length - 5} more`);
            }
        }
        if (diff.removed.length) {
            summaryLines.push("Removed:");
            for (const entry of diff.removed.slice(0, 5)) {
                summaryLines.push(`  - ${entry.selector} (${entry.role}) → "${entry.name}"`);
            }
            if (diff.removed.length > 5) {
                summaryLines.push(`  - … ${diff.removed.length - 5} more`);
            }
        }
        if (diff.changed.length) {
            summaryLines.push("Changed:");
            for (const change of diff.changed.slice(0, 5)) {
                summaryLines.push(`  - ${change.selector}\n    before: role=${change.before.role}, name="${change.before.name}"\n    after:  role=${change.after.role}, name="${change.after.name}"`);
            }
            if (diff.changed.length > 5) {
                summaryLines.push(`  - … ${diff.changed.length - 5} more`);
            }
        }
        if (!diff.added.length && !diff.removed.length && !diff.changed.length) {
            summaryLines.push("No element-level differences detected.");
        }
        return {
            content: [
                {
                    type: "text",
                    text: summaryLines.join("\n"),
                },
            ],
        };
    }
    getConnectionInfo() {
        return {
            wsPort: this.bridge.getPort(),
            connected: this.bridge.isConnected(),
            extension: this.bridge.getHelloInfo(),
        };
    }
}
function diffSnapshots(previous, current) {
    const prevMap = new Map();
    const currentMap = new Map();
    for (const entry of previous.entries) {
        if (!prevMap.has(entry.selector)) {
            prevMap.set(entry.selector, entry);
        }
    }
    for (const entry of current.entries) {
        if (!currentMap.has(entry.selector)) {
            currentMap.set(entry.selector, entry);
        }
    }
    const added = [];
    const removed = [];
    const changed = [];
    for (const [selector, entry] of currentMap.entries()) {
        const previousEntry = prevMap.get(selector);
        if (!previousEntry) {
            added.push(entry);
            continue;
        }
        if (previousEntry.role !== entry.role || previousEntry.name !== entry.name) {
            changed.push({ selector, before: previousEntry, after: entry });
        }
    }
    for (const [selector, entry] of prevMap.entries()) {
        if (!currentMap.has(selector)) {
            removed.push(entry);
        }
    }
    return { added, removed, changed };
}
//# sourceMappingURL=context.js.map