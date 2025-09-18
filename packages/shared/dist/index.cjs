"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  TOOL_NAMES: () => TOOL_NAMES
});
module.exports = __toCommonJS(index_exports);
var TOOL_NAMES = {
  SNAPSHOT: "browser_snapshot",
  NAVIGATE: "browser_navigate",
  GO_BACK: "browser_go_back",
  GO_FORWARD: "browser_go_forward",
  WAIT: "browser_wait",
  PRESS_KEY: "browser_press_key",
  CLICK: "browser_click",
  HOVER: "browser_hover",
  TYPE: "browser_type",
  SELECT_OPTION: "browser_select_option",
  SCREENSHOT: "browser_screenshot",
  CONSOLE_LOGS: "browser_get_console_logs"
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TOOL_NAMES
});
