import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openFileViaNeovimRpc } from "./rpc";

const hasNeovim = spawnSync("nvim", ["--version"], { stdio: "ignore" }).status === 0;
const processes: ReturnType<typeof spawn>[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const process of processes.splice(0)) process.kill("SIGKILL");
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32" || !hasNeovim)("Neovim msgpack RPC", () => {
  it("opens a path containing spaces and command characters as data", async () => {
    const directory = mkdtempSync(join(tmpdir(), "paseo-nvim-rpc-test-"));
    directories.push(directory);
    const socketPath = join(directory, "nvim.sock");
    const filePath = join(directory, 'a space " | quit | ".ts');
    writeFileSync(filePath, "first\nsecond\n");
    const child = spawn("nvim", ["--headless", "--clean", "--listen", socketPath], {
      stdio: "ignore",
    });
    processes.push(child);

    const deadline = Date.now() + 5_000;
    while (!existsSync(socketPath) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await expect(openFileViaNeovimRpc({ socketPath, path: filePath, line: 2 })).resolves.toBe(
      realpathSync(filePath),
    );
  });
});
