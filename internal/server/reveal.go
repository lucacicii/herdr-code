package server

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
)

// revealInOS hands a path to the desktop: Finder shows the file inside its folder,
// everything else opens the containing directory.
func revealInOS(path string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", "-R", path).Run()
	case "linux":
		return exec.Command("xdg-open", filepath.Dir(path)).Run()
	default:
		return fmt.Errorf("reveal is not supported on %s", runtime.GOOS)
	}
}

// openInOS hands a directory itself to the desktop's default handler, so Finder
// shows the folder's contents instead of selecting it in its parent.
func openInOS(path string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", path).Run()
	case "linux":
		return exec.Command("xdg-open", path).Run()
	default:
		return fmt.Errorf("open is not supported on %s", runtime.GOOS)
	}
}
