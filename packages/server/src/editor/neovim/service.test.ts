import { describe, expect, it, vi } from "vitest";
import type { TerminalManager } from "../../terminal/terminal-manager";
import type { TerminalSession } from "../../terminal/terminal";
import { NeovimRpcError } from "./rpc";
import { NeovimEditorService, PASEO_NEOVIM_TERMINAL_NAME } from "./service";

describe("NeovimEditorService", () => {
  it("serializes opens and reuses one dedicated workspace terminal", async () => {
    const terminals: TerminalSession[] = [];
    const createTerminal = vi.fn(
      async (input: Parameters<TerminalManager["createTerminal"]>[0]) => {
        const terminal = {
          id: input.id,
          name: input.name,
          cwd: input.cwd,
          workspaceId: input.workspaceId,
        } as TerminalSession;
        terminals.push(terminal);
        return terminal;
      },
    );
    const getTerminal = (id: string) => terminals.find((terminal) => terminal.id === id);
    const manager = {
      getTerminals: vi.fn(async () => terminals),
      createTerminal,
      getTerminal: vi.fn(getTerminal),
      killTerminalAndWait: vi.fn(),
    } as unknown as TerminalManager;
    const openFile = vi.fn(async () => "opened");
    const ensurePlugin = vi.fn(async () => undefined);
    const service = new NeovimEditorService(manager, {
      ensurePlugin,
      openFile,
      retryDelayMs: 0,
      runtimePath: "/paseo.nvim",
    });

    const [first, second] = await Promise.all([
      service.open({ cwd: "/repo", workspaceId: "workspace", path: "/repo/first.ts" }),
      service.open({ cwd: "/repo", workspaceId: "workspace", path: "/repo/second.ts" }),
    ]);

    expect(first.created).toBe(true);
    expect(second).toEqual({ terminalId: first.terminalId, created: false });
    expect(createTerminal).toHaveBeenCalledOnce();
    expect(createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        name: PASEO_NEOVIM_TERMINAL_NAME,
        title: PASEO_NEOVIM_TERMINAL_NAME,
        command: "nvim",
        args: [
          "--listen",
          expect.stringMatching(/paseo-nvim/),
          "--cmd",
          "lua vim.opt.runtimepath:prepend(vim.env.PASEO_NVIM_RTP)",
        ],
        env: expect.objectContaining({ PASEO_NVIM_RTP: "/paseo.nvim" }),
      }),
    );
    expect(ensurePlugin).toHaveBeenCalledTimes(2);
    expect(openFile.mock.calls.map(([input]) => input.path)).toEqual([
      "/repo/first.ts",
      "/repo/second.ts",
    ]);
  });

  it("preserves a responsive Neovim terminal when the editor rejects an open", async () => {
    const terminal = {
      id: "existing",
      name: PASEO_NEOVIM_TERMINAL_NAME,
      cwd: "/repo",
      workspaceId: "workspace",
    } as TerminalSession;
    const manager = {
      getTerminals: vi.fn(async () => [terminal]),
      createTerminal: vi.fn(),
      getTerminal: vi.fn(() => terminal),
      killTerminalAndWait: vi.fn(),
    } as unknown as TerminalManager;
    const service = new NeovimEditorService(manager, {
      ensurePlugin: vi.fn(async () => undefined),
      openFile: vi.fn(async () => {
        throw new NeovimRpcError("No write since last change");
      }),
      retryDelayMs: 0,
      runtimePath: "/paseo.nvim",
    });

    await expect(
      service.open({ cwd: "/repo", workspaceId: "workspace", path: "/repo/next.ts" }),
    ).rejects.toThrow("No write since last change");
    expect(manager.killTerminalAndWait).not.toHaveBeenCalled();
    expect(manager.createTerminal).not.toHaveBeenCalled();
  });
});
