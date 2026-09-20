local M = {}

local api = vim.api
local namespace = api.nvim_create_namespace("paseo.nvim")

local defaults = {
  cli = { "paseo" },
  keys = {
    instruct = "<leader>pi",
    delete = "<leader>pD",
    next = "]p",
    prev = "[p",
    list = "<leader>pl",
    send = "<leader>ps",
  },
}

local config = vim.deepcopy(defaults)
local mapped_keys = {}

local plug_mappings = {
  instruct = "<Plug>(paseo-instruct)",
  delete = "<Plug>(paseo-instruct-delete)",
  next = "<Plug>(paseo-instruct-next)",
  prev = "<Plug>(paseo-instruct-prev)",
  list = "<Plug>(paseo-instruct-list)",
  send = "<Plug>(paseo-send)",
}

local function notify(message, level)
  vim.notify(message, level or vim.log.levels.INFO, { title = "Paseo" })
end

local function set_highlights()
  api.nvim_set_hl(0, "PaseoInstructionSign", { default = true, link = "DiagnosticInfo" })
  api.nvim_set_hl(0, "PaseoInstructionText", { default = true, link = "DiagnosticVirtualText" })
  api.nvim_set_hl(0, "PaseoInstructionLine", { default = true, link = "Visual" })
end

local function instruction_text(details)
  if type(details.virt_lines) ~= "table" then
    return nil
  end
  local lines = {}
  for index, virtual_line in ipairs(details.virt_lines) do
    local chunks = {}
    for _, chunk in ipairs(virtual_line) do
      table.insert(chunks, chunk[1])
    end
    local prefix_length = index == 1 and #"  Paseo: " or #"         "
    table.insert(lines, table.concat(chunks):sub(prefix_length + 1))
  end
  return table.concat(lines, "\n")
end

local function extmark_options(text, end_row, id)
  local virtual_lines = {}
  for index, line in ipairs(vim.split(text, "\n", { plain = true })) do
    local prefix = index == 1 and "  Paseo: " or "         "
    table.insert(virtual_lines, { { prefix .. line, "PaseoInstructionText" } })
  end

  return {
    id = id,
    end_row = end_row,
    end_col = 0,
    right_gravity = false,
    end_right_gravity = true,
    virt_lines = virtual_lines,
    virt_lines_above = false,
    sign_text = "▎",
    sign_hl_group = "PaseoInstructionSign",
    line_hl_group = "PaseoInstructionLine",
  }
end

--- Return all Paseo instructions in a buffer, sorted by their live anchor.
---@param buf? integer
---@return table[]
function M.instructions(buf)
  buf = buf or api.nvim_get_current_buf()
  local items = {}
  for _, mark in ipairs(api.nvim_buf_get_extmarks(buf, namespace, 0, -1, { details = true })) do
    local id, row, _, details = mark[1], mark[2], mark[3], mark[4]
    local text = instruction_text(details)
    if text then
      table.insert(items, {
        id = id,
        start_row = row,
        start_line = row + 1,
        end_row = details.end_row or row,
        end_line = details.end_row or (row + 1),
        text = text,
      })
    end
  end
  table.sort(items, function(left, right)
    if left.start_row == right.start_row then
      return left.id < right.id
    end
    return left.start_row < right.start_row
  end)
  return items
end

local function instruction_for_range(buf, line1, line2)
  for _, instruction in ipairs(M.instructions(buf)) do
    if instruction.start_line == line1 and instruction.end_line == line2 then
      return instruction
    end
  end
end

local function instruction_at_line(buf, line)
  for _, instruction in ipairs(M.instructions(buf)) do
    if instruction.start_line <= line and line <= instruction.end_line then
      return instruction
    end
  end
end

--- Add or replace an instruction. This is also useful to test an integration without opening a float.
---@param buf integer
---@param line1 integer 1-indexed first line
---@param line2 integer 1-indexed final line
---@param text string
---@param id? integer
---@return integer
function M.set_instruction(buf, line1, line2, text, id)
  assert(type(text) == "string" and text:match("%S"), "An instruction cannot be empty")
  assert(line1 >= 1 and line2 >= line1, "Invalid instruction range")
  return api.nvim_buf_set_extmark(buf, namespace, line1 - 1, 0, extmark_options(text, line2, id))
end

local function save_editor(editor_buf, editor_win, target)
  if not api.nvim_buf_is_valid(editor_buf) then
    return
  end
  local text = table.concat(api.nvim_buf_get_lines(editor_buf, 0, -1, false), "\n")
  if not text:match("%S") then
    notify("Instruction was not saved: it is empty.", vim.log.levels.WARN)
    return
  end
  M.set_instruction(target.buf, target.line1, target.line2, text, target.id)
  if api.nvim_win_is_valid(editor_win) then
    api.nvim_win_close(editor_win, true)
  end
  notify(target.id and "Instruction updated." or "Instruction added.")
end

local function open_editor(target)
  local editor_buf = api.nvim_create_buf(false, true)
  api.nvim_buf_set_name(editor_buf, "Paseo instruction")
  api.nvim_buf_set_lines(editor_buf, 0, -1, false, vim.split(target.text or "", "\n", { plain = true }))
  api.nvim_set_option_value("buftype", "nofile", { buf = editor_buf })
  api.nvim_set_option_value("bufhidden", "wipe", { buf = editor_buf })
  api.nvim_set_option_value("swapfile", false, { buf = editor_buf })
  api.nvim_set_option_value("filetype", "markdown", { buf = editor_buf })

  local ui = api.nvim_list_uis()[1]
  local width = math.min(84, math.max(44, math.floor(ui.width * 0.7)))
  local height = math.min(18, math.max(6, math.floor(ui.height * 0.4)))
  local editor_win = api.nvim_open_win(editor_buf, true, {
    relative = "editor",
    width = width,
    height = height,
    col = math.floor((ui.width - width) / 2),
    row = math.floor((ui.height - height) / 2),
    style = "minimal",
    border = "rounded",
    title = target.id and " Edit Paseo instruction " or " Add Paseo instruction ",
    title_pos = "center",
  })

  local function save()
    save_editor(editor_buf, editor_win, target)
  end
  local function cancel()
    if api.nvim_win_is_valid(editor_win) then
      api.nvim_win_close(editor_win, true)
    end
  end
  vim.keymap.set({ "n", "i" }, "<C-s>", save, { buffer = editor_buf, silent = true })
  vim.keymap.set("n", "q", cancel, { buffer = editor_buf, silent = true })
  vim.keymap.set("n", "<Esc>", cancel, { buffer = editor_buf, silent = true })
  vim.cmd("startinsert")
end

local function visual_range()
  local first = vim.fn.getpos("'<")[2]
  local last = vim.fn.getpos("'>")[2]
  return math.min(first, last), math.max(first, last)
end

---@param options? table
function M.instruct(options)
  options = options or {}
  local buf = options.buf or api.nvim_get_current_buf()
  local line1 = options.line1 or api.nvim_win_get_cursor(0)[1]
  local line2 = options.line2 or line1
  local existing = instruction_for_range(buf, line1, line2) or instruction_at_line(buf, line1)
  open_editor({
    buf = buf,
    line1 = existing and existing.start_line or line1,
    line2 = existing and existing.end_line or line2,
    id = existing and existing.id,
    text = existing and existing.text,
  })
end

function M.instruct_visual()
  local line1, line2 = visual_range()
  M.instruct({ line1 = line1, line2 = line2 })
end

---@param options? table
function M.delete(options)
  options = options or {}
  local buf = options.buf or api.nvim_get_current_buf()
  local line1 = options.line1 or api.nvim_win_get_cursor(0)[1]
  local line2 = options.line2 or line1
  local instruction = instruction_for_range(buf, line1, line2) or instruction_at_line(buf, line1)
  if not instruction then
    notify("No Paseo instruction at this line.", vim.log.levels.WARN)
    return false
  end
  api.nvim_buf_del_extmark(buf, namespace, instruction.id)
  notify("Instruction deleted.")
  return true
end

function M.delete_visual()
  local line1, line2 = visual_range()
  M.delete({ line1 = line1, line2 = line2 })
end

local function jump(direction)
  local buf = api.nvim_get_current_buf()
  local instructions = M.instructions(buf)
  if #instructions == 0 then
    notify("No Paseo instructions in this buffer.", vim.log.levels.WARN)
    return false
  end
  local row = api.nvim_win_get_cursor(0)[1] - 1
  local candidate
  if direction == "next" then
    for _, instruction in ipairs(instructions) do
      if instruction.start_row > row then
        candidate = instruction
        break
      end
    end
    candidate = candidate or instructions[1]
  else
    for index = #instructions, 1, -1 do
      if instructions[index].start_row < row then
        candidate = instructions[index]
        break
      end
    end
    candidate = candidate or instructions[#instructions]
  end
  api.nvim_win_set_cursor(0, { candidate.start_line, 0 })
  vim.cmd("normal! zzz")
  return true
end

function M.next()
  return jump("next")
end

function M.prev()
  return jump("prev")
end

function M.list()
  local instructions = M.instructions()
  if #instructions == 0 then
    notify("No Paseo instructions in this buffer.")
    return instructions
  end
  local lines = { "Paseo instructions:" }
  for _, instruction in ipairs(instructions) do
    local summary = instruction.text:gsub("\n.*", "")
    table.insert(lines, string.format("  %d-%d: %s", instruction.start_line, instruction.end_line, summary))
  end
  notify(table.concat(lines, "\n"))
  return instructions
end

--- Produce the prompt from the extmarks as they exist now, not when they were authored.
---@param buf? integer
---@return string|nil, string|nil
function M.format_prompt(buf)
  buf = buf or api.nvim_get_current_buf()
  local path = api.nvim_buf_get_name(buf)
  if path == "" then
    return nil, "Save this buffer before sending Paseo instructions."
  end
  local instructions = M.instructions(buf)
  if #instructions == 0 then
    return nil, "No Paseo instructions in this buffer."
  end
  local sections = {
    "Paseo Neovim instructions",
    "File: " .. path,
    "The ranges below are resolved from live Neovim extmarks at send time.",
  }
  for _, instruction in ipairs(instructions) do
    table.insert(sections, string.format("Lines %d-%d:\n%s", instruction.start_line, instruction.end_line, instruction.text))
  end
  return table.concat(sections, "\n\n")
end

local function prefixed(arguments)
  local argv = vim.deepcopy(config.cli)
  vim.list_extend(argv, arguments)
  return argv
end

function M.build_list_argv()
  return prefixed({ "ls", "--global", "--json" })
end

function M.build_send_argv(agent_id, prompt_file)
  return prefixed({ "send", "--no-wait", "--prompt-file", prompt_file, agent_id })
end

function M.build_run_argv(workspace_id, prompt)
  return prefixed({ "run", "--background", "--workspace", workspace_id, prompt })
end

local function run_system(argv, callback)
  vim.system(argv, { text = true }, function(result)
    vim.schedule(function()
      callback(result)
    end)
  end)
end

local function report_cli_failure(action, result)
  local detail = vim.trim(result.stderr or result.stdout or "unknown CLI failure")
  notify(string.format("Failed to %s: %s", action, detail), vim.log.levels.ERROR)
end

local function create_prompt_file(prompt)
  local path = vim.fn.tempname() .. ".md"
  local ok, error_message = pcall(vim.fn.writefile, vim.split(prompt, "\n", { plain = true }), path)
  if not ok then
    return nil, error_message
  end
  return path
end

local function send_to_existing(agent, prompt)
  local prompt_file, error_message = create_prompt_file(prompt)
  if not prompt_file then
    notify("Failed to create Paseo prompt file: " .. tostring(error_message), vim.log.levels.ERROR)
    return
  end
  run_system(M.build_send_argv(agent.id, prompt_file), function(result)
    vim.fn.delete(prompt_file)
    if result.code == 0 then
      notify("Instructions sent to " .. agent.label .. ".")
      return
    end
    report_cli_failure("send instructions", result)
  end)
end

local function start_new_agent(workspace_id, prompt)
  run_system(M.build_run_argv(workspace_id, prompt), function(result)
    if result.code == 0 then
      notify("Started a new Paseo agent with these instructions.")
      return
    end
    report_cli_failure("start a Paseo agent", result)
  end)
end

local function decode_agents(stdout)
  local ok, agents = pcall(vim.json.decode, stdout)
  if not ok or type(agents) ~= "table" then
    return nil
  end
  local choices = {}
  for _, agent in ipairs(agents) do
    if type(agent) == "table" and type(agent.id) == "string" then
      local title = agent.name
      if type(title) ~= "string" or title == "" or title == "-" then
        title = agent.id:sub(1, 7)
      end
      local provider = type(agent.provider) == "string" and agent.provider or "unknown"
      local status = type(agent.status) == "string" and agent.status or "unknown"
      table.insert(choices, {
        id = agent.id,
        label = string.format("%s (%s, %s)", title, provider, status),
      })
    end
  end
  return choices
end

function M.send()
  local workspace_id = vim.env.PASEO_WORKSPACE_ID
  if not workspace_id or vim.trim(workspace_id) == "" then
    notify("PaseoSend requires PASEO_WORKSPACE_ID. Authoring instructions still works.", vim.log.levels.ERROR)
    return
  end
  local prompt, error_message = M.format_prompt()
  if not prompt then
    notify(error_message, vim.log.levels.WARN)
    return
  end
  run_system(M.build_list_argv(), function(result)
    if result.code ~= 0 then
      report_cli_failure("list Paseo agents", result)
      return
    end
    local agents = decode_agents(result.stdout or "")
    if not agents then
      notify("Paseo returned invalid JSON while listing agents.", vim.log.levels.ERROR)
      return
    end
    local choices = vim.deepcopy(agents)
    table.insert(choices, 1, { new = true, label = "New agent" })
    vim.ui.select(choices, {
      prompt = "Send Paseo instructions to",
      format_item = function(choice)
        return choice.label
      end,
    }, function(choice)
      if not choice then
        return
      end
      if choice.new then
        start_new_agent(vim.trim(workspace_id), prompt)
      else
        send_to_existing(choice, prompt)
      end
    end)
  end)
end

local function define_commands()
  api.nvim_create_user_command("PaseoInstruct", function(options)
    M.instruct({ line1 = options.line1, line2 = options.line2 })
  end, { range = true, desc = "Add or edit a Paseo instruction" })
  api.nvim_create_user_command("PaseoInstructDelete", function(options)
    M.delete({ line1 = options.line1, line2 = options.line2 })
  end, { range = true, desc = "Delete a Paseo instruction" })
  api.nvim_create_user_command("PaseoInstructNext", M.next, { desc = "Jump to next Paseo instruction" })
  api.nvim_create_user_command("PaseoInstructPrev", M.prev, { desc = "Jump to previous Paseo instruction" })
  api.nvim_create_user_command("PaseoInstructList", M.list, { desc = "List Paseo instructions" })
  api.nvim_create_user_command("PaseoSend", M.send, { desc = "Send current-buffer instructions to Paseo" })
end

local function map_plugs()
  vim.keymap.set("n", plug_mappings.instruct, M.instruct, { silent = true })
  vim.keymap.set("x", plug_mappings.instruct, M.instruct_visual, { silent = true })
  vim.keymap.set("n", plug_mappings.delete, M.delete, { silent = true })
  vim.keymap.set("x", plug_mappings.delete, M.delete_visual, { silent = true })
  vim.keymap.set("n", plug_mappings.next, M.next, { silent = true })
  vim.keymap.set("n", plug_mappings.prev, M.prev, { silent = true })
  vim.keymap.set("n", plug_mappings.list, M.list, { silent = true })
  vim.keymap.set("n", plug_mappings.send, M.send, { silent = true })
end

local function clear_default_maps()
  for _, mapping in ipairs(mapped_keys) do
    pcall(vim.keymap.del, mapping.mode, mapping.lhs)
  end
  mapped_keys = {}
end

local function map_defaults()
  clear_default_maps()
  if config.keys == false then
    return
  end
  for action, lhs in pairs(config.keys) do
    if lhs and plug_mappings[action] then
      local mode = (action == "instruct" or action == "delete") and { "n", "x" } or "n"
      vim.keymap.set(mode, lhs, plug_mappings[action], { remap = true, silent = true })
      if type(mode) == "table" then
        for _, item in ipairs(mode) do
          table.insert(mapped_keys, { mode = item, lhs = lhs })
        end
      else
        table.insert(mapped_keys, { mode = mode, lhs = lhs })
      end
    end
  end
end

function M.setup(options)
  config = vim.tbl_deep_extend("force", vim.deepcopy(defaults), options or {})
  assert(type(config.cli) == "table" and #config.cli > 0, "paseo.nvim config.cli must be an argv array")
  set_highlights()
  define_commands()
  map_plugs()
  map_defaults()
  return M
end

return M
