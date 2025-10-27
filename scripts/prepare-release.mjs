#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const nextVersion = process.argv[2];

if (!nextVersion) {
  console.error("Usage: node scripts/prepare-release.mjs <version>");
  process.exit(1);
}

const versionRegex = /^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?$/;
if (!versionRegex.test(nextVersion)) {
  console.error(`Invalid semver version: ${nextVersion}`);
  process.exit(1);
}

const files = [
  { path: "package.json", type: "root" },
  { path: "packages/shared/package.json", type: "shared" },
  { path: "packages/server/package.json", type: "server" },
];

for (const { path, type } of files) {
  const fullPath = resolve(repoRoot, path);
  const original = JSON.parse(readFileSync(fullPath, "utf8"));
  original.version = nextVersion;

  if (type === "server") {
    if (original.dependencies?.["@yetidevworks/shared"]) {
      original.dependencies["@yetidevworks/shared"] = `^${nextVersion}`;
    }
  }

  writeFileSync(fullPath, JSON.stringify(original, null, 2) + "\n");
  console.log(`• Updated ${path} → ${nextVersion}`);
}

console.log("• Installing workspace dependencies");
execSync("npm install", { cwd: repoRoot, stdio: "inherit" });

console.log("• Building shared package");
execSync("npm run build --workspace @yetidevworks/shared", {
  cwd: repoRoot,
  stdio: "inherit",
});

console.log("• Building server package");
execSync("npm run build --workspace @yetidevworks/server", {
  cwd: repoRoot,
  stdio: "inherit",
});

console.log("\nRelease prep complete!");
console.log("Next steps:");
console.log(`  1. Review & commit the version bump (git status).`);
console.log(
  "  2. Publish packages:\n     npm publish --workspace @yetidevworks/shared\n     npm publish --workspace @yetidevworks/server",
);
console.log("  3. Tag and push the release.");
