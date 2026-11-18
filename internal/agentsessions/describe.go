package agentsessions

import (
	"path/filepath"
	"strings"

	"github.com/lucacicii/herdr-code/internal/hc"
)

// Info is what the history drawer shows for one terminal.
type Info struct {
	Address    string   `json:"address"`
	Agent      string   `json:"agent"`
	SessionID  string   `json:"session_id"`
	IDKnown    bool     `json:"id_known"`
	Title      string   `json:"title"`
	Where      string   `json:"where"`
	Cwd        string   `json:"cwd"`
	State      string   `json:"state"`
	StartedMs  uint64   `json:"started_ms"`
	FinishedMs uint64   `json:"finished_ms,omitempty"`
	Reason     string   `json:"reason,omitempty"`
	ExitCode   *int32   `json:"exit_code,omitempty"`
	ResumeArgv []string `json:"resume_argv"`
	ResumeNote string   `json:"resume_note,omitempty"`
}

// SessionLabel is the label an agent writes to publish its own session id, as
// "omp:id:<uuid>".
const SessionLabel = "alma.session"

// agents names the coding agents whose conversations can be resumed.
var agents = []struct {
	name    string
	resume  string
	keepOne string
}{
	{name: "omp", resume: "--resume", keepOne: "-c"},
	{name: "pi", resume: "--session", keepOne: "-c"},
	{name: "claude", resume: "--resume", keepOne: "--continue"},
}

func agentSpec(name string) (resume, keepOne string, ok bool) {
	for _, a := range agents {
		if a.name == name {
			return a.resume, a.keepOne, true
		}
	}
	return "", "", false
}

// Describe turns a terminal into a session row: the agent, its conversation id when
// one can be recovered, and the command that resumes it.
func Describe(terminal hc.Terminal, ix *Index) Info {
	info := Info{
		Address:   terminal.Address,
		Agent:     "shell",
		Title:     CleanTitle(terminal.Title),
		Where:     terminal.Labels["where"],
		Cwd:       terminal.Cwd,
		State:     terminal.State,
		StartedMs: terminal.CreatedMs,
	}
	if terminal.FinishedMs != nil {
		info.FinishedMs = *terminal.FinishedMs
	}
	if terminal.Reason != nil {
		info.Reason = *terminal.Reason
	}
	info.ExitCode = terminal.ExitCode
	if info.Where == "" {
		info.Where = filepath.Base(info.Cwd)
	}

	agent, published := publishedSession(terminal.Labels[SessionLabel])
	if agent == "" {
		agent = detectAgent(terminal)
	}
	if agent == "" {
		info.ResumeArgv = terminal.Argv
		return info
	}
	info.Agent = agent
	if published != "" {
		info.SessionID, info.IDKnown = published, true
	}
	if !info.IDKnown && ix != nil {
		if s, ok := ix.Match(terminal.Cwd, agent, terminal.CreatedMs, terminal.Title); ok {
			info.SessionID, info.IDKnown = s.ID, true
		}
	}

	resume, keepOne, known := agentSpec(agent)
	switch {
	case !known:
		info.ResumeArgv = terminal.Argv
		info.ResumeNote = "resumes by starting the same command again"
	case info.IDKnown:
		info.ResumeArgv = []string{agent, resume, info.SessionID}
	default:
		info.ResumeArgv = []string{agent, keepOne}
		info.ResumeNote = "no session id found — continues this directory's newest conversation"
	}
	return info
}

// FromStored describes a conversation the agent still keeps on disk even though no
// terminal remembers running it — the only trace a closed space leaves behind.
func FromStored(s Session) Info {
	info := Info{
		Agent:     s.Agent,
		SessionID: s.ID,
		IDKnown:   s.ID != "",
		Title:     CleanTitle(s.Title),
		Cwd:       s.Cwd,
		Where:     filepath.Base(s.Cwd),
		StartedMs: uint64(s.StartMs),
	}
	if resume, _, known := agentSpec(s.Agent); known && s.ID != "" {
		info.ResumeArgv = []string{s.Agent, resume, s.ID}
	} else {
		info.ResumeArgv = []string{s.Agent}
	}
	return info
}

// publishedSession splits a label like "omp:id:01a1e76…" into agent and id.
func publishedSession(value string) (agent, id string) {
	prefix, rest, ok := strings.Cut(value, ":id:")
	if !ok {
		return "", ""
	}
	return prefix, rest
}

// detectAgent reports which coding agent a terminal runs: the foreground program, else
// the last argv element naming one, so `zsh -lic omp` counts and a plain shell does not.
func detectAgent(terminal hc.Terminal) string {
	if terminal.Foreground != nil {
		if name := matchAgent(terminal.Foreground.Name); name != "" {
			return name
		}
		if name := matchArgv(terminal.Foreground.Argv); name != "" {
			return name
		}
	}
	return matchArgv(terminal.Argv)
}

func matchArgv(argv []string) string {
	for i := len(argv) - 1; i >= 0; i-- {
		if name := matchAgent(argv[i]); name != "" {
			return name
		}
	}
	return ""
}

func matchAgent(value string) string {
	base := filepath.Base(value)
	base = strings.TrimSuffix(base, ".js")
	if _, _, ok := agentSpec(base); ok {
		return base
	}
	return ""
}
