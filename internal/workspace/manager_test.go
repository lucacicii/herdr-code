package workspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveSafePathAndPersist(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "src")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	f := filepath.Join(sub, "main.go")
	if err := os.WriteFile(f, []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := ResolveSafePath(dir, "src/main.go")
	if err != nil {
		t.Fatalf("ResolveSafePath valid failed: %v", err)
	}
	if filepath.Base(got) != "main.go" {
		t.Fatalf("unexpected resolved path: %s", got)
	}

	if _, err := ResolveSafePath(dir, "../etc/passwd"); err == nil {
		t.Fatalf("expected traversal error")
	}

	cfg := filepath.Join(t.TempDir(), "workspaces.json")
	mgr := NewManager(nil, cfg)
	ws, err := mgr.Add(context.Background(), dir, true)
	if err != nil {
		t.Fatalf("Add workspace failed: %v", err)
	}
	if !ws.Pinned {
		t.Fatalf("expected pinned workspace")
	}

	mgr2 := NewManager(nil, cfg)
	list, err := mgr2.List(context.Background())
	if err != nil || len(list) != 1 {
		t.Fatalf("expected 1 persisted workspace, got %d (err=%v)", len(list), err)
	}
}
