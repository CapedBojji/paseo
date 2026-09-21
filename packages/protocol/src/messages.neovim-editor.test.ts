import { describe, expect, it } from "vitest";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages";

describe("Neovim editor protocol", () => {
  it("keeps the capability optional for older daemons", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({ status: "server_info", serverId: "server" }).features,
    ).toBeUndefined();
  });

  it("parses a correlated open request and response", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "editor.neovim.open.request",
        requestId: "request",
        workspaceId: "workspace",
        cwd: "/repo",
        path: "src/file.ts",
        line: 12,
      }),
    ).toMatchObject({ path: "src/file.ts", line: 12 });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "editor.neovim.open.response",
        payload: {
          requestId: "request",
          terminalId: "terminal",
          created: true,
          error: null,
        },
      }),
    ).toMatchObject({ payload: { terminalId: "terminal", created: true } });
  });
});
