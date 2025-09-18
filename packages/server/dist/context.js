export class ExtensionContext {
    bridge;
    constructor(bridge) {
        this.bridge = bridge;
    }
    async call(command, payload = undefined) {
        const finalPayload = (payload ?? {});
        return (await this.bridge.send(command, finalPayload));
    }
    async captureSnapshot(statusMessage = "") {
        const [{ url }, { title }, { snapshot }] = await Promise.all([
            this.call("getUrl"),
            this.call("getTitle"),
            this.call("snapshot"),
        ]);
        const statusPrefix = statusMessage ? `${statusMessage}\n` : "";
        const text = `${statusPrefix}- Page URL: ${url}\n- Page Title: ${title}\n- Page Snapshot\n\`\`\`yaml\n${snapshot}\n\`\`\`\n`;
        return {
            content: [
                {
                    type: "text",
                    text,
                },
            ],
        };
    }
}
//# sourceMappingURL=context.js.map