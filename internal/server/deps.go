package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/lucacicii/herdr-code/internal/hc"
)

type DepCLIStatus struct {
	Installed bool   `json:"installed"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
}

type DepDaemonStatus struct {
	Running       bool   `json:"running"`
	SocketPath    string `json:"socket_path"`
	Version       string `json:"version,omitempty"`
	PID           int    `json:"pid,omitempty"`
	LiveTerminals int    `json:"live_terminals,omitempty"`
	Error         string `json:"error,omitempty"`
}

type DependenciesStatus struct {
	OS            string          `json:"os"`
	Arch          string          `json:"arch"`
	AllRequiredOK bool            `json:"all_required_ok"`
	HCCLI         DepCLIStatus    `json:"hc_cli"`
	HCDaemon      DepDaemonStatus `json:"hc_daemon"`
	GitCLI        DepCLIStatus    `json:"git_cli"`
}

var installMu sync.Mutex

func findExecutable(name string, extraCandidates []string) string {
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	for _, c := range extraCandidates {
		if c == "" {
			continue
		}
		if info, err := os.Stat(c); err == nil && !info.IsDir() {
			return c
		}
	}
	return ""
}

func findHCPath() string {
	home, _ := os.UserHomeDir()
	candidates := []string{}
	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, ".local", "bin", "hc"),
			filepath.Join(home, "bin", "hc"),
		)
	}
	candidates = append(candidates, "/opt/homebrew/bin/hc", "/usr/local/bin/hc")
	return findExecutable("hc", candidates)
}

func probeCommandVersion(ctx context.Context, bin string, args ...string) string {
	cctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()
	out, err := exec.CommandContext(cctx, bin, args...).CombinedOutput()
	if err != nil {
		return ""
	}
	line := strings.TrimSpace(strings.Split(string(out), "\n")[0])
	return line
}

func (s *Server) CheckDependencies(ctx context.Context) DependenciesStatus {
	hcPath := findHCPath()
	hcCLI := DepCLIStatus{
		Installed: hcPath != "",
		Path:      hcPath,
	}
	if hcCLI.Installed {
		hcCLI.Version = probeCommandVersion(ctx, hcPath, "--version")
	}

	gitPath := findExecutable("git", []string{"/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"})
	gitCLI := DepCLIStatus{
		Installed: gitPath != "",
		Path:      gitPath,
	}
	if gitCLI.Installed {
		gitCLI.Version = probeCommandVersion(ctx, gitPath, "--version")
	}

	daemon := DepDaemonStatus{
		SocketPath: s.hc.SocketPath(),
	}
	cctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()
	if st, err := s.hc.ServerStatus(cctx); err == nil {
		daemon.Running = true
		daemon.Version = st.Version
		daemon.PID = st.PID
		daemon.LiveTerminals = st.Live
	} else {
		daemon.Error = err.Error()
	}

	return DependenciesStatus{
		OS:            runtime.GOOS,
		Arch:          runtime.GOARCH,
		AllRequiredOK: hcCLI.Installed && daemon.Running && gitCLI.Installed,
		HCCLI:         hcCLI,
		HCDaemon:      daemon,
		GitCLI:        gitCLI,
	}
}

func (s *Server) EnsureHCDaemonIfInstalled(ctx context.Context) {
	if s.hc.SocketPath() != hc.DefaultSocketPath() {
		return
	}
	cctx, cancel := context.WithTimeout(ctx, 1200*time.Millisecond)
	_, err := s.hc.ServerStatus(cctx)
	cancel()
	if err == nil {
		return
	}
	hcPath := findHCPath()
	if hcPath == "" {
		return
	}
	sctx, scancel := context.WithTimeout(ctx, 10*time.Second)
	defer scancel()
	if out, err := runInstallerCmd(sctx, hcPath, "server", "start"); err != nil {
		log.Printf("auto-start hc daemon failed: %v (%s)", err, strings.TrimSpace(out))
	} else {
		log.Printf("auto-started herdr-core daemon via %s", hcPath)
	}
}

func (s *Server) handleGetDependencies(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.CheckDependencies(r.Context()))
}

func runInstallerCmd(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	env := os.Environ()
	if home, err := os.UserHomeDir(); err == nil {
		localBin := filepath.Join(home, ".local", "bin")
		updated := false
		for i, kv := range env {
			if strings.HasPrefix(kv, "PATH=") {
				env[i] = "PATH=" + localBin + string(os.PathListSeparator) + strings.TrimPrefix(kv, "PATH=")
				updated = true
				break
			}
		}
		if !updated {
			env = append(env, "PATH="+localBin)
		}
	}
	cmd.Env = env
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err := cmd.Run()
	return buf.String(), err
}

func (s *Server) handleInstallDependency(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Target string `json:"target"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}

	switch body.Target {
	case "herdr-core", "herdr-core-start":
	default:
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("unsupported install target: %q", body.Target))
		return
	}

	if !installMu.TryLock() {
		writeJSONError(w, http.StatusConflict, errors.New("another installation is already running"))
		return
	}
	defer installMu.Unlock()

	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	var logs strings.Builder
	var runErr error

	switch body.Target {
	case "herdr-core":
		if runtime.GOOS == "windows" {
			out, err := runInstallerCmd(ctx, "powershell", "-ExecutionPolicy", "Bypass", "-Command",
				"irm https://releases.herdr.dev/core/install.ps1 | iex")
			logs.WriteString(out)
			runErr = err
		} else {
			out, err := runInstallerCmd(ctx, "sh", "-c",
				"curl -fsSL https://releases.herdr.dev/core/install.sh | sh")
			logs.WriteString(out)
			runErr = err
		}
		if runErr == nil {
			if hcPath := findHCPath(); hcPath != "" {
				out, err := runInstallerCmd(ctx, hcPath, "server", "start")
				if out != "" {
					logs.WriteString("\n" + out)
				}
				if err != nil {
					logs.WriteString("\nhc server start note: " + err.Error())
				}
			}
		}

	case "herdr-core-start":
		hcPath := findHCPath()
		if hcPath == "" {
			runErr = errors.New("hc binary not found; install herdr-core first")
		} else {
			out, err := runInstallerCmd(ctx, hcPath, "server", "start")
			logs.WriteString(out)
			runErr = err
		}
	}

	status := s.CheckDependencies(r.Context())
	resp := map[string]any{
		"ok":     runErr == nil,
		"target": body.Target,
		"output": strings.TrimSpace(logs.String()),
		"status": status,
	}
	if runErr != nil {
		resp["error"] = runErr.Error()
		writeJSON(w, http.StatusOK, resp)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}
