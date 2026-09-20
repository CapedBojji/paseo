# paseo.nvim

Native Neovim instructions for Paseo. Instructions live in buffer extmarks, so they move with edits and render as virtual lines beneath the related code.

## Install

With lazy.nvim:

```lua
{
  dir = "/path/to/paseo/integrations/paseo.nvim",
  config = function()
    require("paseo").setup()
  end,
}
```

For a local runtime-path install:

```lua
vim.opt.runtimepath:append("/path/to/paseo/integrations/paseo.nvim")
require("paseo").setup()
```

## Use

`<leader>pi` opens a multiline floating editor for the current line. In Visual mode it anchors the instruction to the selected line range. Save with `<C-s>` and cancel with `q` or `Esc`.

| Command | Action |
| --- | --- |
| `:PaseoInstruct` | Add or edit an instruction at the current line or command range |
| `:PaseoInstructDelete` | Delete an instruction at the current line or command range |
| `:PaseoInstructNext` / `:PaseoInstructPrev` | Jump between instructions |
| `:PaseoInstructList` | Show all current-buffer instructions |
| `:PaseoSend` | Choose an existing Paseo agent or start a new one |

The plugin provides `<Plug>` mappings for every action: `<Plug>(paseo-instruct)`, `<Plug>(paseo-instruct-delete)`, `<Plug>(paseo-instruct-next)`, `<Plug>(paseo-instruct-prev)`, `<Plug>(paseo-instruct-list)`, and `<Plug>(paseo-send)`.

Defaults are `<leader>pi`, `<leader>pD`, `]p`, `[p`, `<leader>pl`, and `<leader>ps`, respectively. Change them or remove all default mappings:

```lua
require("paseo").setup({
  keys = {
    instruct = "<leader>ai",
    send = "<leader>as",
    delete = false,
  },
  -- The executable and any fixed argv prefix. For example, { "npm", "run", "cli", "--" }.
  cli = { "paseo" },
})

-- Or keep the <Plug> mappings and create no defaults.
require("paseo").setup({ keys = false })
```

## Paseo requirements

Authoring instructions needs only Neovim 0.10 or newer. Sending needs a reachable Paseo CLI and `PASEO_WORKSPACE_ID` in Neovim's environment. `:PaseoSend` lists non-archived Paseo agents as JSON, then sends an existing target with `paseo send --no-wait --prompt-file … <id>`. Selecting **New agent** runs `paseo run --background --workspace "$PASEO_WORKSPACE_ID" <prompt>`.

Instructions are never deleted after a send attempt, including if listing, starting, or sending fails.

## Test

Run the headless test from this plugin directory:

```sh
nvim --headless -u NONE -l tests/headless.lua
```
