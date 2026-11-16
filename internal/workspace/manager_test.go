package workspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/lucacicii/herdr-code/internal/hc"
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

func TestPinnedWorkspaceKeepsTerminalInCreationWorkspace(t *testing.T) {
	dir := t.TempDir()
	mgr := NewManager(nil, filepath.Join(t.TempDir(), "workspaces.json"))
	ws, err := mgr.Add(context.Background(), dir, false)
	if err != nil {
		t.Fatalf("Add workspace failed: %v", err)
	}
	wsMap := map[string]*Workspace{ws.Path: {ID: ws.ID, Path: ws.Path}}

	// A terminal created in the workspace keeps it after its program changes directory.
	moved := hc.Terminal{Cwd: t.TempDir(), Labels: map[string]string{WorkspaceLabel: ws.Path}}
	if got := pinnedWorkspace(wsMap, moved); got == nil || got.ID != ws.ID {
		t.Fatalf("expected terminal pinned to %s, got %+v", ws.ID, got)
	}

	if got := pinnedWorkspace(wsMap, hc.Terminal{Cwd: ws.Path}); got != nil {
		t.Fatalf("expected no pin without a workspace label, got %+v", got)
	}
	if got := pinnedWorkspace(wsMap, hc.Terminal{Labels: map[string]string{WorkspaceLabel: "/nonexistent/path"}}); got != nil {
		t.Fatalf("expected no pin for an unknown workspace path, got %+v", got)
	}

	if got := mgr.WorkspacePathForCwd(context.Background(), dir); got != ws.Path {
		t.Fatalf("expected WorkspacePathForCwd(%s) = %s, got %s", dir, ws.Path, got)
	}
}
