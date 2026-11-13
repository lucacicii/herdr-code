package git

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/lucacicii/herdr-code/internal/workspace"
)

type FileStatus struct {
	Path      string `json:"path"`
	OldPath   string `json:"old_path,omitempty"`
	Index     string `json:"index"`     // M, A, D, R, ?
	Worktree  string `json:"worktree"`  // M, A, D, R, ?
	Staged    bool   `json:"staged"`
	Unstaged  bool   `json:"unstaged"`
	Untracked bool   `json:"untracked"`
}

type CommitInfo struct {
	Hash         string `json:"hash"`
	ShortHash    string `json:"short_hash"`
	Subject      string `json:"subject"`
	Author       string `json:"author"`
	RelativeTime string `json:"relative_time"`
}

type RepoStatus struct {
	IsRepo        bool         `json:"is_repo"`
	Branch        string       `json:"branch"`
	Branches      []string     `json:"branches"`
	Files         []FileStatus `json:"files"`
	RecentCommits []CommitInfo `json:"recent_commits"`
}

type DiffHunk struct {
	ID       string   `json:"id"`
	Header   string   `json:"header"`
	OldStart int      `json:"old_start"`
	OldLines int      `json:"old_lines"`
	NewStart int      `json:"new_start"`
	NewLines int      `json:"new_lines"`
	Patch    string   `json:"patch"`
	Lines    []string `json:"lines"`
}

type FileDiff struct {
	Path            string     `json:"path"`
	Mode            string     `json:"mode"` // working, staged, unstaged, branch, commit
	Target          string     `json:"target,omitempty"`
	OriginalContent string     `json:"original_content"`
	ModifiedContent string     `json:"modified_content"`
	UnifiedDiff     string     `json:"unified_diff"`
	Hunks           []DiffHunk `json:"hunks"`
	IsBinary        bool       `json:"is_binary"`
}

type ChangedFile struct {
	Path   string `json:"path"`
	Status string `json:"status"` // M, A, D, R, ?
}

func runGit(ctx context.Context, root string, args ...string) ([]byte, string, error) {
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, "git", append([]string{"-C", root}, args...)...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	return stdout.Bytes(), strings.TrimSpace(stderr.String()), err
}

func runGitStdin(ctx context.Context, root, stdin string, args ...string) error {
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, "git", append([]string{"-C", root}, args...)...)
	cmd.Stdin = strings.NewReader(stdin)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if msg := strings.TrimSpace(stderr.String()); msg != "" {
			return fmt.Errorf("%w: %s", err, msg)
		}
		return err
	}
	return nil
}

func GetStatus(ctx context.Context, root string) (*RepoStatus, error) {
	out, _, err := runGit(ctx, root, "rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(string(out)) != "true" {
		return &RepoStatus{IsRepo: false, Files: []FileStatus{}, Branches: []string{}, RecentCommits: []CommitInfo{}}, nil
	}

	branchOut, _, _ := runGit(ctx, root, "rev-parse", "--abbrev-ref", "HEAD")
	branch := strings.TrimSpace(string(branchOut))

	branchesOut, _, _ := runGit(ctx, root, "branch", "--format=%(refname:short)")
	var branches []string
	for _, line := range strings.Split(strings.TrimSpace(string(branchesOut)), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			branches = append(branches, line)
		}
	}

	statusOut, _, err := runGit(ctx, root, "status", "--porcelain=v1", "-z", "-uall")
	var files []FileStatus
	if err == nil {
		files = parsePorcelainZ(statusOut)
	}

	commitsOut, _, err := runGit(ctx, root, "log", "-n", "20", "--format=%H\x1f%h\x1f%s\x1f%an\x1f%ar")
	var commits []CommitInfo
	if err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(commitsOut)), "\n") {
			if line == "" {
				continue
			}
			parts := strings.Split(line, "\x1f")
			if len(parts) >= 5 {
				commits = append(commits, CommitInfo{
					Hash:         parts[0],
					ShortHash:    parts[1],
					Subject:      parts[2],
					Author:       parts[3],
					RelativeTime: parts[4],
				})
			}
		}
	}

	return &RepoStatus{
		IsRepo:        true,
		Branch:        branch,
		Branches:      branches,
		Files:         files,
		RecentCommits: commits,
	}, nil
}

func parsePorcelainZ(data []byte) []FileStatus {
	parts := bytes.Split(data, []byte{0})
	out := make([]FileStatus, 0)
	for i := 0; i < len(parts); i++ {
		rec := string(parts[i])
		if len(rec) < 4 {
			continue
		}
		x := string(rec[0])
		y := string(rec[1])
		p := rec[3:]
		oldPath := ""
		if (x == "R" || x == "C" || y == "R" || y == "C") && i+1 < len(parts) {
			oldPath = string(parts[i+1])
			i++
		}
		untracked := x == "?" && y == "?"
		staged := !untracked && x != " " && x != "?"
		unstaged := !untracked && y != " " && y != "?"
		out = append(out, FileStatus{
			Path:      p,
			OldPath:   oldPath,
			Index:     strings.TrimSpace(x),
			Worktree:  strings.TrimSpace(y),
			Staged:    staged,
			Unstaged:  unstaged,
			Untracked: untracked,
		})
	}
	return out
}

func ListChangedFiles(ctx context.Context, root, mode, target string) ([]ChangedFile, error) {
	switch mode {
	case "branch":
		if target == "" {
			target = "main"
		}
		out, msg, err := runGit(ctx, root, "diff", "--name-status", target+"...HEAD")
		if err != nil {
			return nil, fmt.Errorf("git diff branch: %s (%w)", msg, err)
		}
		return parseNameStatus(string(out)), nil
	case "commit":
		if target == "" {
			return nil, errors.New("commit hash required")
		}
		out, msg, err := runGit(ctx, root, "diff-tree", "--no-commit-id", "--name-status", "-r", "--root", target)
		if err != nil {
			return nil, fmt.Errorf("git diff-tree: %s (%w)", msg, err)
		}
		return parseNameStatus(string(out)), nil
	default:
		st, err := GetStatus(ctx, root)
		if err != nil {
			return nil, err
		}
		res := make([]ChangedFile, 0, len(st.Files))
		for _, f := range st.Files {
			if mode == "staged" && !f.Staged {
				continue
			}
			if mode == "unstaged" && !f.Unstaged && !f.Untracked {
				continue
			}
			status := f.Worktree
			if status == "" {
				status = f.Index
			}
			if f.Untracked {
				status = "?"
			}
			res = append(res, ChangedFile{Path: f.Path, Status: status})
		}
		return res, nil
	}
}

func parseNameStatus(out string) []ChangedFile {
	var res []ChangedFile
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) >= 2 {
			st := fields[0]
			if len(st) > 1 {
				st = st[:1]
			}
			p := fields[len(fields)-1]
			res = append(res, ChangedFile{Path: p, Status: st})
		}
	}
	return res
}

func GetFileDiff(ctx context.Context, root, mode, target, relPath string) (*FileDiff, error) {
	if _, err := workspace.ResolveSafePath(root, relPath); err != nil {
		return nil, err
	}
	cleanRel := filepath.ToSlash(filepath.Clean(relPath))

	var origBytes, modBytes, patchBytes []byte
	var err error

	switch mode {
	case "staged":
		origBytes, _, _ = runGit(ctx, root, "show", "HEAD:"+cleanRel)
		modBytes, _, _ = runGit(ctx, root, "show", ":0:"+cleanRel)
		patchBytes, _, err = runGit(ctx, root, "diff", "--cached", "--no-ext-diff", "--", cleanRel)
	case "unstaged":
		origBytes, _, err = runGit(ctx, root, "show", ":0:"+cleanRel)
		if err != nil {
			origBytes, _, _ = runGit(ctx, root, "show", "HEAD:"+cleanRel)
		}
		modBytes, _ = os.ReadFile(filepath.Join(root, filepath.FromSlash(cleanRel)))
		patchBytes, _, err = runGit(ctx, root, "diff", "--no-ext-diff", "--", cleanRel)
		if len(patchBytes) == 0 && len(origBytes) == 0 && len(modBytes) > 0 {
			patchBytes = synthesizeNewFilePatch(cleanRel, string(modBytes))
		}
	case "branch":
		if target == "" {
			target = "main"
		}
		baseOut, _, bErr := runGit(ctx, root, "merge-base", target, "HEAD")
		baseRef := target
		if bErr == nil && strings.TrimSpace(string(baseOut)) != "" {
			baseRef = strings.TrimSpace(string(baseOut))
		}
		origBytes, _, _ = runGit(ctx, root, "show", baseRef+":"+cleanRel)
		modBytes, _, _ = runGit(ctx, root, "show", "HEAD:"+cleanRel)
		patchBytes, _, err = runGit(ctx, root, "diff", "--no-ext-diff", target+"...HEAD", "--", cleanRel)
	case "commit":
		if target == "" {
			return nil, errors.New("commit hash required")
		}
		origBytes, _, _ = runGit(ctx, root, "show", target+"^:"+cleanRel)
		modBytes, _, _ = runGit(ctx, root, "show", target+":"+cleanRel)
		patchBytes, _, err = runGit(ctx, root, "diff-tree", "-p", "--root", "--no-ext-diff", target, "--", cleanRel)
	default: // "working"
		mode = "working"
		origBytes, _, _ = runGit(ctx, root, "show", "HEAD:"+cleanRel)
		modBytes, _ = os.ReadFile(filepath.Join(root, filepath.FromSlash(cleanRel)))
		patchBytes, _, err = runGit(ctx, root, "diff", "HEAD", "--no-ext-diff", "--", cleanRel)
		if err != nil || (len(patchBytes) == 0 && len(origBytes) == 0 && len(modBytes) > 0) {
			// Handles repo with no commits yet or untracked file
			patchBytes = synthesizeNewFilePatch(cleanRel, string(modBytes))
			err = nil
		}
	}

	isBinary := isBinarySample(origBytes) || isBinarySample(modBytes)
	origStr, modStr := "", ""
	if !isBinary {
		origStr = string(origBytes)
		modStr = string(modBytes)
	}
	patchStr := string(patchBytes)

	return &FileDiff{
		Path:            cleanRel,
		Mode:            mode,
		Target:          target,
		OriginalContent: origStr,
		ModifiedContent: modStr,
		UnifiedDiff:     patchStr,
		Hunks:           parseHunks(patchStr),
		IsBinary:        isBinary,
	}, nil
}

func isBinarySample(b []byte) bool {
	if len(b) > 8192 {
		b = b[:8192]
	}
	return bytes.IndexByte(b, 0) >= 0
}

func synthesizeNewFilePatch(path, content string) []byte {
	lines := strings.Split(content, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "diff --git a/%s b/%s\n", path, path)
	sb.WriteString("new file mode 100644\n")
	sb.WriteString("--- /dev/null\n")
	fmt.Fprintf(&sb, "+++ b/%s\n", path)
	fmt.Fprintf(&sb, "@@ -0,0 +1,%d @@\n", len(lines))
	for _, l := range lines {
		sb.WriteByte('+')
		sb.WriteString(l)
		sb.WriteByte('\n')
	}
	return []byte(sb.String())
}

func parseHunks(patch string) []DiffHunk {
	if patch == "" {
		return []DiffHunk{}
	}
	lines := strings.Split(patch, "\n")
	var fileHeader []string
	var hunks []DiffHunk
	var current *DiffHunk

	flush := func() {
		if current == nil {
			return
		}
		var sb strings.Builder
		for _, h := range fileHeader {
			sb.WriteString(h)
			sb.WriteByte('\n')
		}
		sb.WriteString(current.Header)
		sb.WriteByte('\n')
		for _, l := range current.Lines {
			sb.WriteString(l)
			sb.WriteByte('\n')
		}
		current.Patch = sb.String()
		hunks = append(hunks, *current)
		current = nil
	}

	for _, line := range lines {
		if strings.HasPrefix(line, "@@ ") {
			flush()
			oldStart, oldLines, newStart, newLines := parseHunkRange(line)
			current = &DiffHunk{
				ID:       fmt.Sprintf("h%d", len(hunks)+1),
				Header:   line,
				OldStart: oldStart,
				OldLines: oldLines,
				NewStart: newStart,
				NewLines: newLines,
				Lines:    []string{},
			}
			continue
		}
		if current == nil {
			if strings.HasPrefix(line, "diff --git") ||
				strings.HasPrefix(line, "--- ") ||
				strings.HasPrefix(line, "+++ ") ||
				strings.HasPrefix(line, "index ") ||
				strings.HasPrefix(line, "new file") ||
				strings.HasPrefix(line, "deleted file") {
				fileHeader = append(fileHeader, line)
			}
			continue
		}
		if line == "" && len(current.Lines) > 0 {
			continue
		}
		current.Lines = append(current.Lines, line)
	}
	flush()
	return hunks
}

func parseHunkRange(header string) (int, int, int, int) {
	// Format: @@ -a,b +c,d @@ optional context
	parts := strings.Split(header, " ")
	if len(parts) < 3 {
		return 0, 0, 0, 0
	}
	parsePair := func(s string) (int, int) {
		s = strings.TrimLeft(s, "-+")
		if idx := strings.IndexByte(s, ','); idx >= 0 {
			a, _ := strconv.Atoi(s[:idx])
			b, _ := strconv.Atoi(s[idx+1:])
			return a, b
		}
		a, _ := strconv.Atoi(s)
		return a, 1
	}
	os, ol := parsePair(parts[1])
	ns, nl := parsePair(parts[2])
	return os, ol, ns, nl
}

func StageFile(ctx context.Context, root, relPath string) error {
	if _, err := workspace.ResolveSafePath(root, relPath); err != nil {
		return err
	}
	_, msg, err := runGit(ctx, root, "add", "--", relPath)
	if err != nil {
		return fmt.Errorf("git add: %s (%w)", msg, err)
	}
	return nil
}

func UnstageFile(ctx context.Context, root, relPath string) error {
	if _, err := workspace.ResolveSafePath(root, relPath); err != nil {
		return err
	}
	_, msg, err := runGit(ctx, root, "reset", "HEAD", "--", relPath)
	if err != nil {
		return fmt.Errorf("git reset: %s (%w)", msg, err)
	}
	return nil
}

func DiscardFile(ctx context.Context, root, relPath string) error {
	safeAbs, err := workspace.ResolveSafePath(root, relPath)
	if err != nil {
		return err
	}
	// Check if file is untracked
	out, _, _ := runGit(ctx, root, "ls-files", "--error-unmatch", "--", relPath)
	if len(out) == 0 {
		if err := os.Remove(safeAbs); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	_, msg, err := runGit(ctx, root, "checkout", "HEAD", "--", relPath)
	if err != nil {
		// Fallback for unstaged-only if HEAD doesn't exist
		_, msg2, err2 := runGit(ctx, root, "checkout", "--", relPath)
		if err2 != nil {
			return fmt.Errorf("git discard: %s / %s (%w)", msg, msg2, err2)
		}
	}
	return nil
}

func ApplyHunk(ctx context.Context, root, patch string, action string) error {
	if strings.TrimSpace(patch) == "" {
		return errors.New("empty patch")
	}
	switch action {
	case "stage":
		return runGitStdin(ctx, root, patch, "apply", "--cached", "--whitespace=nowarn")
	case "unstage":
		return runGitStdin(ctx, root, patch, "apply", "--cached", "--reverse", "--whitespace=nowarn")
	case "discard":
		return runGitStdin(ctx, root, patch, "apply", "--reverse", "--whitespace=nowarn")
	default:
		return fmt.Errorf("unknown hunk action: %s", action)
	}
}
