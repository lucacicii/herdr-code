package fs

import (
	"io/fs"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type ChangeCallback func(workspaceID, root string, relPaths []string)

type Watcher struct {
	mu          sync.Mutex
	watcher     *fsnotify.Watcher
	workspaceID string
	root        string
	onChange    ChangeCallback
	stopCh      chan struct{}
}

func NewWatcher(onChange ChangeCallback) *Watcher {
	return &Watcher{
		onChange: onChange,
	}
}

func (w *Watcher) Watch(workspaceID, root string) error {
	w.mu.Lock()
	if w.workspaceID == workspaceID && w.root == root && w.watcher != nil {
		w.mu.Unlock()
		return nil
	}
	w.stopLocked()

	fw, err := fsnotify.NewWatcher()
	if err != nil {
		w.mu.Unlock()
		return err
	}

	count := 0
	const maxWatchDirs = 500
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return nil
		}
		name := d.Name()
		if path != root && (skippedDirs[name] || strings.HasPrefix(name, ".")) {
			return filepath.SkipDir
		}
		if count >= maxWatchDirs {
			return filepath.SkipDir
		}
		if err := fw.Add(path); err == nil {
			count++
		}
		return nil
	})

	stopCh := make(chan struct{})
	w.watcher = fw
	w.workspaceID = workspaceID
	w.root = root
	w.stopCh = stopCh
	w.mu.Unlock()

	go w.loop(fw, workspaceID, root, stopCh)
	return nil
}

func (w *Watcher) loop(fw *fsnotify.Watcher, wsID, root string, stopCh chan struct{}) {
	pending := make(map[string]struct{})
	timer := time.NewTimer(time.Hour)
	if !timer.Stop() {
		select {
		case <-timer.C:
		default:
		}
	}
	defer timer.Stop()

	flush := func() {
		if len(pending) == 0 {
			return
		}
		paths := make([]string, 0, len(pending))
		for p := range pending {
			paths = append(paths, p)
		}
		pending = make(map[string]struct{})
		if w.onChange != nil {
			w.onChange(wsID, root, paths)
		}
	}

	for {
		select {
		case <-stopCh:
			return
		case ev, ok := <-fw.Events:
			if !ok {
				return
			}
			rel, err := filepath.Rel(root, ev.Name)
			if err != nil {
				continue
			}
			rel = filepath.ToSlash(rel)
			if strings.HasPrefix(rel, ".git/") || rel == ".git" {
				continue
			}
			pending[rel] = struct{}{}
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(180 * time.Millisecond)
		case <-timer.C:
			flush()
		case _, ok := <-fw.Errors:
			if !ok {
				return
			}
		}
	}
}

func (w *Watcher) stopLocked() {
	if w.stopCh != nil {
		close(w.stopCh)
		w.stopCh = nil
	}
	if w.watcher != nil {
		_ = w.watcher.Close()
		w.watcher = nil
	}
	w.workspaceID = ""
	w.root = ""
}

func (w *Watcher) Close() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.stopLocked()
}
