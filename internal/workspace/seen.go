package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// seenSpace is a Herdr space this workbench has displayed at least once. The app
// only publishes the spaces that exist right now, so without this the sidebar
// forgets a space the moment it is closed — and with it every conversation that
// ran inside it.
type seenSpace struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Path       string `json:"path"`
	LastSeenMs int64  `json:"last_seen_ms"`
}

// seenState is the on-disk list, newest first.
type seenState struct {
	Spaces []seenSpace `json:"spaces"`
}

const (
	// seenFile is a sibling of workspaces.json, so one directory holds all of the
	// workbench's local state.
	seenFile = "spaces-seen.json"
	// seenRewriteGap keeps List cheap: it runs on every hc event, and only a new
	// space, a renamed one, or a moved one is worth another write.
	seenRewriteGap = 5 * time.Minute
)

func (m *Manager) initSeen() {
	dir := filepath.Dir(m.configPath)
	if m.configPath == "" || dir == "." {
		return
	}
	m.seenMu.Lock()
	m.seenPath = filepath.Join(dir, seenFile)
	m.seen = map[string]seenSpace{}
	if data, err := os.ReadFile(m.seenPath); err == nil {
		var state seenState
		if json.Unmarshal(data, &state) == nil {
			for _, sp := range state.Spaces {
				if sp.ID != "" {
					m.seen[sp.ID] = sp
				}
			}
		}
	}
	m.seenMu.Unlock()
}

// rememberSpaces records every space currently published by the app. It writes
// only when something actually changed, so calling it from List is cheap.
func (m *Manager) rememberSpaces(spaces []spaceRow) {
	if len(spaces) == 0 || m.seenPath == "" {
		return
	}
	now := time.Now().UnixMilli()
	m.seenMu.Lock()
	changed := false
	for _, sp := range spaces {
		if sp.ID == "" {
			continue
		}
		prev, ok := m.seen[sp.ID]
		// A rename or a folder change is worth persisting; a bare sighting only
		// refreshes last_seen in memory and is flushed by the periodic rewrite.
		if !ok || prev.Name != sp.Name || prev.Path != sp.Path || now-prev.LastSeenMs > int64(seenRewriteGap/time.Millisecond) {
			m.seen[sp.ID] = seenSpace{ID: sp.ID, Name: sp.Name, Path: sp.Path, LastSeenMs: now}
			changed = true
		}
	}
	var snapshot []seenSpace
	if changed {
		snapshot = make([]seenSpace, 0, len(m.seen))
		for _, sp := range m.seen {
			snapshot = append(snapshot, sp)
		}
	}
	m.seenMu.Unlock()
	if !changed {
		return
	}
	// Newest first, so the file reads like a history.
	for i := 1; i < len(snapshot); i++ {
		for j := i; j > 0 && snapshot[j].LastSeenMs > snapshot[j-1].LastSeenMs; j-- {
			snapshot[j], snapshot[j-1] = snapshot[j-1], snapshot[j]
		}
	}
	data, err := json.MarshalIndent(seenState{Spaces: snapshot}, "", "  ")
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(m.seenPath), 0o755); err != nil {
		return
	}
	_ = os.WriteFile(m.seenPath, data, 0o644)
}

// forgottenSpaces returns the spaces this workbench has seen but the app no longer
// publishes, newest sighting first.
func (m *Manager) forgottenSpaces(live map[string]bool) []seenSpace {
	if m.seenPath == "" {
		return nil
	}
	m.seenMu.RLock()
	rows := make([]seenSpace, 0, len(m.seen))
	for _, sp := range m.seen {
		if live[sp.ID] {
			continue
		}
		rows = append(rows, sp)
	}
	m.seenMu.RUnlock()
	for i := 1; i < len(rows); i++ {
		for j := i; j > 0 && rows[j].LastSeenMs > rows[j-1].LastSeenMs; j-- {
			rows[j], rows[j-1] = rows[j-1], rows[j]
		}
	}
	return rows
}

// spaceRow is the part of an app space this package remembers.
type spaceRow struct {
	ID   string
	Name string
	Path string
}
