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
