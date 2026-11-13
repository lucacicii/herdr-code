package workspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/lucacicii/herdr-code/internal/hc"
)

type StatusCounts struct {
	Working  int `json:"working"`
	Blocked  int `json:"blocked"`
	Idle     int `json:"idle"`
	Done     int `json:"done"`
	Error    int `json:"error"`
	Total    int `json:"total"`
}

type Workspace struct {
	ID         string        `json:"id"`
	Name       string        `json:"name"`
	Path       string        `json:"path"`
	IsGitRepo  bool          `json:"is_git_repo"`
	Pinned     bool          `json:"pinned"`
	Auto       bool          `json:"auto"`
	Terminals  []hc.Terminal `json:"terminals"`
	Counts     StatusCounts  `json:"counts"`
	UpdatedMs  int64         `json:"updated_ms"`
}

type savedWorkspace struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Path       string `json:"path"`
	Pinned     bool   `json:"pinned"`
	AddedMs    int64  `json:"added_ms"`
}

type Manager struct {
	hc         *hc.Client
	configPath string

	mu          sync.RWMutex
	saved       map[string]savedWorkspace // keyed by canonical path
	byID        map[string]string         // id -> canonical path
	gitRootCache map[string]string        // cwd -> gitRoot ("" if not repo)
}

func NewManager(hcClient *hc.Client, configPath string) *Manager {
	if configPath == "" {
		if home, err := os.UserHomeDir(); err == nil {
			configPath = filepath.Join(home, ".config", "herdr-code", "workspaces.json")
		}
	}
	m := &Manager{
		hc:           hcClient,
		configPath:   configPath,
		saved:        make(map[string]savedWorkspace),
		byID:         make(map[string]string),
		gitRootCache: make(map[string]string),
	}
	m.load()
	return m
}

func workspaceIDForPath(p string) string {
	sum := sha256.Sum256([]byte(p))
	return hex.EncodeToString(sum[:6])
}

func canonicalDir(p string) (string, error) {
	if p == "" {
		return "", errors.New("empty path")
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("not a directory: %s", resolved)
	}
	return resolved, nil
}

func (m *Manager) load() {
	if m.configPath == "" {
		return
	}
	data, err := os.ReadFile(m.configPath)
	if err != nil {
		return
	}
	var list []savedWorkspace
	if err := json.Unmarshal(data, &list); err != nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, w := range list {
		if canon, err := canonicalDir(w.Path); err == nil {
			w.Path = canon
			if w.ID == "" {
				w.ID = workspaceIDForPath(canon)
			}
			if w.Name == "" {
				w.Name = filepath.Base(canon)
			}
			m.saved[canon] = w
			m.byID[w.ID] = canon
		}
	}
}

func (m *Manager) saveLocked() error {
	if m.configPath == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(m.configPath), 0o755); err != nil {
		return err
	}
	list := make([]savedWorkspace, 0, len(m.saved))
	for _, w := range m.saved {
		list = append(list, w)
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].Path < list[j].Path
	})
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(m.configPath, data, 0o644)
}

func (m *Manager) resolveGitRoot(ctx context.Context, dir string) string {
	m.mu.RLock()
	cached, ok := m.gitRootCache[dir]
	m.mu.RUnlock()
	if ok {
		return cached
	}

	cctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()
	cmd := exec.CommandContext(cctx, "git", "-C", dir, "rev-parse", "--show-toplevel")
	out, err := cmd.Output()
	root := ""
	if err == nil {
		candidate := strings.TrimSpace(string(out))
		if canon, err := canonicalDir(candidate); err == nil {
			root = canon
		}
	}

	m.mu.Lock()
	m.gitRootCache[dir] = root
	m.mu.Unlock()
	return root
}

func (m *Manager) Add(ctx context.Context, rawPath string, pin bool) (*Workspace, error) {
	canon, err := canonicalDir(rawPath)
	if err != nil {
		return nil, err
	}
	gitRoot := m.resolveGitRoot(ctx, canon)
	target := canon
	if gitRoot != "" {
		target = gitRoot
	}
	id := workspaceIDForPath(target)

	m.mu.Lock()
	existing, ok := m.saved[target]
	if !ok {
		existing = savedWorkspace{
			ID:      id,
			Name:    filepath.Base(target),
			Path:    target,
			Pinned:  pin,
			AddedMs: time.Now().UnixMilli(),
		}
	} else if pin {
		existing.Pinned = true
	}
	m.saved[target] = existing
	m.byID[id] = target
	_ = m.saveLocked()
	m.mu.Unlock()

	list, err := m.List(ctx)
	if err == nil {
		for i := range list {
			if list[i].ID == id {
				return &list[i], nil
			}
		}
	}
	return &Workspace{
		ID:        id,
		Name:      existing.Name,
		Path:      target,
		IsGitRepo: gitRoot != "",
		Pinned:    existing.Pinned,
		Terminals: []hc.Terminal{},
		UpdatedMs: time.Now().UnixMilli(),
	}, nil
}

func (m *Manager) SetPinned(id string, pinned bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	path, ok := m.byID[id]
	if !ok {
		return fmt.Errorf("workspace not found: %s", id)
	}
	w, ok := m.saved[path]
	if !ok {
		if !pinned {
			return nil
		}
		w = savedWorkspace{
			ID:      id,
			Name:    filepath.Base(path),
			Path:    path,
			Pinned:  true,
			AddedMs: time.Now().UnixMilli(),
		}
	} else {
		w.Pinned = pinned
	}
	if !pinned {
		delete(m.saved, path)
	} else {
		m.saved[path] = w
	}
	return m.saveLocked()
}

func (m *Manager) List(ctx context.Context) ([]Workspace, error) {
	var terminals []hc.Terminal
	if m.hc != nil {
		if res, err := m.hc.ListTerminals(ctx, false); err == nil {
			terminals = res.Terminals
		}
	}

	wsMap := make(map[string]*Workspace)

	m.mu.RLock()
	savedCopy := make([]savedWorkspace, 0, len(m.saved))
	for _, sw := range m.saved {
		savedCopy = append(savedCopy, sw)
	}
	m.mu.RUnlock()

	for _, sw := range savedCopy {
		wsMap[sw.Path] = &Workspace{
			ID:        sw.ID,
			Name:      sw.Name,
			Path:      sw.Path,
			IsGitRepo: m.resolveGitRoot(ctx, sw.Path) != "",
			Pinned:    sw.Pinned,
			Auto:      false,
			Terminals: []hc.Terminal{},
			UpdatedMs: sw.AddedMs,
		}
	}

	for _, t := range terminals {
		cwd := t.Cwd
		if t.Foreground != nil && t.Foreground.Cwd != "" {
			cwd = t.Foreground.Cwd
		}
		canon, err := canonicalDir(cwd)
		if err != nil {
			continue
		}
		root := m.resolveGitRoot(ctx, canon)
		isRepo := root != ""
		if !isRepo {
			root = canon
		}
		ws, ok := wsMap[root]
		if !ok {
			id := workspaceIDForPath(root)
			ws = &Workspace{
				ID:        id,
				Name:      filepath.Base(root),
				Path:      root,
				IsGitRepo: isRepo,
				Pinned:    false,
				Auto:      true,
				Terminals: []hc.Terminal{},
				UpdatedMs: int64(t.CreatedMs),
			}
			wsMap[root] = ws
			m.mu.Lock()
			m.byID[id] = root
			m.mu.Unlock()
		}
		ws.Terminals = append(ws.Terminals, t)
		ws.Counts.Total++
		if t.Status != nil {
			switch t.Status.State {
			case "working":
				ws.Counts.Working++
			case "blocked":
				ws.Counts.Blocked++
			case "idle":
				ws.Counts.Idle++
			case "done":
				ws.Counts.Done++
			case "error":
				ws.Counts.Error++
			}
		} else {
			ws.Counts.Idle++
		}
		if int64(t.CreatedMs) > ws.UpdatedMs {
			ws.UpdatedMs = int64(t.CreatedMs)
		}
	}

	result := make([]Workspace, 0, len(wsMap))
	for _, ws := range wsMap {
		sort.Slice(ws.Terminals, func(i, j int) bool {
			return ws.Terminals[i].CreatedMs < ws.Terminals[j].CreatedMs
		})
		result = append(result, *ws)
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].Pinned != result[j].Pinned {
			return result[i].Pinned
		}
		if (result[i].Counts.Total > 0) != (result[j].Counts.Total > 0) {
			return result[i].Counts.Total > 0
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})

	return result, nil
}

func (m *Manager) ResolveWorkspace(ctx context.Context, id string) (*Workspace, error) {
	m.mu.RLock()
	path, ok := m.byID[id]
	m.mu.RUnlock()
	if ok {
		return &Workspace{
			ID:        id,
			Name:      filepath.Base(path),
			Path:      path,
			IsGitRepo: m.resolveGitRoot(ctx, path) != "",
		}, nil
	}
	list, err := m.List(ctx)
	if err != nil {
		return nil, err
	}
	for i := range list {
		if list[i].ID == id {
			return &list[i], nil
		}
	}
	return nil, fmt.Errorf("workspace not found: %s", id)
}

// ResolveSafePath resolves a workspace-relative path and guarantees it does not escape root.
func ResolveSafePath(root string, rel string) (string, error) {
	canonRoot, err := canonicalDir(root)
	if err != nil {
		return "", err
	}
	clean := filepath.Clean(rel)
	if clean == "." || clean == "" {
		return canonRoot, nil
	}
	if filepath.IsAbs(clean) || strings.HasPrefix(clean, "..") {
		return "", errors.New("path escapes workspace root")
	}
	joined := filepath.Join(canonRoot, clean)
	if resolved, err := filepath.EvalSymlinks(joined); err == nil {
		if resolved != canonRoot && !strings.HasPrefix(resolved, canonRoot+string(filepath.Separator)) {
			return "", errors.New("symlink escapes workspace root")
		}
		return resolved, nil
	}
	// If target doesn't exist yet, verify its deepest existing ancestor stays inside root.
	dir := filepath.Dir(joined)
	if resolvedDir, err := filepath.EvalSymlinks(dir); err == nil {
		if resolvedDir != canonRoot && !strings.HasPrefix(resolvedDir, canonRoot+string(filepath.Separator)) {
			return "", errors.New("path ancestor escapes workspace root")
		}
	}
	return joined, nil
}
