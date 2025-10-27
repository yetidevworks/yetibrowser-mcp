import zodToJsonSchema from "zod-to-json-schema";
import { z } from "zod";
const ElementTargetSchema = z.object({
    selector: z
        .string()
        .min(1)
        .describe("CSS selector that uniquely identifies the target element"),
    description: z
        .string()
        .optional()
        .describe("Optional human-readable description of the element"),
});
const NavigateSchema = z.object({
    url: z.string().describe("The URL to navigate to"),
});
const WaitSchema = z.object({
    seconds: z
        .number()
        .min(0)
        .describe("The time to wait in seconds"),
});
const PressKeySchema = z.object({
    key: z
        .string()
        .min(1)
        .describe("Name of the key to press or a character to generate, such as `ArrowLeft` or `a`"),
});
const TypeSchema = ElementTargetSchema.extend({
    text: z.string().describe("Text to type into the element"),
    submit: z
        .boolean()
        .default(false)
        .describe("Whether to submit entered text (press Enter after)"),
});
const SelectOptionSchema = ElementTargetSchema.extend({
    values: z
        .array(z.string())
        .nonempty()
        .describe("Array of values to select in the dropdown. This can be a single value or multiple values."),
});
const ScreenshotSchema = z.object({
    fullPage: z
        .boolean()
        .optional()
        .describe("Whether to capture the full page instead of the visible viewport"),
});
const WaitForSelectorSchema = z.object({
    selector: z
        .string()
        .min(1)
        .describe("CSS selector to wait for"),
    timeoutMs: z
        .number()
        .int()
        .min(0)
        .max(120_000)
        .optional()
        .describe("Optional timeout in milliseconds. Defaults to 5000ms."),
    visible: z
        .boolean()
        .optional()
        .describe("When true, wait until the element is visible (non-zero size and not hidden)"),
});
const FormFieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const FormFieldSchema = z
    .object({
    selector: z
        .string()
        .min(1)
        .describe("CSS selector for the form control to update"),
    value: FormFieldValueSchema.optional().describe("Value to apply to the field (string/number/boolean)"),
    values: z
        .array(z.string())
        .nonempty()
        .optional()
        .describe("List of values to select for multi-select inputs"),
    submit: z
        .boolean()
        .optional()
        .describe("Submit the containing form after setting this field"),
    description: z
        .string()
        .optional()
        .describe("Optional description to help debugging errors"),
    type: z
        .enum(["auto", "text", "textarea", "select", "checkbox", "radio", "contentEditable"])
        .optional()
        .describe("Override automatic element detection"),
})
    .refine((data) => typeof data.value !== "undefined" || data.values, {
    message: "Provide either a value or values for each form field",
    path: ["value"],
});
const FillFormSchema = z.object({
    fields: z.array(FormFieldSchema).min(1),
});
const EvaluateSchema = z.object({
    script: z
        .string()
        .min(1)
        .describe("JavaScript function expression to execute in the page context, e.g. `(el) => el.textContent`"),
    args: z
        .array(z.any())
        .optional()
        .describe("Optional array of arguments passed to the function"),
    timeoutMs: z
        .number()
        .int()
        .min(0)
        .max(120_000)
        .optional()
        .describe("Optional timeout in milliseconds. Defaults to no timeout."),
});
const HandleDialogSchema = z.object({
    action: z
        .enum(["accept", "dismiss"])
        .describe("Whether to accept or dismiss the active JavaScript dialog"),
    promptText: z
        .string()
        .optional()
        .describe("Optional text to enter into prompt dialogs before accepting"),
});
const DragSchema = z.object({
    fromSelector: z
        .string()
        .min(1)
        .describe("CSS selector for the element to start the drag from"),
    toSelector: z
        .string()
        .min(1)
        .describe("CSS selector for the element to drop onto"),
    steps: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Optional number of intermediate drag steps. Defaults to 12."),
    description: z
        .string()
        .optional()
        .describe("Optional human-readable description of the drag target"),
});
function noInputSchema() {
    return zodToJsonSchema(z.object({}));
}
function buildSnapshotTool(name, description, command) {
    const isNavigate = command === "navigate";
    const inputSchema = isNavigate ? zodToJsonSchema(NavigateSchema) : noInputSchema();
    return {
        schema: {
            name,
            description,
            inputSchema,
        },
        handle: async (context, params) => {
            if (isNavigate) {
                const { url } = NavigateSchema.parse(params);
                await context.call("navigate", { url });
                return context.captureSnapshot(`Navigated to ${url}`);
            }
            if (command === "goBack") {
                await context.call("goBack", {});
                return context.captureSnapshot("Navigated back");
            }
            await context.call("goForward", {});
            return context.captureSnapshot("Navigated forward");
        },
    };
}
export function createTools() {
    const snapshotTool = {
        schema: {
            name: "browser_snapshot",
            description: "Capture accessibility snapshot of the current page. Use this for getting references to elements to interact with.",
            inputSchema: noInputSchema(),
        },
        handle: async (context) => {
            return context.captureSnapshot();
        },
    };
    const snapshotDiffTool = {
        schema: {
            name: "browser_snapshot_diff",
            description: "Compare the most recent snapshot with the previous one to highlight DOM changes",
            inputSchema: noInputSchema(),
        },
        handle: async (context) => {
            return context.diffLatestSnapshots();
        },
    };
    const waitTool = {
        schema: {
            name: "browser_wait",
            description: "Wait for a specified time in seconds",
            inputSchema: zodToJsonSchema(WaitSchema),
        },
        handle: async (context, params) => {
            const { seconds } = WaitSchema.parse(params);
            await context.call("wait", { seconds });
            return {
                content: [
                    {
                        type: "text",
                        text: `Waited for ${seconds} seconds`,
                    },
                ],
            };
        },
    };
    const waitForTool = {
        schema: {
            name: "browser_wait_for",
            description: "Wait until a selector appears (optionally visible) before continuing. Returns a fresh snapshot after the element is detected.",
            inputSchema: zodToJsonSchema(WaitForSelectorSchema),
        },
        handle: async (context, params) => {
            const { selector, timeoutMs, visible } = WaitForSelectorSchema.parse(params);
            await context.call("waitFor", { selector, timeoutMs, visible });
            const parts = [
                `Waited for selector "${selector}".`,
                visible ? "Required element to be visible." : undefined,
                typeof timeoutMs === "number" ? `Timeout: ${timeoutMs}ms.` : undefined,
            ].filter(Boolean);
            parts.push('Call `browser_snapshot` if you need a refreshed DOM listing.');
            return {
                content: [
                    {
                        type: "text",
                        text: parts.join(" "),
                    },
                ],
            };
        },
    };
    const pressKeyTool = {
        schema: {
            name: "browser_press_key",
            description: "Press a key on the keyboard",
            inputSchema: zodToJsonSchema(PressKeySchema),
        },
        handle: async (context, params) => {
            const { key } = PressKeySchema.parse(params);
            await context.call("pressKey", { key });
            return {
                content: [
                    {
                        type: "text",
                        text: `Pressed key ${key}`,
                    },
                ],
            };
        },
    };
    const clickTool = {
        schema: {
            name: "browser_click",
            description: "Perform click on a web page",
            inputSchema: zodToJsonSchema(ElementTargetSchema),
        },
        handle: async (context, params) => {
            const parsed = ElementTargetSchema.parse(params);
            await context.call("click", { selector: parsed.selector, description: parsed.description });
            return context.captureSnapshot(`Clicked "${parsed.description ?? parsed.selector}"`);
        },
    };
    const hoverTool = {
        schema: {
            name: "browser_hover",
            description: "Hover over element on page",
            inputSchema: zodToJsonSchema(ElementTargetSchema),
        },
        handle: async (context, params) => {
            const parsed = ElementTargetSchema.parse(params);
            await context.call("hover", { selector: parsed.selector, description: parsed.description });
            return context.captureSnapshot(`Hovered over "${parsed.description ?? parsed.selector}"`);
        },
    };
    const dragTool = {
        schema: {
            name: "browser_drag",
            description: "Drag an element (like cards in a kanban board) onto a target element. Useful for sortable UIs.",
            inputSchema: zodToJsonSchema(DragSchema),
        },
        handle: async (context, params) => {
            const { fromSelector, toSelector, steps, description } = DragSchema.parse(params);
            await context.call("drag", { fromSelector, toSelector, steps, description });
            const summary = [
                `Dragged "${fromSelector}" onto "${toSelector}".`,
                typeof steps === "number" ? `Steps: ${steps}.` : undefined,
                description ? `Context: ${description}.` : undefined,
                'Run `browser_snapshot` if you need a DOM snapshot after the drag.',
            ]
                .filter(Boolean)
                .join(" ");
            return {
                content: [
                    {
                        type: "text",
                        text: summary,
                    },
                ],
            };
        },
    };
    const typeTool = {
        schema: {
            name: "browser_type",
            description: "Type text into editable element",
            inputSchema: zodToJsonSchema(TypeSchema),
        },
        handle: async (context, params) => {
            const { selector, text, submit, description } = TypeSchema.parse(params);
            await context.call("type", { selector, text, submit, description });
            return context.captureSnapshot(`Typed "${text}" into "${description ?? selector}"`);
        },
    };
    const fillFormTool = {
        schema: {
            name: "browser_fill_form",
            description: "Fill multiple form fields in a single call. Supports inputs, textareas, selects, checkboxes, and radios.",
            inputSchema: zodToJsonSchema(FillFormSchema),
        },
        handle: async (context, params) => {
            const { fields } = FillFormSchema.parse(params);
            const result = await context.call("fillForm", { fields });
            const summaryLines = [
                `Filled ${result.filled}/${result.attempted} fields.`,
                result.errors.length
                    ? `Issues:\n${result.errors.map((err) => `- ${err}`).join("\n")}`
                    : "No validation errors reported.",
                'Call `browser_snapshot` if you need to inspect the page state after filling.',
            ];
            return {
                content: [
                    {
                        type: "text",
                        text: summaryLines.join("\n"),
                    },
                ],
            };
        },
    };
    const selectOptionTool = {
        schema: {
            name: "browser_select_option",
            description: "Select an option in a dropdown",
            inputSchema: zodToJsonSchema(SelectOptionSchema),
        },
        handle: async (context, params) => {
            const { selector, values, description } = SelectOptionSchema.parse(params);
            await context.call("selectOption", { selector, values, description });
            return context.captureSnapshot(`Selected option in "${description ?? selector}"`);
        },
    };
    const screenshotTool = {
        schema: {
            name: "browser_screenshot",
            description: "Take a screenshot of the current page",
            inputSchema: zodToJsonSchema(ScreenshotSchema),
        },
        handle: async (context, params) => {
            const { fullPage } = ScreenshotSchema.parse(params);
            const result = await context.call("screenshot", { fullPage });
            return {
                content: [
                    {
                        type: "image",
                        data: result.data,
                        mimeType: result.mimeType,
                    },
                ],
            };
        },
    };
    const consoleLogsTool = {
        schema: {
            name: "browser_get_console_logs",
            description: "Get the console logs from the browser",
            inputSchema: noInputSchema(),
        },
        handle: async (context) => {
            const logs = await context.call("getConsoleLogs", {});
            const text = logs
                .map((log) => {
                const time = new Date(log.timestamp).toISOString();
                const lines = [`[${time}] [${log.level}] ${log.message}`];
                if (log.stack) {
                    lines.push(log.stack);
                }
                return lines.join("\n");
            })
                .join("\n\n");
            return {
                content: [
                    {
                        type: "text",
                        text: text || "No console output captured",
                    },
                ],
            };
        },
    };
    const pageStateTool = {
        schema: {
            name: "browser_page_state",
            description: "Extract form data, storage values, and cookies from the active page",
            inputSchema: noInputSchema(),
        },
        handle: async (context) => {
            const state = await context.call("pageState", {});
            const summary = [
                `Page state captured ${state.capturedAt}`,
                `- Forms inspected: ${state.forms.length}`,
                `- localStorage keys: ${state.localStorage.length}`,
                `- sessionStorage keys: ${state.sessionStorage.length}`,
                `- Cookies: ${state.cookies.length}`,
                "",
                "```json",
                JSON.stringify(state, null, 2),
                "```",
            ].join("\n");
            return {
                content: [
                    {
                        type: "text",
                        text: summary,
                    },
                ],
            };
        },
    };
    const evaluateTool = {
        schema: {
            name: "browser_evaluate",
            description: "Run custom JavaScript inside the page context and return the JSON-serializable result.",
            inputSchema: zodToJsonSchema(EvaluateSchema),
        },
        handle: async (context, params) => {
            const { script, args, timeoutMs } = EvaluateSchema.parse(params);
            const { value } = await context.call("evaluate", { script, args, timeoutMs });
            let formatted;
            try {
                formatted = JSON.stringify(value, null, 2);
            }
            catch (error) {
                formatted = String(value);
            }
            const MAX_OUTPUT = 4_000;
            if (formatted.length > MAX_OUTPUT) {
                formatted = `${formatted.slice(0, MAX_OUTPUT)}… (truncated)`;
            }
            return {
                content: [
                    {
                        type: "text",
                        text: `Evaluation result:\n\`\`\`json\n${formatted}\n\`\`\``,
                    },
                ],
            };
        },
    };
    const handleDialogTool = {
        schema: {
            name: "browser_handle_dialog",
            description: "Accept or dismiss the currently open alert/confirm/prompt dialog in the active tab.",
            inputSchema: zodToJsonSchema(HandleDialogSchema),
        },
        handle: async (context, params) => {
            const { action, promptText } = HandleDialogSchema.parse(params);
            await context.call("handleDialog", { action, promptText });
            const summary = `Dialog ${action === "accept" ? "accepted" : "dismissed"}${promptText ? ` with prompt text "${promptText}"` : ""}.`;
            return {
                content: [
                    {
                        type: "text",
                        text: summary,
                    },
                ],
            };
        },
    };
    const connectionInfoTool = {
        schema: {
            name: "browser_connection_info",
            description: "Show the MCP bridge WebSocket port, connection state, and extension info",
            inputSchema: noInputSchema(),
        },
        handle: async (context) => {
            const info = context.getConnectionInfo();
            const lines = [
                `WebSocket port: ${info.wsPort}`,
                `Extension connected: ${info.connected ? "yes" : "no"}`,
            ];
            if (info.extension) {
                const versionSuffix = info.extension.version ? ` v${info.extension.version}` : "";
                lines.push(`Extension hello: ${info.extension.client}${versionSuffix}`);
            }
            return {
                content: [
                    {
                        type: "text",
                        text: lines.join("\n"),
                    },
                ],
            };
        },
    };
    return [
        snapshotTool,
        snapshotDiffTool,
        buildSnapshotTool("browser_navigate", "Navigate to a URL", "navigate"),
        buildSnapshotTool("browser_go_back", "Go back to the previous page", "goBack"),
        buildSnapshotTool("browser_go_forward", "Go forward to the next page", "goForward"),
        waitTool,
        waitForTool,
        pressKeyTool,
        clickTool,
        hoverTool,
        dragTool,
        typeTool,
        fillFormTool,
        selectOptionTool,
        screenshotTool,
        consoleLogsTool,
        pageStateTool,
        evaluateTool,
        handleDialogTool,
        connectionInfoTool,
    ];
}
//# sourceMappingURL=tools.js.map