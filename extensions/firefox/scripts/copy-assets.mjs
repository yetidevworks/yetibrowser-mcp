import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const distDir = join(projectRoot, "dist");

await mkdir(distDir, { recursive: true });

await cp(join(projectRoot, "manifest.json"), join(distDir, "manifest.json"));

try {
  await cp(join(projectRoot, "../shared/public"), distDir, { recursive: true });
} catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}
