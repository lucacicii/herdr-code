# herdr-code

Local Web Workbench for **Herdr (`hc`)** — inspect repositories, review Git diffs, reference code lines/snippets/hunks/PR comments, and drive live Herdr terminals side-by-side in a single Go binary.

## Prerequisites

- Running `hc` (`herdr-core`) daemon (default socket `~/.local/state/herdr-core/default/default.sock`)
- For building from source: Go 1.24+ and Node.js / `pnpm`

## Build & Run

```bash
# 1. Build the React frontend into web/dist
cd web && pnpm install && pnpm run build && cd ..

# 2. Build the single Go binary (embeds web/dist via go:embed)
go build -o bin/herdr-code ./cmd/herdr-code

# 3. Start and open in browser
./bin/herdr-code --open
```

### Flags

- `--addr` — Listen address (default `127.0.0.1:4242`)
- `--socket` — Path to `hc` Unix socket (default `~/.local/state/herdr-core/default/default.sock`)
- `--token` — Optional Bearer token (also checks `HERDR_CODE_TOKEN`)
- `--open` — Automatically open the workbench URL in the default browser

## Key Features

- **Shared `hc` Live Terminals**: Connects directly to `hc` framed JSON-RPC & PTY streams so terminals stay synchronized with the official Herdr app. Supports 1 or 2 split `xterm.js` panes, `working/blocked/idle/done` badges, `Ctrl+C`, kill, and launching new shell/agent terminals.
- **Workspaces & File Explorer**: Auto-aggregates live terminals' Git roots and lets you add/pin local directories (`~/.config/herdr-code/workspaces.json`), with `Cmd+P` fuzzy search and `fsnotify` live reload.
- **Code Reader & Git Diff Viewer**: Multi-tab CodeMirror 6 reader + Unified/Side-by-Side Git Diff (`working`, `staged`, `unstaged`, `branch`, `commit`) with Stage/Unstage/Discard file or hunk actions.
- **Multi-Form Code Referencing**: Drag files/folders to terminals, select line ranges or snippets (`@path#L10-25` + fenced snippet), reference diff hunks, or batch PR-style inline review comments, then choose **Fill Input** (bracketed paste without Enter) or **Send Prompt** (`Cmd+Enter`).
- **Bidirectional Jump**: Click `path:line` references inside terminal output to jump directly to and highlight lines in the center code pane.
