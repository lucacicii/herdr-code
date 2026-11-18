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

func TestGitStatus(t *testing.T) {
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

	st, err := GetStatus(context.Background(), dir)
	if err != nil || !st.IsRepo || len(st.Files) != 2 {
		t.Fatalf("unexpected git status: %+v err=%v", st, err)
	}
	for _, f := range st.Files {
		switch f.Path {
		case "app.txt":
			if !f.Unstaged || f.Staged {
				t.Fatalf("expected app.txt unstaged: %+v", f)
			}
		case "new.txt":
			if !f.Untracked {
				t.Fatalf("expected new.txt untracked: %+v", f)
			}
		default:
			t.Fatalf("unexpected file: %+v", f)
		}
	}
}
