package herdrweb

import (
	"embed"
	"io/fs"
)

//go:embed all:web/dist
var distFS embed.FS

func StaticFS() fs.FS {
	sub, err := fs.Sub(distFS, "web/dist")
	if err != nil {
		return nil
	}
	return sub
}
