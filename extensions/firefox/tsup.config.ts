import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    background: "../shared/src/background/index.ts",
    popup: "../shared/src/popup/index.ts",
  },
  outDir: "dist",
  format: ["esm"],
  target: "es2022",
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
});
