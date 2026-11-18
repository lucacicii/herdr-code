package workspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/lucacicii/herdr-code/internal/happ"
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
	list, err := mgr2.List(context.Background(), ListOptions{})
	if err != nil || len(list) != 1 {
		t.Fatalf("expected 1 persisted workspace, got %d (err=%v)", len(list), err)
	}
}

func TestHerdrSpaceRowGroupsTerminalsByLabel(t *testing.T) {
	dir := t.TempDir()
	mgr := NewManager(nil, filepath.Join(t.TempDir(), "workspaces.json"))
	wsMap := map[string]*Workspace{}

	labelled := hc.Terminal{
		Address:   "t1",
		Cwd:       dir,
		CreatedMs: 10,
		Labels: map[string]string{
			HerdrSpaceLabel: "sp123",
			HerdrTabLabel:   "tb1",
			"where":         "herdr-code / 1",
		},
	}
	ws := mgr.spaceWorkspace(context.Background(), wsMap, map[string]*Workspace{}, labelled, nil, nil)
	if ws == nil {
		t.Fatalf("expected a space row for a labelled terminal")
	}
	if ws.SpaceID != "sp123" || ws.ID != workspaceIDForPath("herdr-space:sp123") {
		t.Fatalf("unexpected space row identity: id=%s space=%s", ws.ID, ws.SpaceID)
	}
	// No doc name available: fall back to the cached "name / tab" label, not the id.
	if ws.Name != "herdr-code" {
		t.Fatalf("expected name from where label, got %q", ws.Name)
	}
	if ws.Path == "" {
		t.Fatalf("expected space row to anchor to a directory, got empty path")
	}

	// Doc names win, and every terminal of the space lands in the same row.
	second := hc.Terminal{Address: "t2", Cwd: dir, Labels: map[string]string{HerdrSpaceLabel: "sp123"}}
	if got := mgr.spaceWorkspace(context.Background(), wsMap, map[string]*Workspace{}, second, map[string]string{"sp123": "TMS"}, nil); got != ws {
		t.Fatalf("expected the same row for the same space, got %+v", got)
	}
	if ws.Name != "herdr-code" {
		t.Fatalf("existing row name should not be rewritten by a later doc name, got %q", ws.Name)
	}

	// Terminals no space claims keep using directory grouping.
	if got := mgr.spaceWorkspace(context.Background(), wsMap, map[string]*Workspace{}, hc.Terminal{Address: "t3", Cwd: dir}, nil, nil); got != nil {
		t.Fatalf("expected no space row without herdr.space label, got %+v", got)
	}
}

func TestHerdrSpaceRowMergesWithPinnedDirectory(t *testing.T) {
	dir := t.TempDir()
	canon, err := canonicalDir(dir)
	if err != nil {
		t.Fatalf("canonicalDir: %v", err)
	}
	mgr := NewManager(nil, filepath.Join(t.TempDir(), "workspaces.json"))
	pinned := &Workspace{ID: "pinned1", Name: "tms", Path: canon}
	wsMap := map[string]*Workspace{canon: pinned}
	byPath := map[string]*Workspace{canon: pinned}

	got := mgr.spaceWorkspace(context.Background(), wsMap, byPath, hc.Terminal{
		Address: "t1",
		Cwd:     canon,
		Labels:  map[string]string{HerdrSpaceLabel: "sp9", "where": "tms / Pi"},
	}, nil, nil)
	if got != pinned || pinned.SpaceID != "sp9" {
		t.Fatalf("expected the pinned row to carry the space, got %+v", got)
	}
	if len(wsMap) != 1 {
		t.Fatalf("expected one row for the directory, got %d", len(wsMap))
	}

	// A second space in the same directory keeps its own row instead of stealing the first.
	other := mgr.spaceWorkspace(context.Background(), wsMap, byPath, hc.Terminal{
		Address: "t2",
		Cwd:     canon,
		Labels:  map[string]string{HerdrSpaceLabel: "sp10", "where": "other / 1"},
	}, nil, nil)
	if other == pinned || other.SpaceID != "sp10" {
		t.Fatalf("expected a separate row for a second space, got %+v", other)
	}
}

type fakeSpaces []happ.Space

func (f fakeSpaces) List(context.Context) ([]happ.Space, error) { return f, nil }

func TestListFollowsAppSpaceList(t *testing.T) {
	dir := t.TempDir()
	canon, err := canonicalDir(dir)
	if err != nil {
		t.Fatalf("canonicalDir: %v", err)
	}
	remote := "myserver"
	mgr := NewManager(nil, filepath.Join(t.TempDir(), "workspaces.json"))
	mgr.SetSpaceLister(fakeSpaces{
		{ID: "spA", Name: "alpha", Folder: dir},
		{ID: "spB", Name: "beta"},
		{ID: "spC", Name: "gamma", Folder: "/srv/app", Machine: &remote},
	})

	list, err := mgr.List(context.Background(), ListOptions{})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 3 {
		t.Fatalf("expected every app space, got %d", len(list))
	}
	if list[0].Name != "alpha" || list[0].Path != canon || list[0].SpaceID != "spA" {
		t.Fatalf("unexpected first row: %+v", list[0])
	}
	// A space with no terminals and no folder still gets a row, as in the app.
	if list[1].Name != "beta" || list[1].Path != "" || list[1].SpaceID != "spB" {
		t.Fatalf("unexpected empty-space row: %+v", list[1])
	}
	// Remote spaces are listed but cannot be opened from this machine.
	if list[2].Machine != remote || list[2].Path != "" || list[2].IsGitRepo {
		t.Fatalf("unexpected remote-space row: %+v", list[2])
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

func TestClosedSpaceKeepsItsRowForHistory(t *testing.T) {
	dir := t.TempDir()
	mgr := NewManager(nil, filepath.Join(t.TempDir(), "workspaces.json"))
	mgr.SetSpaceLister(fakeSpaces{{ID: "spA", Name: "proj", Folder: dir}})

	list, err := mgr.List(context.Background(), ListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Closed {
		t.Fatalf("expected one live space row, got %+v", list)
	}

	// The app closes the space: it is gone from the published list.
	mgr.SetSpaceLister(fakeSpaces{})
	list, err = mgr.List(context.Background(), ListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("expected no rows without history, got %+v", list)
	}

	list, err = mgr.List(context.Background(), ListOptions{IncludeFinished: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || !list[0].Closed || list[0].SpaceID != "spA" {
		t.Fatalf("expected the closed space back for history, got %+v", list)
	}
	if list[0].Path != dir || list[0].Name != "proj" {
		t.Fatalf("closed row lost its identity: %+v", list[0])
	}
}
