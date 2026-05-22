import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(repoRoot, "vendor-private", "cloakbrowser");
const destination = path.join(repoRoot, "src-tauri", "resources", "cloakbrowser");

await mkdir(destination, { recursive: true });

if (!existsSync(source)) {
  console.log(
    "CloakBrowser private runtime not found; skipping internal runtime copy.",
  );
  process.exit(0);
}

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
await writeFile(path.join(destination, ".gitkeep"), "");
console.log(`Copied CloakBrowser private runtime from ${source}`);
