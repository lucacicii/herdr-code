package fs

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestListReadAndSearch(t *testing.T) {
	dir := t.TempDir()
	_ = os.MkdirAll(filepath.Join(dir, "internal", "hc"), 0o755)
	_ = os.WriteFile(filepath.Join(dir, "internal", "hc", "client.go"), []byte("package hc\n// hello\n"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "README.md"), []byte("# Hi\n"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "bin.dat"), []byte{0x00, 0x01, 0x02}, 0o644)

	entries, err := ListDir(dir, "", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 || !entries[0].IsDir || entries[0].Name != "internal" {
		t.Fatalf("unexpected root entries: %+v", entries)
	}

	fc, err := ReadFile(dir, "internal/hc/client.go")
	if err != nil {
		t.Fatal(err)
	}
	if fc.IsBinary || fc.Language != "go" || fc.LineCount != 3 {
		t.Fatalf("unexpected file meta: %+v", fc)
	}

	bin, err := ReadFile(dir, "bin.dat")
	if err != nil || !bin.IsBinary {
		t.Fatalf("expected binary file detection, got %+v err=%v", bin, err)
	}

	matches, err := SearchFiles(context.Background(), dir, "client", 10)
	if err != nil || len(matches) == 0 || matches[0].Path != "internal/hc/client.go" {
		t.Fatalf("unexpected search matches: %+v err=%v", matches, err)
	}
}
