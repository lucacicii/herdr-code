package server

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	appfs "github.com/lucacicii/herdr-code/internal/fs"
	appgit "github.com/lucacicii/herdr-code/internal/git"
	"github.com/lucacicii/herdr-code/internal/hc"
	"github.com/lucacicii/herdr-code/internal/workspace"
)

type Config struct {
	Addr           string
	SocketPath     string
	Token          string
	StaticFS       fs.FS
	Version        string
	AllowedOrigins []string
	// WorkspaceConfigPath overrides where workspace pins persist (default: ~/.config/herdr-code/workspaces.json).
	WorkspaceConfigPath string
}

type Server struct {
	cfg        Config
	hc         *hc.Client
	workspaces *workspace.Manager
	hub        *EventHub
	watcher    *appfs.Watcher
	upgrader   websocket.Upgrader
	mux        *http.ServeMux
}

func New(cfg Config) *Server {
	hcClient := hc.NewClient(cfg.SocketPath)
	hub := NewEventHub()
	wsMgr := workspace.NewManager(hcClient, cfg.WorkspaceConfigPath)
	watcher := appfs.NewWatcher(func(wsID, root string, paths []string) {
		hub.Broadcast(map[string]any{
			"type":         "fs.changed",
			"workspace_id": wsID,
			"paths":        paths,
			"timestamp":    time.Now().UnixMilli(),
		})
	})

	s := &Server{
		cfg:        cfg,
		hc:         hcClient,
		workspaces: wsMgr,
		hub:        hub,
		watcher:    watcher,
		mux:        http.NewServeMux(),
	}
	s.upgrader = websocket.Upgrader{
		ReadBufferSize:  32 * 1024,
		WriteBufferSize: 32 * 1024,
		CheckOrigin: func(r *http.Request) bool {
			return s.isAllowedRequestOrigin(r)
		},
	}

	s.registerRoutes()
	return s
}

func (s *Server) Handler() http.Handler {
	return s.withSecurityHeaders(s.mux)
}

func (s *Server) Close() {
	s.watcher.Close()
}

func (s *Server) isAllowedRequestOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := u.Hostname()
	if host == "127.0.0.1" || host == "localhost" || host == "::1" {
		return true
	}
	for _, allowed := range s.cfg.AllowedOrigins {
		allowed = strings.TrimSpace(allowed)
		if allowed == "" {
			continue
		}
		if strings.EqualFold(origin, allowed) || strings.EqualFold(host, allowed) {
			return true
		}
	}
	// When token auth is enabled, allow same-host browser requests (e.g. Tailscale / LAN)
	if s.cfg.Token != "" && r.Host != "" && strings.EqualFold(u.Host, r.Host) {
		return true
	}
	return false
}

func (s *Server) authorizeRequest(r *http.Request) bool {
	if !s.isAllowedRequestOrigin(r) {
		return false
	}
	if s.cfg.Token == "" {
		return true
	}
	auth := r.Header.Get("Authorization")
	const prefix = "Bearer "
	candidate := ""
	if strings.HasPrefix(auth, prefix) {
		candidate = strings.TrimPrefix(auth, prefix)
	} else if q := r.URL.Query().Get("token"); q != "" {
		candidate = q
	}
	if len(candidate) != len(s.cfg.Token) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(candidate), []byte(s.cfg.Token)) == 1
}

func (s *Server) withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) authJSON(fn http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.authorizeRequest(r) {
			writeJSONError(w, http.StatusUnauthorized, errors.New("unauthorized"))
			return
		}
		fn(w, r)
	}
}

func (s *Server) registerRoutes() {
	s.mux.HandleFunc("GET /api/health", s.handleHealth)

	// Workspaces
	s.mux.HandleFunc("GET /api/workspaces", s.authJSON(s.handleListWorkspaces))
	s.mux.HandleFunc("POST /api/workspaces", s.authJSON(s.handleAddWorkspace))
	s.mux.HandleFunc("POST /api/workspaces/{id}/pin", s.authJSON(s.handlePinWorkspace))
	s.mux.HandleFunc("POST /api/workspaces/{id}/watch", s.authJSON(s.handleWatchWorkspace))

	// Local directory picker helper
	s.mux.HandleFunc("GET /api/fs/browse", s.authJSON(s.handleBrowseLocalDirs))

	// Workspace files & search
	s.mux.HandleFunc("GET /api/workspaces/{id}/tree", s.authJSON(s.handleWorkspaceTree))
	s.mux.HandleFunc("GET /api/workspaces/{id}/files/search", s.authJSON(s.handleWorkspaceSearch))
	s.mux.HandleFunc("GET /api/workspaces/{id}/file", s.authJSON(s.handleWorkspaceFile))

	// Workspace git
	s.mux.HandleFunc("GET /api/workspaces/{id}/git/status", s.authJSON(s.handleGitStatus))
	s.mux.HandleFunc("GET /api/workspaces/{id}/git/diff-files", s.authJSON(s.handleGitDiffFiles))
	s.mux.HandleFunc("GET /api/workspaces/{id}/git/diff", s.authJSON(s.handleGitDiff))
	s.mux.HandleFunc("POST /api/workspaces/{id}/git/stage", s.authJSON(s.handleGitStage))
	s.mux.HandleFunc("POST /api/workspaces/{id}/git/unstage", s.authJSON(s.handleGitUnstage))
	s.mux.HandleFunc("POST /api/workspaces/{id}/git/discard", s.authJSON(s.handleGitDiscard))
	s.mux.HandleFunc("POST /api/workspaces/{id}/git/hunk", s.authJSON(s.handleGitHunk))

	// Terminals & templates
	s.mux.HandleFunc("GET /api/herdr/spaces", s.authJSON(s.handleHerdrSpaces))
	s.mux.HandleFunc("GET /api/settings/dependencies", s.authJSON(s.handleGetDependencies))
	s.mux.HandleFunc("POST /api/settings/dependencies/install", s.authJSON(s.handleInstallDependency))
	s.mux.HandleFunc("GET /api/templates", s.authJSON(s.handleListTemplates))
	s.mux.HandleFunc("GET /api/terminals", s.authJSON(s.handleListTerminals))
	s.mux.HandleFunc("POST /api/terminals", s.authJSON(s.handleCreateTerminal))
	s.mux.HandleFunc("POST /api/terminals/{id}/send", s.authJSON(s.handleSendTerminal))
	s.mux.HandleFunc("POST /api/terminals/{id}/keys", s.authJSON(s.handleKeysTerminal))
	s.mux.HandleFunc("POST /api/terminals/{id}/label", s.authJSON(s.handleLabelTerminal))
	s.mux.HandleFunc("POST /api/terminals/{id}/interrupt", s.authJSON(s.handleInterruptTerminal))
	s.mux.HandleFunc("POST /api/terminals/{id}/kill", s.authJSON(s.handleKillTerminal))
	s.mux.HandleFunc("DELETE /api/terminals/{id}", s.authJSON(s.handleRemoveTerminal))

	// WebSockets
	s.mux.HandleFunc("GET /ws/events", s.handleEventsWS)
	s.mux.HandleFunc("GET /ws/terminal/{id}", s.handleTerminalWS)

	// Static SPA
	if s.cfg.StaticFS != nil {
		s.mux.Handle("/", s.handleSPA(s.cfg.StaticFS))
	}
}

func (s *Server) handleSPA(staticFS fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(staticFS))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/ws/") {
			http.NotFound(w, r)
			return
		}
		clean := strings.TrimPrefix(filepath.Clean(r.URL.Path), "/")
		if clean == "" || clean == "." {
			clean = "index.html"
		}
		if f, err := staticFS.Open(clean); err == nil {
			_ = f.Close()
			if strings.HasSuffix(clean, ".webmanifest") {
				w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
				w.Header().Set("Cache-Control", "no-cache")
			} else if clean == "sw.js" {
				w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
				w.Header().Set("Cache-Control", "no-cache")
			}
			fileServer.ServeHTTP(w, r)
			return
		}
		// Fallback to index.html for SPA routes
		indexBytes, err := fs.ReadFile(staticFS, "index.html")
		if err != nil {
			http.Error(w, "frontend assets not built", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(indexBytes)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	st, err := s.hc.ServerStatus(ctx)
	resp := map[string]any{
		"ok":            true,
		"version":       s.cfg.Version,
		"socket":        s.hc.SocketPath(),
		"auth_required": s.cfg.Token != "",
		"hc_connected":  err == nil,
	}
	if err == nil {
		resp["hc_version"] = st.Version
		resp["hc_core"] = st.Core
		resp["live_terminals"] = st.Live
	} else {
		resp["hc_error"] = err.Error()
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleListWorkspaces(w http.ResponseWriter, r *http.Request) {
	opts := workspace.ListOptions{
		IncludeFinished: r.URL.Query().Get("include_finished") == "1",
	}
	list, err := s.workspaces.List(r.Context(), opts)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"workspaces": list})
}

func (s *Server) handleAddWorkspace(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
		Pin  *bool  `json:"pin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	pin := true
	if body.Pin != nil {
		pin = *body.Pin
	}
	path := expandTilde(strings.TrimSpace(body.Path))
	ws, err := s.workspaces.Add(r.Context(), path, pin)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"workspace": ws})
}

func (s *Server) handlePinWorkspace(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Pinned bool `json:"pinned"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.workspaces.SetPinned(id, body.Pinned); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleWatchWorkspace(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ws, err := s.workspaces.ResolveWorkspace(r.Context(), id)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err)
		return
	}
	if err := s.watcher.Watch(ws.ID, ws.Path); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "watching": ws.Path})
}

func (s *Server) handleBrowseLocalDirs(w http.ResponseWriter, r *http.Request) {
	dir := strings.TrimSpace(r.URL.Query().Get("dir"))
	if dir == "" || dir == "~" {
		if home, err := os.UserHomeDir(); err == nil {
			dir = home
		}
	} else {
		dir = expandTilde(dir)
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	type dirEntry struct {
		Name string `json:"name"`
		Path string `json:"path"`
	}
	dirs := make([]dirEntry, 0)
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		dirs = append(dirs, dirEntry{
			Name: e.Name(),
			Path: filepath.Join(abs, e.Name()),
		})
	}
	sort.Slice(dirs, func(i, j int) bool {
		return strings.ToLower(dirs[i].Name) < strings.ToLower(dirs[j].Name)
	})
	parent := filepath.Dir(abs)
	if parent == abs {
		parent = ""
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"current": abs,
		"parent":  parent,
		"dirs":    dirs,
	})
}

func (s *Server) handleWorkspaceTree(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ws, err := s.workspaces.ResolveWorkspace(r.Context(), id)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err)
		return
	}
	rel := r.URL.Query().Get("path")
	showHidden := r.URL.Query().Get("hidden") == "1" || r.URL.Query().Get("hidden") == "true"
	entries, err := appfs.ListDir(ws.Path, rel, showHidden)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":    rel,
		"entries": entries,
	})
}

func (s *Server) handleWorkspaceSearch(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ws, err := s.workspaces.ResolveWorkspace(r.Context(), id)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err)
		return
	}
	q := r.URL.Query().Get("q")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	matches, err := appfs.SearchFiles(r.Context(), ws.Path, q, limit)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"matches": matches})
}

func (s *Server) handleWorkspaceFile(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ws, err := s.workspaces.ResolveWorkspace(r.Context(), id)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err)
		return
	}
	rel := r.URL.Query().Get("path")
	file, err := appfs.ReadFile(ws.Path, rel)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, file)
}

func (s *Server) handleGitStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ws, err := s.workspaces.ResolveWorkspace(r.Context(), id)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err)
		return
	}
	st, err := appgit.GetStatus(r.Context(), ws.Path)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) handleGitDiffFiles(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ws, err := s.workspaces.ResolveWorkspace(r.Context(), id)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err)
		return
	}
	mode := r.URL.Query().Get("mode")
	target := r.URL.Query().Get("target")
	files, err := appgit.ListChangedFiles(r.Context(), ws.Path, mode, target)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"files": files})
}

func (s *Server) handleGitDiff(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ws, err := s.workspaces.ResolveWorkspace(r.Context(), id)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err)
		return
	}
	mode := r.URL.Query().Get("mode")
	target := r.URL.Query().Get("target")
	relPath := r.URL.Query().Get("path")
	diff, err := appgit.GetFileDiff(r.Context(), ws.Path, mode, target, relPath)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, diff)
}

func (s *Server) handleGitStage(w http.ResponseWriter, r *http.Request) {
	s.handleGitFileAction(w, r, appgit.StageFile)
}

func (s *Server) handleGitUnstage(w http.ResponseWriter, r *http.Request) {
	s.handleGitFileAction(w, r, appgit.UnstageFile)
}

func (s *Server) handleGitDiscard(w http.ResponseWriter, r *http.Request) {
	s.handleGitFileAction(w, r, appgit.DiscardFile)
}

func (s *Server) handleGitFileAction(w http.ResponseWriter, r *http.Request, fn func(context.Context, string, string) error) {
	id := r.PathValue("id")
	ws, err := s.workspaces.ResolveWorkspace(r.Context(), id)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err)
		return
	}
	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	if err := fn(r.Context(), ws.Path, body.Path); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleGitHunk(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ws, err := s.workspaces.ResolveWorkspace(r.Context(), id)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err)
		return
	}
	var body struct {
		Patch  string `json:"patch"`
		Action string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	if err := appgit.ApplyHunk(r.Context(), ws.Path, body.Patch, body.Action); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleListTemplates(w http.ResponseWriter, r *http.Request) {
	templates, err := s.hc.ListTemplates(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"templates": templates})
}

func (s *Server) handleListTerminals(w http.ResponseWriter, r *http.Request) {
	list, err := s.hc.ListTerminals(r.Context(), r.URL.Query().Get("all") == "1")
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// Terminal programs choose a graphics protocol from the environment they
// inherit, and a pane inherits whatever launched the daemon. Started from
// Ghostty, every agent answers with Kitty graphics frames that xterm.js
// discards, so images vanish. Panes draw Sixel and iTerm2 inline images, so
// children get that identity and ask for the protocol explicitly.
var (
	paneEnvInherited = []string{
		"TERM_PROGRAM", "TERM_PROGRAM_VERSION", "GHOSTTY_RESOURCES_DIR", "GHOSTTY_BIN_DIR",
		"KITTY_WINDOW_ID", "KITTY_LISTEN_ON", "WEZTERM_PANE", "WEZTERM_EXECUTABLE",
		"ITERM_SESSION_ID", "ITERM_PROFILE", "VSCODE_PID", "ALACRITTY_WINDOW_ID",
		"WT_SESSION", "LC_TERMINAL", "LC_TERMINAL_VERSION",
	}
	paneEnvAssigned = []struct{ Key, Value string }{
		{"TERM_PROGRAM", "herdr-code"},
		{"PI_FORCE_IMAGE_PROTOCOL", "iterm2"},
	}
)

// withPaneTerminalEnv prefixes argv with env(1) so the launched program sees a
// terminal identity that matches what the pane can actually render.
func withPaneTerminalEnv(argv []string) []string {
	if len(argv) == 0 {
		return argv
	}
	envPath, err := exec.LookPath("env")
	if err != nil {
		return argv
	}
	wrapped := make([]string, 0, len(argv)+2*len(paneEnvInherited)+len(paneEnvAssigned)+1)
	wrapped = append(wrapped, envPath)
	for _, name := range paneEnvInherited {
		wrapped = append(wrapped, "-u", name)
	}
	for _, kv := range paneEnvAssigned {
		wrapped = append(wrapped, kv.Key+"="+kv.Value)
	}
	return append(wrapped, argv...)
}

func (s *Server) handleCreateTerminal(w http.ResponseWriter, r *http.Request) {
	var body struct {
		WorkspaceID string            `json:"workspace_id"`
		Cwd         string            `json:"cwd"`
		Line        string            `json:"line"`
		Argv        []string          `json:"argv"`
		Name        string            `json:"name"`
		Keep        bool              `json:"keep"`
		Labels      map[string]string `json:"labels"`
		Cols        uint16            `json:"cols"`
		Rows        uint16            `json:"rows"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	cwd := body.Cwd
	workspacePath := ""
	if body.WorkspaceID != "" {
		if ws, err := s.workspaces.ResolveWorkspace(r.Context(), body.WorkspaceID); err == nil {
			workspacePath = ws.Path
			if cwd == "" {
				cwd = ws.Path
			}
		}
	}
	if workspacePath == "" && cwd != "" {
		workspacePath = s.workspaces.WorkspacePathForCwd(r.Context(), cwd)
	}
	labels := body.Labels
	if workspacePath != "" {
		if labels == nil {
			labels = make(map[string]string, 1)
		}
		if _, ok := labels[workspace.WorkspaceLabel]; !ok {
			labels[workspace.WorkspaceLabel] = workspacePath
		}
	}
	if len(body.Argv) == 0 {
		shell := os.Getenv("SHELL")
		if shell == "" {
			shell = "/bin/zsh"
		}
		trimmed := strings.TrimSpace(body.Line)
		if trimmed == "" {
			body.Argv = []string{shell, "-l"}
		} else {
			base := filepath.Base(shell)
			if base == "zsh" || base == "bash" {
				body.Argv = []string{shell, "-lic", trimmed}
			} else {
				body.Argv = []string{shell, "-lc", trimmed}
			}
			body.Line = ""
		}
	}
	var size *hc.RunSize
	if body.Cols > 0 && body.Rows > 0 {
		size = &hc.RunSize{Cols: body.Cols, Rows: body.Rows}
	}
	res, err := s.hc.RunTerminal(r.Context(), hc.RunParams{
		Argv:   withPaneTerminalEnv(body.Argv),
		Line:   body.Line,
		Cwd:    cwd,
		Name:   body.Name,
		Keep:   body.Keep,
		Labels: labels,
		Size:   size,
	})
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleSendTerminal(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Text  string `json:"text"`
		Force bool   `json:"force"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.hc.SendText(r.Context(), hc.SendParams{
		Terminal: id,
		Text:     body.Text,
		Force:    body.Force,
	}); err != nil {
		writeJSONError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleKeysTerminal(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Keys []string `json:"keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.hc.SendKeys(r.Context(), hc.KeysParams{
		Terminal: id,
		Keys:     body.Keys,
	}); err != nil {
		writeJSONError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleInterruptTerminal(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.hc.InterruptTerminal(r.Context(), id); err != nil {
		writeJSONError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleKillTerminal(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.hc.KillTerminal(r.Context(), id); err != nil {
		writeJSONError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleHerdrSpaces(w http.ResponseWriter, r *http.Request) {
	var spaces json.RawMessage = json.RawMessage(`[]`)
	if raw, err := s.hc.DocGet(r.Context(), "herdr-app"); err == nil && len(raw) > 0 {
		var doc struct {
			Spaces json.RawMessage `json:"spaces"`
		}
		if json.Unmarshal(raw, &doc) == nil && len(doc.Spaces) > 0 {
			spaces = doc.Spaces
		}
	}

	colors := map[string]string{}
	if home, err := os.UserHomeDir(); err == nil {
		sharedPath := filepath.Join(home, ".config", "herdr-app", "shared.json")
		if b, err := os.ReadFile(sharedPath); err == nil {
			var shared struct {
				SpaceColors map[string]string `json:"space.colors"`
			}
			if json.Unmarshal(b, &shared) == nil && shared.SpaceColors != nil {
				colors = shared.SpaceColors
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"spaces": spaces,
		"colors": colors,
	})
}

func (s *Server) handleLabelTerminal(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Labels map[string]string `json:"labels"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.hc.SetLabels(r.Context(), id, body.Labels); err != nil {
		writeJSONError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleRemoveTerminal(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.hc.RemoveTerminal(r.Context(), id); err != nil {
		writeJSONError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeJSONError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]any{"error": err.Error()})
}

func expandTilde(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			if p == "~" {
				return home
			}
			return filepath.Join(home, p[2:])
		}
	}
	return p
}

// ListenAndServe starts the HTTP server on a local TCP address.
func (s *Server) ListenAndServe(ctx context.Context) (net.Listener, error) {
	ln, err := net.Listen("tcp", s.cfg.Addr)
	if err != nil {
		return nil, err
	}
	go func() {
		s.EnsureHCDaemonIfInstalled(ctx)
		s.StartHCEventPump(ctx)
	}()
	return ln, nil
}
