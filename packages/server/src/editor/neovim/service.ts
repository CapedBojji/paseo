import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TerminalManager } from "../../terminal/terminal-manager.js";
import { ensurePaseoPluginViaNeovimRpc, NeovimRpcError, openFileViaNeovimRpc } from "./rpc.js";
import { getPaseoNeovimRuntimePath } from "./runtime-path.js";

export const PASEO_NEOVIM_TERMINAL_NAME = "Paseo Neovim";

interface NeovimEditorServiceOptions {
  ensurePlugin?: typeof ensurePaseoPluginViaNeovimRpc;
  openFile?: typeof openFileViaNeovimRpc;
  runtimePath?: string;
  retryDelayMs?: number;
  timeoutMs?: number;
}

interface OpenNeovimFileInput {
  cwd: string;
  workspaceId: string;
  path: string;
  line?: number;
}

export interface OpenNeovimFileResult {
  terminalId: string;
  created: boolean;
}

let runtimeDirectory: string | null = null;

function getRuntimeDirectory(): string {
  if (!runtimeDirectory) {
    runtimeDirectory = mkdtempSync(join(tmpdir(), "paseo-nvim-"));
    chmodSync(runtimeDirectory, 0o700);
  }
  return runtimeDirectory;
}

export function getNeovimSocketPath(terminalId: string): string {
  const shortId = terminalId.replaceAll("-", "").slice(0, 20);
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\paseo-nvim-${process.pid}-${shortId}`;
  }
  return join(getRuntimeDirectory(), `${shortId}.sock`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class NeovimEditorService {
  private readonly pendingByWorkspace = new Map<string, Promise<OpenNeovimFileResult>>();
  private readonly openFile: typeof openFileViaNeovimRpc;
  private readonly ensurePlugin: typeof ensurePaseoPluginViaNeovimRpc;
  private readonly runtimePath: string;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly terminalManager: TerminalManager,
    options: NeovimEditorServiceOptions = {},
  ) {
    this.openFile = options.openFile ?? openFileViaNeovimRpc;
    this.ensurePlugin = options.ensurePlugin ?? ensurePaseoPluginViaNeovimRpc;
    this.runtimePath = options.runtimePath ?? getPaseoNeovimRuntimePath();
    this.retryDelayMs = options.retryDelayMs ?? 50;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  open(input: OpenNeovimFileInput): Promise<OpenNeovimFileResult> {
    const previous = this.pendingByWorkspace.get(input.workspaceId) ?? Promise.resolve(null);
    const task = previous.catch(() => null).then(() => this.openNow(input));
    this.pendingByWorkspace.set(input.workspaceId, task);
    const settle = () => {
      if (this.pendingByWorkspace.get(input.workspaceId) === task) {
        this.pendingByWorkspace.delete(input.workspaceId);
      }
    };
    void task.then(settle, settle);
    return task;
  }

  private async openNow(input: OpenNeovimFileInput): Promise<OpenNeovimFileResult> {
    const terminals = await this.terminalManager.getTerminals(input.cwd, {
      workspaceId: input.workspaceId,
    });
    let terminal = terminals.find((candidate) => candidate.name === PASEO_NEOVIM_TERMINAL_NAME);
    let created = false;

    if (!terminal) {
      terminal = await this.createTerminal(input);
      created = true;
    }

    try {
      await this.openWhenReady(terminal.id, input);
    } catch (error) {
      if (created || error instanceof NeovimRpcError) {
        throw error;
      }
      await this.terminalManager.killTerminalAndWait(terminal.id);
      terminal = await this.createTerminal(input);
      created = true;
      await this.openWhenReady(terminal.id, input);
    }

    return { terminalId: terminal.id, created };
  }

  private createTerminal(input: OpenNeovimFileInput) {
    const terminalId = randomUUID();
    const socketPath = getNeovimSocketPath(terminalId);
    return this.terminalManager.createTerminal({
      id: terminalId,
      cwd: input.cwd,
      workspaceId: input.workspaceId,
      name: PASEO_NEOVIM_TERMINAL_NAME,
      title: PASEO_NEOVIM_TERMINAL_NAME,
      command: "nvim",
      args: [
        "--listen",
        socketPath,
        "--cmd",
        "lua vim.opt.runtimepath:prepend(vim.env.PASEO_NVIM_RTP)",
      ],
      env: { PASEO_NVIM_RTP: this.runtimePath, PASEO_NVIM_SOCKET: socketPath },
    });
  }

  private async openWhenReady(terminalId: string, input: OpenNeovimFileInput): Promise<void> {
    const socketPath = getNeovimSocketPath(terminalId);
    const deadline = Date.now() + this.timeoutMs;
    let lastError: unknown;

    do {
      try {
        await this.ensurePlugin({
          socketPath,
          runtimePath: this.runtimePath,
          timeoutMs: Math.max(1, deadline - Date.now()),
        });
        await this.openFile({
          socketPath,
          path: input.path,
          ...(input.line ? { line: input.line } : {}),
          timeoutMs: Math.max(1, deadline - Date.now()),
        });
        return;
      } catch (error) {
        if (error instanceof NeovimRpcError) {
          throw error;
        }
        lastError = error;
        if (!this.terminalManager.getTerminal(terminalId)) {
          break;
        }
        await sleep(this.retryDelayMs);
      }
    } while (Date.now() < deadline);

    throw new Error(
      `Unable to connect to Paseo Neovim: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
}

const serviceByTerminalManager = new WeakMap<TerminalManager, NeovimEditorService>();

export function getNeovimEditorService(terminalManager: TerminalManager): NeovimEditorService {
  const existing = serviceByTerminalManager.get(terminalManager);
  if (existing) return existing;
  const service = new NeovimEditorService(terminalManager);
  serviceByTerminalManager.set(terminalManager, service);
  return service;
}
