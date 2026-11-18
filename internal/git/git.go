package git

import (
	"bytes"
	"context"
	"os/exec"
	"strings"
	"time"
)

type FileStatus struct {
	Path      string `json:"path"`
	OldPath   string `json:"old_path,omitempty"`
	Index     string `json:"index"`    // M, A, D, R, ?
	Worktree  string `json:"worktree"` // M, A, D, R, ?
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
