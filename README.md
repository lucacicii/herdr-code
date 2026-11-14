# herdr-code

Local Web Workbench for **Herdr (`hc`)** — inspect repositories, review Git diffs, reference code lines/snippets/hunks/PR comments, and drive live Herdr terminals side-by-side in a single Go binary.

## Install

### One-line install (macOS / Linux)

```sh
curl -fsSL https://raw.githubusercontent.com/lucacicii/herdr-code/main/install.sh | sh
herdr-code --open
```

If `herdr-core` (`hc`) is not installed or its daemon is stopped, `herdr-code` will auto-start `hc` when present or prompt you inside **Settings → Dependencies** for one-click installation.

## Prerequisites

- macOS or Linux
- `herdr-core` (`hc`) daemon (can be installed & started right inside the Settings UI)
- For building from source: Go 1.26+ and Node.js / `pnpm`

## Build from Source

```bash
# 1. Build the React frontend into web/dist
cd web && pnpm install && pnpm run build && cd ..

# 2. Build the single Go binary (embeds web/dist via go:embed)
go build -o bin/herdr-code ./cmd/herdr-code

# 3. Start and open in browser
./bin/herdr-code --open
```

### Flags

- `--addr` — Listen address (default `127.0.0.1:4242`; non-loopback addresses require `--token`)
- `--socket` — Path to `hc` Unix socket (default `~/.local/state/herdr-core/default/default.sock`)
- `--token` — Optional Bearer token (also reads `HERDR_CODE_TOKEN`)
- `--allowed-origin` — Comma-separated extra allowed Origins or hostnames (also reads `HERDR_CODE_ALLOWED_ORIGIN`)
- `--open` — Automatically open the workbench URL in the default browser
- `--version` — Print version and exit

## Key Features

- **Shared `hc` Live Terminals**: Connects directly to `hc` framed JSON-RPC & PTY streams so terminals stay synchronized with the official Herdr app. Supports 1 or 2 horizontal/vertical split `xterm.js` panes, `working/blocked/idle/done` status tracking, `Ctrl+C`, kill, and launching new shell/agent terminals.
- **Herdr Spaces & Agents Sidebar**: Displays Spaces with project colors, Git branch/ahead/behind, worktrees, and Priority-grouped Agents (`Pinned`, `Needs you`, `Done`, `Working`, `Idle`).
- **Workspaces & File Explorer**: Auto-aggregates live terminals' Git roots and lets you add/pin local directories (`~/.config/herdr-code/workspaces.json`), with `Cmd+P` fuzzy search and `fsnotify` live reload.
- **Code Reader & Git Diff Viewer**: Collapsible right CodeMirror 6 reader + Unified/Side-by-Side Git Diff (`working`, `staged`, `unstaged`, `branch`, `commit`) with Stage/Unstage/Discard file or hunk actions.
- **Direct Code Referencing & Bidirectional Jump**: Drag files/folders to terminals, select line ranges or snippets (`@path#L10-25`), reference diff hunks, or write PR-style inline review comments directly into the focused terminal, and click `path:line` links in terminal output to jump to lines in the code pane.
