import * as readline from "node:readline";

const message = {
  type: "request",
  id: "test-1",
  method: "tools.call",
  params: {
    name: "browser_get_console_logs",
    arguments: {},
  },
};

function send(obj: unknown) {
  const json = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
}

const rl = readline.createInterface({ input: process.stdin });
let state: "headers" | "body" = "headers";
let contentLength = 0;
let body = "";

rl.on("line", (line) => {
  if (state === "headers") {
    if (line.toLowerCase().startsWith("content-length:")) {
      contentLength = Number(line.split(":")[1].trim());
    }
    if (line === "") {
      state = "body";
      if (contentLength === 0) {
        console.error("Received empty body");
        state = "headers";
      }
    }
    return;
  }

  body += line + "\n";
  if (Buffer.byteLength(body, "utf8") >= contentLength) {
    try {
      const parsed = JSON.parse(body.trim());
      console.error("<--", JSON.stringify(parsed, null, 2));
    } catch (error) {
      console.error("Failed to parse response", error);
    }
    state = "headers";
    body = "";
    contentLength = 0;
  }
});

send(message);
