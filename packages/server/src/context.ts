import type {
  CommandName,
  CommandPayload,
  CommandResult,
  ToolResponse,
} from "@yetidevworks/shared";

import { ExtensionBridge } from "./bridge.js";

export class ExtensionContext {
  constructor(private readonly bridge: ExtensionBridge) {}

  async call<K extends CommandName>(
    command: K,
    payload: CommandPayload<K> | undefined = undefined,
  ): Promise<CommandResult<K>> {
    const finalPayload = (payload ?? ({} as CommandPayload<K>));
    return (await this.bridge.send(command, finalPayload)) as CommandResult<K>;
  }

  async captureSnapshot(statusMessage = ""): Promise<ToolResponse> {
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
