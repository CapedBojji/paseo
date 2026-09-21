local source = debug.getinfo(1, "S").source:sub(2)
local root = vim.fn.fnamemodify(source, ":p:h:h")
vim.opt.runtimepath:append(root)

local paseo = require("paseo")
paseo.setup({ keys = false, cli = { "paseo-test" } })

local function equal(actual, expected, message)
  assert(vim.deep_equal(actual, expected), string.format("%s\nactual: %s\nexpected: %s", message, vim.inspect(actual), vim.inspect(expected)))
end

assert(vim.fn.exists(":PaseoInstruct") == 2, "PaseoInstruct command is registered")
assert(vim.fn.exists(":PaseoSend") == 2, "PaseoSend command is registered")

local buf = vim.api.nvim_create_buf(false, true)
vim.api.nvim_set_current_buf(buf)
vim.api.nvim_buf_set_name(buf, "/tmp/paseo.nvim-headless.lua")
vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "one", "two", "three", "four", "five", "six" })
local buffer_path = vim.api.nvim_buf_get_name(buf)

local first_id = paseo.set_instruction(buf, 2, 3, "Keep this branch focused.\nRun its focused test.")
local second_id = paseo.set_instruction(buf, 5, 5, "Do not change public APIs.")
assert(type(first_id) == "number" and type(second_id) == "number", "instructions use extmarks")

local instructions = paseo.instructions(buf)
equal(#instructions, 2, "adds two instructions")
equal(instructions[1].start_line, 2, "first live start line")
equal(instructions[1].end_line, 3, "first live end line")
equal(instructions[1].text, "Keep this branch focused.\nRun its focused test.", "multiline text persists")

local details = vim.api.nvim_buf_get_extmark_by_id(buf, vim.api.nvim_create_namespace("paseo.nvim"), first_id, { details = true })[3]
assert(details.sign_text:match("^▎"), "instructions have a sign")
assert(details.line_hl_group == "PaseoInstructionLine", "instructions highlight their code line")
assert(type(details.virt_lines) == "table" and #details.virt_lines == 2, "instructions render multiline virtual lines")

paseo.set_instruction(buf, 2, 3, "Keep scope narrow.", first_id)
equal(paseo.instructions(buf)[1].text, "Keep scope narrow.", "editing preserves the extmark identity")

vim.api.nvim_buf_set_lines(buf, 0, 0, false, { "zero" })
instructions = paseo.instructions(buf)
equal(instructions[1].start_line, 3, "first range follows an inserted line")
equal(instructions[1].end_line, 4, "first end range follows an inserted line")
equal(instructions[2].start_line, 6, "second range follows an inserted line")

vim.api.nvim_win_set_cursor(0, { 1, 0 })
assert(paseo.next(), "next navigates")
equal(vim.api.nvim_win_get_cursor(0)[1], 3, "next lands on the first instruction")
assert(paseo.next(), "next navigates again")
equal(vim.api.nvim_win_get_cursor(0)[1], 6, "next lands on the second instruction")
assert(paseo.prev(), "prev navigates")
equal(vim.api.nvim_win_get_cursor(0)[1], 3, "prev lands on the first instruction")

local prompt = assert(paseo.format_prompt(buf))
assert(prompt:find("File: " .. buffer_path, 1, true), "prompt includes its file path")
assert(prompt:find("Lines 3-4:\nKeep scope narrow.", 1, true), "prompt includes live first range")
assert(prompt:find("Lines 6-6:\nDo not change public APIs.", 1, true), "prompt includes live second range")

equal(paseo.build_list_argv(), { "paseo-test", "ls", "--open-tabs", "--json" }, "list argv")
paseo.setup({ keys = false, cli = { "paseo-test" } })
assert(vim.fn.exists(":PaseoInstruct") == 2, "setup can be called more than once")
equal(paseo.build_send_argv("agent-123", "/tmp/prompt.md"), {
  "paseo-test",
  "send",
  "--no-wait",
  "--prompt-file",
  "/tmp/prompt.md",
  "agent-123",
}, "existing agent send argv")
equal(paseo.build_run_argv("workspace-123", "Use the instructions."), {
  "paseo-test",
  "run",
  "--background",
  "--workspace",
  "workspace-123",
  "Use the instructions.",
}, "new agent argv")

assert(paseo.delete({ buf = buf, line1 = 3, line2 = 4 }), "delete finds exact range")
equal(#paseo.instructions(buf), 1, "delete removes only selected extmark")
assert(paseo.delete({ buf = buf, line1 = 6, line2 = 6 }), "delete removes remaining instruction")
equal(#paseo.instructions(buf), 0, "all instructions deleted")

print("paseo.nvim headless tests: ok")
