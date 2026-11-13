package fs

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/lucacicii/herdr-code/internal/workspace"
)

const MaxReadFileBytes = 2 * 1024 * 1024

var skippedDirs = map[string]bool{
	".git":         true,
	"node_modules": true,
	"dist":         true,
	"build":        true,
	"target":       true,
	".next":        true,
	".venv":        true,
	"__pycache__":  true,
}

type TreeEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"is_dir"`
	Size  int64  `json:"size"`
}

type FileContent struct {
	Path      string `json:"path"`
	Content   string `json:"content"`
	Size      int64  `json:"size"`
	LineCount int    `json:"line_count"`
	IsBinary  bool   `json:"is_binary"`
	Truncated bool   `json:"truncated"`
	Language  string `json:"language"`
}

type SearchMatch struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	Dir   string `json:"dir"`
	Score int    `json:"score"`
}

func ListDir(root, relDir string, showHidden bool) ([]TreeEntry, error) {
	target, err := workspace.ResolveSafePath(root, relDir)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(target)
	if err != nil {
		return nil, err
	}

	out := make([]TreeEntry, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if name == ".git" {
			continue
		}
		if !showHidden && strings.HasPrefix(name, ".") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		rel := name
		if relDir != "" && relDir != "." {
			rel = filepath.ToSlash(filepath.Join(relDir, name))
		}
		out = append(out, TreeEntry{
			Name:  name,
			Path:  rel,
			IsDir: entry.IsDir(),
			Size:  info.Size(),
		})
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDir != out[j].IsDir {
			return out[i].IsDir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

func ReadFile(root, relPath string) (*FileContent, error) {
	if relPath == "" || relPath == "." {
		return nil, errors.New("file path required")
	}
	target, err := workspace.ResolveSafePath(root, relPath)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(target)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, errors.New("target is a directory")
	}

	f, err := os.Open(target)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	buf := make([]byte, minInt64(info.Size(), MaxReadFileBytes+1))
	n, err := f.Read(buf)
	if err != nil && n == 0 {
		return nil, err
	}
	data := buf[:n]
	truncated := int64(n) > MaxReadFileBytes
	if truncated {
		data = data[:MaxReadFileBytes]
	}

	sample := data
	if len(sample) > 8192 {
		sample = sample[:8192]
	}
	isBinary := bytes.IndexByte(sample, 0) >= 0

	content := ""
	lineCount := 0
	if !isBinary {
		content = string(data)
		if content != "" {
			lineCount = strings.Count(content, "\n") + 1
		}
	}

	cleanRel := filepath.ToSlash(filepath.Clean(relPath))
	return &FileContent{
		Path:      cleanRel,
		Content:   content,
		Size:      info.Size(),
		LineCount: lineCount,
		IsBinary:  isBinary,
		Truncated: truncated,
		Language:  detectLanguage(cleanRel),
	}, nil
}

func SearchFiles(ctx context.Context, root, query string, limit int) ([]SearchMatch, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	files, err := listAllRepoFiles(ctx, root, 25000)
	if err != nil {
		return nil, err
	}

	q := strings.TrimSpace(strings.ToLower(query))
	matches := make([]SearchMatch, 0, limit)
	for _, p := range files {
		if q == "" {
			matches = append(matches, SearchMatch{
				Path:  p,
				Name:  filepath.Base(p),
				Dir:   dirOrEmpty(p),
				Score: 1,
			})
			if len(matches) >= limit {
				break
			}
			continue
		}
		score := fuzzyScore(strings.ToLower(p), strings.ToLower(filepath.Base(p)), q)
		if score > 0 {
			matches = append(matches, SearchMatch{
				Path:  p,
				Name:  filepath.Base(p),
				Dir:   dirOrEmpty(p),
				Score: score,
			})
		}
	}

	if q != "" {
		sort.Slice(matches, func(i, j int) bool {
			if matches[i].Score != matches[j].Score {
				return matches[i].Score > matches[j].Score
			}
			if len(matches[i].Path) != len(matches[j].Path) {
				return len(matches[i].Path) < len(matches[j].Path)
			}
			return matches[i].Path < matches[j].Path
		})
		if len(matches) > limit {
			matches = matches[:limit]
		}
	}
	return matches, nil
}

func listAllRepoFiles(ctx context.Context, root string, maxFiles int) ([]string, error) {
	cctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, "git", "-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
	if out, err := cmd.Output(); err == nil {
		parts := bytes.Split(out, []byte{0})
		files := make([]string, 0, minInt(len(parts), maxFiles))
		for _, part := range parts {
			if len(part) == 0 {
				continue
			}
			files = append(files, string(part))
			if len(files) >= maxFiles {
				break
			}
		}
		return files, nil
	}

	files := make([]string, 0, 512)
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		name := d.Name()
		if d.IsDir() {
			if skippedDirs[name] {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		files = append(files, filepath.ToSlash(rel))
		if len(files) >= maxFiles {
			return errors.New("limit")
		}
		return nil
	})
	if err != nil && err.Error() != "limit" {
		return nil, err
	}
	return files, nil
}

func fuzzyScore(fullPath, baseName, query string) int {
	if baseName == query {
		return 1000
	}
	if strings.HasPrefix(baseName, query) {
		return 800 - len(baseName)
	}
	if strings.Contains(baseName, query) {
		return 600 - len(baseName)
	}
	if strings.Contains(fullPath, query) {
		return 400 - len(fullPath)
	}
	// Subsequence match on fullPath
	qi := 0
	lastIdx := -1
	bonus := 0
	for i := 0; i < len(fullPath) && qi < len(query); i++ {
		if fullPath[i] == query[qi] {
			if lastIdx+1 == i {
				bonus += 4
			}
			if i == 0 || fullPath[i-1] == '/' || fullPath[i-1] == '_' || fullPath[i-1] == '-' || fullPath[i-1] == '.' {
				bonus += 6
			}
			lastIdx = i
			qi++
		}
	}
	if qi < len(query) {
		return 0
	}
	return 100 + bonus - len(fullPath)/4
}

func dirOrEmpty(p string) string {
	d := filepath.ToSlash(filepath.Dir(p))
	if d == "." {
		return ""
	}
	return d
}

func detectLanguage(p string) string {
	ext := strings.ToLower(filepath.Ext(p))
	switch ext {
	case ".ts", ".mts", ".cts":
		return "typescript"
	case ".tsx":
		return "tsx"
	case ".js", ".mjs", ".cjs":
		return "javascript"
	case ".jsx":
		return "jsx"
	case ".go":
		return "go"
	case ".py":
		return "python"
	case ".rs":
		return "rust"
	case ".json":
		return "json"
	case ".md", ".markdown":
		return "markdown"
	case ".css", ".scss":
		return "css"
	case ".html", ".htm":
		return "html"
	case ".yaml", ".yml":
		return "yaml"
	default:
		return "text"
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
