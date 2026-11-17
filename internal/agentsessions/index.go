// Package agentsessions maps a terminal back to the coding agent conversation it
// was running.
//
// A terminal only knows its argv, cwd and the title the agent paints — the core has
// no session id (except the label alma writes). The agents themselves keep one file
// per session under a directory per cwd, and the first lines of that file carry the
// session id, its cwd, its start time and the title the agent shows in the terminal
// bar. So the id is recovered by matching those against the terminal.
package agentsessions

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
)

// Session is one stored agent conversation.
type Session struct {
	ID      string
	Path    string
	Cwd     string
	Agent   string
	StartMs int64
	Title   string
}

// store is one agent's session directory.
type store struct {
	dir   string
	agent string
}

// Index reads the agents' session stores on demand and remembers them briefly.
type Index struct {
	stores []store

	mu    sync.Mutex
	built time.Time
	byCwd map[string][]Session
}

// DefaultRoots returns the session stores that exist on this machine.
func DefaultRoots() []store {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	var stores []store
	for _, s := range []struct{ rel, agent string }{
		{".omp/agent/sessions", "omp"},
		{".pi/agent/sessions", "pi"},
	} {
		dir := filepath.Join(home, s.rel)
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			stores = append(stores, store{dir: dir, agent: s.agent})
		}
	}
	return stores
}

func New(stores []store) *Index {
	return &Index{stores: stores, byCwd: map[string][]Session{}}
}

// For returns the stored sessions of one directory, newest first.
func (ix *Index) For(cwd string) []Session {
	if cwd == "" || len(ix.stores) == 0 {
		return nil
	}
	ix.mu.Lock()
	defer ix.mu.Unlock()
	if time.Since(ix.built) > time.Minute {
		ix.rebuild()
	}
	return ix.byCwd[cwd]
}

// Match finds the session a terminal ran: the one whose title the terminal shows,
// else the nearest start of the same agent. Sessions of other agents are ignored —
// a pi terminal never continues an omp conversation.
func (ix *Index) Match(cwd, agent string, createdMs uint64, title string) (Session, bool) {
	var sessions []Session
	for _, s := range ix.For(cwd) {
		if agent == "" || s.Agent == agent {
			sessions = append(sessions, s)
		}
	}
	if len(sessions) == 0 {
		return Session{}, false
	}
	title = CleanTitle(title)
	if len(title) >= 8 {
		for _, s := range sessions {
			if len(s.Title) >= 8 && strings.Contains(title, s.Title) {
				return s, true
			}
		}
	}
	best := Session{}
	bestDelta := int64(12 * time.Hour / time.Millisecond)
	for _, s := range sessions {
		delta := s.StartMs - int64(createdMs)
		if delta < 0 {
			delta = -delta
		}
		if delta < bestDelta {
			best, bestDelta = s, delta
		}
	}
	if best.ID == "" {
		return Session{}, false
	}
	return best, true
}

func (ix *Index) rebuild() {
	byCwd := make(map[string][]Session, len(ix.byCwd))
	for _, st := range ix.stores {
		filepath.WalkDir(st.dir, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			if !strings.HasSuffix(path, ".jsonl") {
				return nil
			}
			if s, ok := parseSessionFile(path); ok {
				s.Agent = st.agent
				byCwd[s.Cwd] = append(byCwd[s.Cwd], s)
			}
			return nil
		})
	}
	for cwd := range byCwd {
		sessions := byCwd[cwd]
		sort.Slice(sessions, func(i, j int) bool { return sessions[i].StartMs > sessions[j].StartMs })
		byCwd[cwd] = sessions
	}
	ix.byCwd = byCwd
	ix.built = time.Now()
}

// parseSessionFile reads the head of a session file: name carries the start time and
// the id, the first records carry the cwd and the title.
func parseSessionFile(path string) (Session, bool) {
	name := strings.TrimSuffix(filepath.Base(path), ".jsonl")
	startPart, id, ok := strings.Cut(name, "_")
	if !ok || id == "" || len(startPart) < 19 {
		return Session{}, false
	}
	// "2026-11-16T09-06-39-153Z": dashes stand in for the colons and the dot.
	start, err := time.Parse("2006-01-02T15-04-05", startPart[:19])
	if err != nil {
		return Session{}, false
	}
	file, err := os.Open(path)
	if err != nil {
		return Session{}, false
	}
	defer file.Close()

	session := Session{ID: id, Path: path, StartMs: start.UnixMilli()}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for lines := 0; lines < 8 && scanner.Scan(); lines++ {
		var record struct {
			Type  string `json:"type"`
			ID    string `json:"id"`
			Cwd   string `json:"cwd"`
			Title string `json:"title"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			continue
		}
		switch record.Type {
		case "session":
			if record.Cwd != "" {
				session.Cwd = filepath.Clean(record.Cwd)
			}
			if record.ID != "" {
				session.ID = record.ID
			}
		case "title":
			session.Title = CleanTitle(record.Title)
		}
	}
	return session, session.Cwd != ""
}

// CleanTitle drops the glyphs agents paint while they work — braille spinners and
// Nerd Font private-use icons — so titles compare and read as plain text.
func CleanTitle(title string) string {
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r >= 0x2800 && r <= 0x28FF: // braille patterns
			return -1
		case r >= 0xE000 && r <= 0xF8FF: // private use
			return -1
		case r >= 0xF0000: // private use planes
			return -1
		case r == 'π': // agent prompt marker
			return -1
		case unicode.Is(unicode.Cf, r): // zero width, variation selectors
			return -1
		}
		return r
	}, title)
	cleaned = strings.TrimLeftFunc(cleaned, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	return strings.Join(strings.Fields(cleaned), " ")
}
