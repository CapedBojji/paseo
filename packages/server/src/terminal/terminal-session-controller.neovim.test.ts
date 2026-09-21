import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import type { SessionOutboundMessage } from "../server/messages";
import { SessionDelivery } from "../server/session/owned-subscriptions";
import { isSameOrDescendantPath } from "../server/path-utils";
import type { NeovimEditorService } from "../editor/neovim/service";
import { TerminalSessionController } from "./terminal-session-controller";

function createHarness(open = vi.fn()) {
  const outbound: SessionOutboundMessage[] = [];
  const source = {};
  const delivery = new SessionDelivery((_source, message) => outbound.push(message), vi.fn());
  delivery.attach(source, false);
  const controller = new TerminalSessionController({
    terminalManager: null,
    neovimEditor: { open } as unknown as NeovimEditorService,
    emit: (message) => outbound.push(message),
    hasBinaryChannel: () => false,
    isPathWithinRoot: isSameOrDescendantPath,
    sessionLogger: { error: vi.fn(), warn: vi.fn() } as unknown as pino.Logger,
    listTerminalWorkspaceRefs: async () => [{ workspaceId: "workspace", cwd: "/repo" }],
  });
  return { controller, delivery, outbound, open };
}

describe("TerminalSessionController Neovim editor", () => {
  it("resolves workspace-relative paths before opening them", async () => {
    const harness = createHarness(vi.fn(async () => ({ terminalId: "terminal", created: true })));

    await harness.controller.dispatch(
      {
        type: "editor.neovim.open.request",
        requestId: "request",
        workspaceId: "workspace",
        cwd: "/repo",
        path: "src/file.ts",
      },
      harness.delivery,
    );

    expect(harness.open).toHaveBeenCalledWith({
      workspaceId: "workspace",
      cwd: "/repo",
      path: "/repo/src/file.ts",
    });
    expect(harness.outbound).toContainEqual({
      type: "editor.neovim.open.response",
      payload: {
        requestId: "request",
        terminalId: "terminal",
        created: true,
        error: null,
      },
    });
  });

  it("rejects paths outside the workspace without calling Neovim", async () => {
    const harness = createHarness();

    await harness.controller.dispatch(
      {
        type: "editor.neovim.open.request",
        requestId: "request",
        workspaceId: "workspace",
        cwd: "/repo",
        path: "../secret.txt",
      },
      harness.delivery,
    );

    expect(harness.open).not.toHaveBeenCalled();
    expect(harness.outbound).toContainEqual({
      type: "editor.neovim.open.response",
      payload: {
        requestId: "request",
        terminalId: null,
        created: false,
        error: "File path is outside the workspace",
      },
    });
  });
});
