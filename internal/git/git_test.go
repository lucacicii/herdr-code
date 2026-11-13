package git

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func runCmd(t *testing.T, dir string, name string, args ...string) {
	t.Helper()
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%s %v failed: %v\n%s", name, args, err, string(out))
	}
}

func TestGitStatusDiffAndHunk(t *testing.T) {
	dir := t.TempDir()
	runCmd(t, dir, "git", "init")
	runCmd(t, dir, "git", "config", "user.email", "test@example.com")
	runCmd(t, dir, "git", "config", "user.name", "Test")

	p := filepath.Join(dir, "app.txt")
	if err := os.WriteFile(p, []byte("line1\nline2\nline3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runCmd(t, dir, "git", "add", "app.txt")
	runCmd(t, dir, "git", "commit", "-m", "init")

	if err := os.WriteFile(p, []byte("line1\nline2-edited\nline3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "new.txt"), []byte("brand new\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	st, err := GetStatus(ctx, dir)
	if err != nil || !st.IsRepo || len(st.Files) != 2 {
		t.Fatalf("unexpected git status: %+v err=%v", st, err)
	}

	diff, err := GetFileDiff(ctx, dir, "working", "", "app.txt")
	if err != nil || len(diff.Hunks) != 1 {
		t.Fatalf("expected 1 hunk, got %+v err=%v", diff, err)
	}
	if diff.OriginalContent == diff.ModifiedContent {
		t.Fatalf("expected different original and modified content")
	}

	if err := ApplyHunk(ctx, dir, diff.Hunks[0].Patch, "stage"); err != nil {
		t.Fatalf("ApplyHunk stage failed: %v", err)
	}
	st2, err := GetStatus(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	var stagedFound bool
	for _, f := range st2.Files {
		if f.Path == "app.txt" && f.Staged && !f.Unstaged {
			stagedFound = true
		}
	}
	if !stagedFound {
		t.Fatalf("expected app.txt to be staged cleanly: %+v", st2.Files)
	}
}
