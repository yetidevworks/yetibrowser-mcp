import zodToJsonSchema from "zod-to-json-schema";
import { z } from "zod";

import type { ToolResponse } from "@yetidevworks/shared";

import { ExtensionContext } from "./context.js";

export interface Tool {
  schema: {
    name: string;
    description: string;
    inputSchema: unknown;
  };
  handle: (context: ExtensionContext, params: unknown) => Promise<ToolResponse>;
}

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
    .describe(
      "Array of values to select in the dropdown. This can be a single value or multiple values.",
    ),
});

const ScreenshotSchema = z.object({
  fullPage: z
    .boolean()
    .optional()
    .describe("Whether to capture the full page instead of the visible viewport"),
});

function noInputSchema() {
  return zodToJsonSchema(z.object({}));
}

function buildSnapshotTool(name: string, description: string, command: "navigate" | "goBack" | "goForward") {
  const isNavigate = command === "navigate";
  const inputSchema = isNavigate ? zodToJsonSchema(NavigateSchema) : noInputSchema();

  return {
    schema: {
      name,
      description,
      inputSchema,
    },
    handle: async (context: ExtensionContext, params: unknown) => {
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
  } satisfies Tool;
}

export function createTools(): Tool[] {
  const snapshotTool: Tool = {
    schema: {
      name: "browser_snapshot",
      description:
        "Capture accessibility snapshot of the current page. Use this for getting references to elements to interact with.",
      inputSchema: noInputSchema(),
    },
    handle: async (context) => {
      return context.captureSnapshot();
    },
  };

  const snapshotDiffTool: Tool = {
    schema: {
      name: "browser_snapshot_diff",
      description: "Compare the most recent snapshot with the previous one to highlight DOM changes",
      inputSchema: noInputSchema(),
    },
    handle: async (context) => {
      return context.diffLatestSnapshots();
    },
  };

  const waitTool: Tool = {
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

  const pressKeyTool: Tool = {
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

  const clickTool: Tool = {
    schema: {
      name: "browser_click",
      description: "Perform click on a web page",
      inputSchema: zodToJsonSchema(ElementTargetSchema),
    },
    handle: async (context, params) => {
      const parsed = ElementTargetSchema.parse(params);
      await context.call("click", { selector: parsed.selector, description: parsed.description });
      return context.captureSnapshot(
        `Clicked "${parsed.description ?? parsed.selector}"`,
      );
    },
  };

  const hoverTool: Tool = {
    schema: {
      name: "browser_hover",
      description: "Hover over element on page",
      inputSchema: zodToJsonSchema(ElementTargetSchema),
    },
    handle: async (context, params) => {
      const parsed = ElementTargetSchema.parse(params);
      await context.call("hover", { selector: parsed.selector, description: parsed.description });
      return context.captureSnapshot(
        `Hovered over "${parsed.description ?? parsed.selector}"`,
      );
    },
  };

  const typeTool: Tool = {
    schema: {
      name: "browser_type",
      description: "Type text into editable element",
      inputSchema: zodToJsonSchema(TypeSchema),
    },
    handle: async (context, params) => {
      const { selector, text, submit, description } = TypeSchema.parse(params);
      await context.call("type", { selector, text, submit, description });
      return context.captureSnapshot(
        `Typed "${text}" into "${description ?? selector}"`,
      );
    },
  };

  const selectOptionTool: Tool = {
    schema: {
      name: "browser_select_option",
      description: "Select an option in a dropdown",
      inputSchema: zodToJsonSchema(SelectOptionSchema),
    },
    handle: async (context, params) => {
      const { selector, values, description } = SelectOptionSchema.parse(params);
      await context.call("selectOption", { selector, values, description });
      return context.captureSnapshot(
        `Selected option in "${description ?? selector}"`,
      );
    },
  };

  const screenshotTool: Tool = {
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

  const consoleLogsTool: Tool = {
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

  const pageStateTool: Tool = {
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

  return [
    snapshotTool,
    snapshotDiffTool,
    buildSnapshotTool("browser_navigate", "Navigate to a URL", "navigate"),
    buildSnapshotTool("browser_go_back", "Go back to the previous page", "goBack"),
    buildSnapshotTool("browser_go_forward", "Go forward to the next page", "goForward"),
    waitTool,
    pressKeyTool,
    clickTool,
    hoverTool,
    typeTool,
    selectOptionTool,
    screenshotTool,
    consoleLogsTool,
    pageStateTool,
  ];
}
