import { decodeMultiStream, encode } from "@msgpack/msgpack";
import { createConnection } from "node:net";

const OPEN_FILE_LUA = `
local path, line = ...
vim.api.nvim_cmd({ cmd = "edit", args = { path } }, {})
if type(line) == "number" then
  vim.api.nvim_win_set_cursor(0, { line, 0 })
end
return vim.api.nvim_buf_get_name(0)
`;

const ENSURE_PLUGIN_LUA = `
local runtime_path = ...
vim.opt.runtimepath:prepend(runtime_path)
if vim.fn.exists(":PaseoInstruct") ~= 2 then
  local ok, paseo = pcall(require, "paseo")
  if not ok then
    error("Unable to load paseo.nvim: " .. tostring(paseo))
  end
  paseo.setup()
end
return vim.fn.exists(":PaseoInstruct") == 2
`;

type RpcResponse = [type: 1, id: number, error: unknown, result: unknown];

export class NeovimRpcError extends Error {
  override readonly name = "NeovimRpcError";
}

function isRpcResponse(value: unknown, id: number): value is RpcResponse {
  return Array.isArray(value) && value.length === 4 && value[0] === 1 && value[1] === id;
}

function formatRpcError(error: unknown): string {
  if (Array.isArray(error) && typeof error[1] === "string") {
    return error[1];
  }
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : JSON.stringify(error);
}

async function requestNeovim(
  socketPath: string,
  method: string,
  args: readonly unknown[],
  timeoutMs: number,
): Promise<unknown> {
  const socket = createConnection(socketPath);
  const timeout = setTimeout(() => {
    socket.destroy(new Error(`Timed out connecting to Neovim at ${socketPath}`));
  }, timeoutMs);

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write(encode([0, 1, method, args]));

    for await (const value of decodeMultiStream(socket)) {
      if (!isRpcResponse(value, 1)) {
        continue;
      }
      if (value[2] !== null) {
        throw new NeovimRpcError(`Neovim RPC failed: ${formatRpcError(value[2])}`);
      }
      return value[3];
    }
    throw new Error("Neovim closed its RPC socket before responding");
  } finally {
    clearTimeout(timeout);
    socket.destroy();
  }
}

export async function openFileViaNeovimRpc(input: {
  socketPath: string;
  path: string;
  line?: number;
  timeoutMs?: number;
}): Promise<string> {
  const result = await requestNeovim(
    input.socketPath,
    "nvim_exec_lua",
    [OPEN_FILE_LUA, [input.path, input.line ?? null]],
    input.timeoutMs ?? 5_000,
  );
  if (typeof result !== "string") {
    throw new Error("Neovim returned an invalid buffer path");
  }
  return result;
}

export async function ensurePaseoPluginViaNeovimRpc(input: {
  socketPath: string;
  runtimePath: string;
  timeoutMs?: number;
}): Promise<void> {
  const result = await requestNeovim(
    input.socketPath,
    "nvim_exec_lua",
    [ENSURE_PLUGIN_LUA, [input.runtimePath]],
    input.timeoutMs ?? 5_000,
  );
  if (result !== true) {
    throw new Error("Neovim did not activate paseo.nvim");
  }
}
