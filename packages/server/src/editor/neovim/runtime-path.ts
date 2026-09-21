import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ENTRY = join("lua", "paseo", "init.lua");

function resolveExternalProcessPath(filePath: string): string {
  return filePath.replace(/\.asar(?=[/\\]|$)/, ".asar.unpacked");
}

export function getPaseoNeovimRuntimePath(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDirectory, "runtime"),
    resolve(moduleDirectory, "../../../../../integrations/paseo.nvim"),
  ];
  const runtimePath = candidates.find((candidate) => existsSync(join(candidate, PLUGIN_ENTRY)));
  if (!runtimePath) {
    throw new Error("Paseo's bundled Neovim plugin is missing");
  }
  // Electron can read from app.asar, but Neovim is an external process and
  // needs the unpacked copy of the runtime directory.
  return resolveExternalProcessPath(runtimePath);
}
