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

### Development (hot reload)

`web/dist` is baked into the binary at compile time, so editing `web/src` requires
*both* a Vite build and a Go build. During development skip that entirely:

```bash
./scripts/dev.sh
```

- Vite serves the UI on `http://127.0.0.1:5199` with HMR; `/api` and `/ws` are proxied
  to the Go server, so terminals and live events work through the dev server.
- The Go server runs on `127.0.0.1:7681`; touching any `.go` file under `cmd/` or
  `internal/` rebuilds and restarts it, then reloads the browser tab (terminal
  websockets cannot survive a server restart).
- Override with `HERDR_DEV_PORT`, `HERDR_DEV_ADDR`, `HERDR_DEV_SOCKET`, or set
  `HERDR_DEV_NO_RELOAD=1` to leave the tab alone.

The dev server attaches to the same `hc` daemon as a production instance, so its
terminals are the real ones; run it alongside `./bin/herdr-code` or instead of it.

## Key Features

- **Shared `hc` Live Terminals**: Connects directly to `hc` framed JSON-RPC & PTY streams so terminals stay synchronized with the official Herdr app. Supports 1 or 2 horizontal/vertical split `xterm.js` panes, `working/blocked/idle/done` status tracking, `Ctrl+C`, kill, and launching new shell/agent terminals.
- **Herdr Spaces & Agents Sidebar**: Displays Spaces with project colors, Git branch/ahead/behind, worktrees, and Priority-grouped Agents (`Pinned`, `Needs you`, `Done`, `Working`, `Idle`).
- **Workspaces & File Explorer**: Groups terminals by the Herdr.app space that owns them (`herdr.space` terminal label, names from the app's `herdr-app` doc) and only falls back to auto-aggregating live terminals' Git roots plus pinned local directories (`~/.config/herdr-code/workspaces.json`); the History toggle also lists closed terminals the app still remembers. Includes `Cmd+P` fuzzy search and `fsnotify` live reload.
- **Code Reader & Git Diff Viewer**: Collapsible right CodeMirror 6 reader + Unified/Side-by-Side Git Diff (`working`, `staged`, `unstaged`, `branch`, `commit`) with Stage/Unstage/Discard file or hunk actions.
- **Direct Code Referencing & Bidirectional Jump**: Drag files/folders to terminals, select line ranges or snippets (`@path#L10-25`), reference diff hunks, or write PR-style inline review comments directly into the focused terminal, and click `path:line` links in terminal output to jump to lines in the code pane.
- **Inline Terminal Images**: Both `xterm.js` panes render Sixel and iTerm2 inline images (`OSC 1337;File=`), keeping up to 64 MB of decoded images per pane, so `wezterm imgcat`, `chafa --format sixel`, `img2sixel`, or `imgcat` output shows in place.

## Terminal Images

The panes speak both protocols — any program that emits them works:

```sh
wezterm imgcat screenshot.png   # iTerm2 inline images (OSC 1337)
chafa --format sixel logo.png   # Sixel (DCS)
```

To emit the protocol from a script, note that iTerm2 requires `size` (raw byte count, not base64 length) and a base64-encoded `name`:

```sh
img=shot.png
printf '\033]1337;File=inline=1;size=%s;name=%s:%s\a' \
  "$(wc -c < "$img" | tr -d ' ')" \
  "$(basename "$img" | base64 | tr -d '\n')" \
  "$(base64 < "$img" | tr -d '\n')"
```

The panes are tolerant of loose emitters: a sequence without `size` gets one filled in from the decoded payload, and WebP payloads (what `omp` sends) are re-encoded to PNG, since the image addon only decodes PNG, JPEG and GIF. Sequences split across WebSocket frames are reassembled before the rewrite.

Panes are also spawned with a de-Ghostty'd environment (`TERM_PROGRAM=herdr-code`, `PI_FORCE_IMAGE_PROTOCOL=iterm2`, and the inherited `GHOSTTY_*`, `KITTY_*`, `WEZTERM_*`, `ITERM_SESSION_ID`, `VSCODE_PID`, `ALACRITTY_WINDOW_ID`, `WT_SESSION`, `LC_TERMINAL` variables removed) so TUI agents advertise iTerm2 images instead of Kitty graphics, which `xterm.js` cannot draw.
