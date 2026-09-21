import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTerminalManager, type TerminalManager } from "../../terminal/terminal-manager";
import { NeovimEditorService } from "./service";

const hasNeovim = spawnSync("nvim", ["--version"], { stdio: "ignore" }).status === 0;
let manager: TerminalManager | null = null;
let directory: string | null = null;

afterEach(() => {
  manager?.killAll();
  manager = null;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = null;
});

describe.skipIf(process.platform === "win32" || !hasNeovim)(
  "NeovimEditorService process integration",
  () => {
    it("creates one terminal and reuses it for later files", async () => {
      directory = mkdtempSync(join(tmpdir(), "paseo-nvim-service-test-"));
      const firstPath = join(directory, "first.ts");
      const secondPath = join(directory, "second.ts");
      writeFileSync(firstPath, "first\n");
      writeFileSync(secondPath, "second\n");
      manager = createTerminalManager();
      const service = new NeovimEditorService(manager);

      const first = await service.open({
        cwd: directory,
        workspaceId: "workspace",
        path: firstPath,
      });
      const second = await service.open({
        cwd: directory,
        workspaceId: "workspace",
        path: secondPath,
      });

      expect(first.created).toBe(true);
      expect(second).toEqual({ terminalId: first.terminalId, created: false });
      expect(await manager.getTerminals(directory, { workspaceId: "workspace" })).toHaveLength(1);
    }, 15_000);
  },
);
