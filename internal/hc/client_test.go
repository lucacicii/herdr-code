package hc

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestLiveHCIntegration(t *testing.T) {
	sock := DefaultSocketPath()
	if _, err := os.Stat(sock); err != nil {
		t.Skipf("hc socket not available at %s: %v", sock, err)
	}

	c := NewClient(sock)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	status, err := c.ServerStatus(ctx)
	if err != nil {
		t.Fatalf("ServerStatus failed: %v", err)
	}
	if status.Version == "" {
		t.Fatalf("expected non-empty hc version")
	}

	list, err := c.ListTerminals(ctx, false)
	if err != nil {
		t.Fatalf("ListTerminals failed: %v", err)
	}
	t.Logf("hc %s (%s): %d live terminals", status.Version, status.Core.Name, len(list.Terminals))

	if len(list.Terminals) > 0 {
		stream, err := c.Attach(ctx, AttachParams{
			Terminal:            list.Terminals[0].Address,
			Cols:                80,
			Rows:                24,
			History:             5,
			Observe:             true,
			ResizeNotifications: true,
		})
		if err != nil {
			t.Fatalf("Attach observe failed: %v", err)
		}
		defer stream.Close()

		f, err := stream.ReadFrame()
		if err != nil {
			t.Fatalf("ReadFrame failed: %v", err)
		}
		t.Logf("received initial attach frame ch=%d kind=%d len=%d", f.Channel, f.Kind, len(f.Payload))
	}
}
