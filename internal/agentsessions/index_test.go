package agentsessions

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/lucacicii/herdr-code/internal/hc"
)

func hcTerminal(address, state string, argv []string, cwd, title string, labels map[string]string) hc.Terminal {
	return hc.Terminal{
		Address:   address,
		State:     state,
		Argv:      argv,
		Cwd:       cwd,
		Title:     title,
		Labels:    labels,
		CreatedMs: 1794890000000,
	}
}

// writeSession stores a session file the way the agents do: the name carries the
// start time and the id, the head carries the cwd and the title.
func writeSession(t *testing.T, dir, name, cwd, id, title string) {
	t.Helper()
	body := `{"type":"title","title":"` + title + `"}
{"type":"session","version":3,"id":"` + id + `","cwd":"` + cwd + `"}
`
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
		t.Fatalf("write session: %v", err)
	}
}

func TestMatchFindsSessionByTitleThenByTime(t *testing.T) {
	dir := t.TempDir()
	writeSession(t, dir,
		"2026-11-16T09-06-39-153Z_01a1e39b-c5b1-705c-8cf6-e755b536e8e5.jsonl",
		"/w/tms", "01a1e39b-c5b1-705c-8cf6-e755b536e8e5", "󰘬 BRANCH: 查看分支")
	writeSession(t, dir,
		"2026-11-17T06-07-37-544Z_01a1e81e-3a48-77c4-a020-3bff94e250cb.jsonl",
		"/w/tms", "01a1e81e-3a48-77c4-a020-3bff94e250cb", "SESS: 排查多端不一致")

	ix := New([]store{{dir: dir, agent: "omp"}})

	// The terminal paints the title with a spinner and a prompt marker; the store
	// keeps only the words.
	byTitle, ok := ix.Match("/w/tms", "omp", 0, "π > 󰘬 BRANCH: 查看分支")
	if !ok || byTitle.ID != "01a1e39b-c5b1-705c-8cf6-e755b536e8e5" {
		t.Fatalf("title match = %+v, %v", byTitle, ok)
	}

	// No usable title: the session that started closest to the terminal wins.
	created := byTitle.StartMs + 4*60*1000
	byTime, ok := ix.Match("/w/tms", "omp", uint64(created), "")
	if !ok || byTime.ID != byTitle.ID {
		t.Fatalf("time match = %+v, %v", byTime, ok)
	}
}

func TestMatchIgnoresSessionsOfOtherDirectories(t *testing.T) {
	dir := t.TempDir()
	writeSession(t, dir,
		"2026-11-17T06-07-37-544Z_01a1e81e-3a48-77c4-a020-3bff94e250cb.jsonl",
		"/w/gmsd", "01a1e81e-3a48-77c4-a020-3bff94e250cb", "API: 路由")

	ix := New([]store{{dir: dir, agent: "omp"}})
	if _, ok := ix.Match("/w/tms", "omp", 0, "API: 路由"); ok {
		t.Fatal("matched a session of another directory")
	}
	if got := len(ix.For("/w/gmsd")); got != 1 {
		t.Fatalf("gmsd sessions = %d, want 1", got)
	}
	// Another agent's conversation is never resumed by mistake: a pi terminal in
	// the same directory stays without an id.
	created := uint64(1794890000000)
	if s, ok := ix.Match("/w/gmsd", "omp", created, ""); !ok || s.ID != "01a1e81e-3a48-77c4-a020-3bff94e250cb" {
		t.Fatalf("same-agent match = %+v, %v", s, ok)
	}
	if s, ok := ix.Match("/w/gmsd", "pi", created, ""); ok {
		t.Fatalf("pi matched an omp session: %+v", s)
	}
}

func TestCleanTitleDropsAgentGlyphs(t *testing.T) {
	cases := map[string]string{
		"π ⠧ 󰍺 SESS: 排查 herdr 多端 session 不一致": "SESS: 排查 herdr 多端 session 不一致",
		"π > 󰘬 BRANCH: 查看 wb-tms-web 分支":      "BRANCH: 查看 wb-tms-web 分支",
		"  π   XIMG:   Add image  ":           "XIMG: Add image",
	}
	for in, want := range cases {
		if got := CleanTitle(in); got != want {
			t.Errorf("CleanTitle(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDescribeResumesByPublishedLabel(t *testing.T) {
	terminal := hcTerminal("t1", "live", []string{"omp", "--no-session"}, "/w/tms", "π ⠧ SESS: x", map[string]string{
		SessionLabel: "omp:id:01a1e761-6cc0-70c6-be69-912a0cd13542",
	})
	info := Describe(terminal, nil)
	if info.Agent != "omp" || info.SessionID != "01a1e761-6cc0-70c6-be69-912a0cd13542" || !info.IDKnown {
		t.Fatalf("describe = %+v", info)
	}
	if len(info.ResumeArgv) != 3 || info.ResumeArgv[0] != "omp" || info.ResumeArgv[1] != "--resume" {
		t.Fatalf("resume argv = %v", info.ResumeArgv)
	}
}

func TestDescribeWithoutSessionIDContinuesTheDirectory(t *testing.T) {
	terminal := hcTerminal("t2", "finished", []string{"/bin/zsh", "-lic", "pi"}, "/w/tms", "", nil)
	info := Describe(terminal, nil)
	if info.Agent != "pi" || info.IDKnown {
		t.Fatalf("describe = %+v", info)
	}
	if want := []string{"pi", "-c"}; len(info.ResumeArgv) != 2 || info.ResumeArgv[0] != want[0] || info.ResumeArgv[1] != want[1] {
		t.Fatalf("resume argv = %v, want %v", info.ResumeArgv, want)
	}
	if info.ResumeNote == "" {
		t.Fatal("missing resume note")
	}
}

func TestDescribeLeavesShellsAlone(t *testing.T) {
	terminal := hcTerminal("t3", "finished", []string{"/bin/zsh", "-l"}, "/w/tms", "", nil)
	info := Describe(terminal, nil)
	if info.Agent != "shell" {
		t.Fatalf("agent = %q", info.Agent)
	}
	if len(info.ResumeArgv) != 2 || info.ResumeArgv[0] != "/bin/zsh" {
		t.Fatalf("resume argv = %v", info.ResumeArgv)
	}
}
