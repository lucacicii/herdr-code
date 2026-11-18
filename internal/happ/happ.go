// Package happ drives the Herdr desktop app through its own command line.
//
// Spaces are the app's document, not herdr-core's: a terminal belongs to a space
// only once the app records it, and the app is the only writer of that document.
// So a terminal started with `hc run` (alma, scripts, other agents) is invisible
// to the app until `terminal.keep` gives it a pane. These commands are the only
// supported way to do that — there is no space field in herdr-core.
package happ

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ErrUnavailable means the Herdr app CLI could not be found on this machine.
var ErrUnavailable = errors.New("Herdr app CLI not found (install Herdr or set HERDR_APP_BIN)")

// Client runs `herdr-app` commands.
type Client struct {
	path     string
	lookedAt bool
}

func New(path string) *Client { return &Client{path: strings.TrimSpace(path)} }

// Path resolves the CLI once: explicit path, HERDR_APP_BIN, PATH, then the macOS bundle.
func (c *Client) Path() string {
	if c.lookedAt {
		return c.path
	}
	c.lookedAt = true
	if c.path != "" {
		if resolved, err := exec.LookPath(c.path); err == nil {
			c.path = resolved
		}
		return c.path
	}
	if env := strings.TrimSpace(os.Getenv("HERDR_APP_BIN")); env != "" {
		if resolved, err := exec.LookPath(env); err == nil {
			c.path = resolved
			return c.path
		}
		c.path = env
		return c.path
	}
	candidates := []string{"herdr-app"}
	home, _ := os.UserHomeDir()
	if home != "" {
		candidates = append(candidates, filepath.Join(home, ".local", "bin", "herdr-app"))
	}
	candidates = append(candidates,
		"/Applications/Herdr.app/Contents/MacOS/Herdr",
		"/usr/local/bin/herdr-app",
	)
	for _, candidate := range candidates {
		if resolved, err := exec.LookPath(candidate); err == nil {
			c.path = resolved
			return c.path
		}
	}
	c.path = ""
	return c.path
}

func (c *Client) Available() bool { return c.Path() != "" }

func (c *Client) run(ctx context.Context, args ...string) ([]byte, error) {
	bin := c.Path()
	if bin == "" {
		return nil, ErrUnavailable
	}
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, bin, args...)
	var out, errOut bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errOut
	if err := cmd.Run(); err != nil {
		detail := strings.TrimSpace(out.String() + errOut.String())
		if detail != "" {
			return nil, fmt.Errorf("herdr-app %s: %w: %s", strings.Join(args, " "), err, detail)
		}
		return nil, fmt.Errorf("herdr-app %s: %w", strings.Join(args, " "), err)
	}
	return out.Bytes(), nil
}

// Do runs one app command, e.g. Do(ctx, "terminal.keep", map[string]string{"terminal": "t5"}).
func (c *Client) Do(ctx context.Context, command string, args map[string]string) (map[string]any, error) {
	argv := []string{"do", command}
	keys := make([]string, 0, len(args))
	for k := range args {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		argv = append(argv, "--"+k, args[k])
	}
	out, err := c.run(ctx, argv...)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(out, &result); err != nil {
		return nil, fmt.Errorf("herdr-app %s: unexpected output %q", command, strings.TrimSpace(string(out)))
	}
	if message, ok := result["error"].(string); ok && message != "" {
		return nil, errors.New(message)
	}
	return result, nil
}

// Rename renames a space. An empty name asks the app to name it after where its
// first terminal is again, which is how a space gets back to a derived name.
//
// The name is only a label: it never changes the space's folder or the directory
// its tabs run in, so the two can legitimately disagree.
func (c *Client) Rename(ctx context.Context, spaceID, name string) error {
	if spaceID == "" {
		return errors.New("space id is required")
	}
	_, err := c.Do(ctx, "space.rename", map[string]string{"id": spaceID, "name": name})
	return err
}

// Terminal is one terminal the app shows in a pane.
type Terminal struct {
	Terminal string `json:"terminal"`
}

// Tab is a tab of a space: one or more terminals, split right or down.
type Tab struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Active    bool       `json:"active"`
	Settled   bool       `json:"settled"`
	Terminals []Terminal `json:"terminals"`
}

// Space is a place to work in the app, on one machine.
type Space struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Folder  string  `json:"folder"`
	Machine *string `json:"machine"`
	Active  bool    `json:"active"`
	Tabs    []Tab   `json:"tabs"`
}

// List is `herdr-app ls`.
type List struct {
	Spaces []Space `json:"spaces"`
}

func (c *Client) List(ctx context.Context) (List, error) {
	out, err := c.run(ctx, "ls")
	if err != nil {
		return List{}, err
	}
	var list List
	if err := json.Unmarshal(out, &list); err != nil {
		return List{}, fmt.Errorf("herdr-app ls: unexpected output %q", strings.TrimSpace(string(out)))
	}
	return list, nil
}

// AdoptResult reports where the terminals went.
type AdoptResult struct {
	SpaceID string   `json:"space_id"`
	Adopted []string `json:"adopted"`
	Created bool     `json:"created"`
}

// Adopt puts terminals into a space the app shows: the space that already owns one
// of them, else a new space named after the workspace. Terminals already in that
// space are left alone, so calling this twice is safe.
func (c *Client) Adopt(ctx context.Context, name, folder string, terminals []string) (AdoptResult, error) {
	var result AdoptResult
	pending := make([]string, 0, len(terminals))
	if len(terminals) == 0 {
		return result, errors.New("no live terminals to show in Herdr")
	}

	ownedBy := map[string]string{}
	if list, err := c.List(ctx); err == nil {
		for _, space := range list.Spaces {
			for _, tab := range space.Tabs {
				for _, terminal := range tab.Terminals {
					ownedBy[terminal.Terminal] = space.ID
				}
			}
		}
	} else if !errors.Is(err, ErrUnavailable) {
		return result, err
	}
	for _, terminal := range terminals {
		if spaceID, ok := ownedBy[terminal]; ok {
			if result.SpaceID == "" {
				result.SpaceID = spaceID
			}
			if spaceID == result.SpaceID {
				continue
			}
		}
		pending = append(pending, terminal)
	}
	if result.SpaceID != "" && len(pending) == 0 {
		return result, nil
	}

	target := result.SpaceID
	shellTab := ""
	if target == "" {
		args := map[string]string{"focus": "false"}
		if name != "" {
			args["name"] = name
		}
		if folder != "" {
			args["folder"] = folder
		}
		created, err := c.Do(ctx, "space.new", args)
		if err != nil {
			return result, err
		}
		target, _ = created["space"].(string)
		shellTab, _ = created["tab"].(string)
		if target == "" {
			return result, errors.New("herdr-app made no space")
		}
		result.SpaceID = target
		result.Created = true
	} else {
		result.SpaceID = target
	}

	// terminal.keep places the terminal in the shown space, so show the target first.
	if _, err := c.Do(ctx, "space.select", map[string]string{"id": target}); err != nil {
		return result, err
	}
	for _, terminal := range pending {
		if err := c.keepOne(ctx, terminal); err != nil {
			return result, err
		}
		result.Adopted = append(result.Adopted, terminal)
	}
	// A kept terminal lands in the document a moment later; closing the placeholder
	// tab before then closes the space itself and discards the kept terminals.
	shown, err := c.waitForTerminals(ctx, target, result.Adopted)
	if err != nil {
		return result, err
	}
	if shellTab != "" && shown {
		if _, err := c.Do(ctx, "tab.close", map[string]string{"id": shellTab, "confirmed": "true"}); err != nil {
			return result, fmt.Errorf("close placeholder tab: %w", err)
		}
	}
	return result, nil
}

// Keep gives terminals a pane in an existing space. The app only keeps terminals in
// the space it shows, so this selects the space and puts the previous one back.
func (c *Client) Keep(ctx context.Context, spaceID string, terminals []string) error {
	if spaceID == "" || len(terminals) == 0 {
		return nil
	}
	previous := ""
	if list, err := c.List(ctx); err == nil {
		for _, space := range list.Spaces {
			if space.Active && space.ID != spaceID {
				previous = space.ID
			}
		}
	}
	if _, err := c.Do(ctx, "space.select", map[string]string{"id": spaceID}); err != nil {
		return err
	}
	kept := make([]string, 0, len(terminals))
	for _, terminal := range terminals {
		if err := c.keepOne(ctx, terminal); err != nil {
			return err
		}
		kept = append(kept, terminal)
	}
	if _, err := c.waitForTerminals(ctx, spaceID, kept); err != nil {
		return err
	}
	if previous != "" {
		if _, err := c.Do(ctx, "space.select", map[string]string{"id": previous}); err != nil {
			return err
		}
	}
	return nil
}

// keepOne gives one terminal a pane in the shown space. The app only keeps
// terminals it has already seen from herdr-core, so a terminal created a moment ago
// is rejected ("no running terminal") until its next snapshot — retry for a while.
func (c *Client) keepOne(ctx context.Context, terminal string) error {
	deadline := time.Now().Add(10 * time.Second)
	for {
		_, err := c.Do(ctx, "terminal.keep", map[string]string{"terminal": terminal, "place": "tab"})
		if err == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("show %s: %w", terminal, err)
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("show %s: %w", terminal, ctx.Err())
		case <-time.After(200 * time.Millisecond):
		}
	}
}

// waitForTerminals polls until the space lists every terminal, so callers never act
// on a space whose tabs are still pending.
func (c *Client) waitForTerminals(ctx context.Context, spaceID string, terminals []string) (bool, error) {
	deadline := time.Now().Add(3 * time.Second)
	for {
		list, err := c.List(ctx)
		if err != nil {
			return false, err
		}
		for _, space := range list.Spaces {
			if space.ID != spaceID {
				continue
			}
			found := map[string]bool{}
			for _, tab := range space.Tabs {
				for _, terminal := range tab.Terminals {
					found[terminal.Terminal] = true
				}
			}
			missing := false
			for _, terminal := range terminals {
				if !found[terminal] {
					missing = true
					break
				}
			}
			if !missing {
				return true, nil
			}
		}
		if time.Now().After(deadline) {
			return false, nil
		}
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}
