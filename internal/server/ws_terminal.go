package server

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/lucacicii/herdr-code/internal/hc"
)

const (
	wsTagData           byte = 0x00
	wsTagAutomaticInput byte = 0x01
)

type terminalControlMsg struct {
	Type      string `json:"type"`
	Cols      uint16 `json:"cols,omitempty"`
	Rows      uint16 `json:"rows,omitempty"`
	Focused   bool   `json:"focused,omitempty"`
	Text      string `json:"text,omitempty"`
	Bracketed bool   `json:"bracketed,omitempty"`
}

func parseUint16Query(r *http.Request, key string, fallback uint16) uint16 {
	v := r.URL.Query().Get(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 || n > 65535 {
		return fallback
	}
	return uint16(n)
}

func (s *Server) handleTerminalWS(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeRequest(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	terminalID := r.PathValue("id")
	if terminalID == "" {
		http.Error(w, "missing terminal id", http.StatusBadRequest)
		return
	}

	cols := parseUint16Query(r, "cols", 120)
	rows := parseUint16Query(r, "rows", 36)
	history := uint(parseUint16Query(r, "history", 1000))
	observe := r.URL.Query().Get("observe") == "1" || r.URL.Query().Get("observe") == "true"

	ws, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	stream, err := s.hc.Attach(r.Context(), hc.AttachParams{
		Terminal:            terminalID,
		Cols:                cols,
		Rows:                rows,
		History:             history,
		Observe:             observe,
		ResizeNotifications: true,
	})
	if err != nil {
		_ = ws.WriteJSON(map[string]any{
			"type":    "error",
			"message": err.Error(),
		})
		return
	}
	defer stream.Close()

	var wsWriteMu sync.Mutex
	writeText := func(v any) error {
		wsWriteMu.Lock()
		defer wsWriteMu.Unlock()
		_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return ws.WriteJSON(v)
	}
	writeBinary := func(tag byte, data []byte) error {
		buf := make([]byte, 1+len(data))
		buf[0] = tag
		copy(buf[1:], data)
		wsWriteMu.Lock()
		defer wsWriteMu.Unlock()
		_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return ws.WriteMessage(websocket.BinaryMessage, buf)
	}

	_ = writeText(map[string]any{
		"type":            "ready",
		"terminal":        stream.Meta.Terminal,
		"automatic_input": stream.Meta.AutomaticInput,
		// Authoritative PTY grid: the terminal is shared with every other attached
		// client, so the browser must render this size instead of guessing its own.
		"cols": stream.Meta.Terminal.Cols,
		"rows": stream.Meta.Terminal.Rows,
	})

	done := make(chan struct{})
	var closeOnce sync.Once
	finish := func() {
		closeOnce.Do(func() {
			close(done)
			_ = stream.Close()
		})
	}

	// hc -> WebSocket
	go func() {
		defer finish()
		for {
			f, err := stream.ReadFrame()
			if err != nil {
				if err != io.EOF {
					_ = writeText(map[string]any{"type": "closed", "reason": err.Error()})
				} else {
					_ = writeText(map[string]any{"type": "closed", "reason": "eof"})
				}
				return
			}
			if f.Channel != stream.Channel {
				continue
			}
			switch f.Kind {
			case hc.FrameData:
				if len(f.Payload) > 0 {
					if err := writeBinary(wsTagData, f.Payload); err != nil {
						return
					}
					_ = stream.SendCredit(uint32(len(f.Payload)))
				}
			case hc.FrameResize:
				if len(f.Payload) == 4 {
					newCols := binary.LittleEndian.Uint16(f.Payload[0:2])
					newRows := binary.LittleEndian.Uint16(f.Payload[2:4])
					if err := writeText(map[string]any{
						"type": "resize",
						"cols": newCols,
						"rows": newRows,
					}); err != nil {
						return
					}
				}
			case hc.FrameClose:
				_ = writeText(map[string]any{"type": "closed", "reason": "remote_close"})
				return
			}
		}
	}()

	// WebSocket -> hc
	// The PTY grid is shared by all attached clients; identical resize frames only
	// cause needless full-screen repaints of the hosted TUI.
	lastCols, lastRows := cols, rows
	for {
		msgType, data, err := ws.ReadMessage()
		if err != nil {
			finish()
			return
		}
		if msgType == websocket.BinaryMessage {
			if len(data) < 2 {
				continue
			}
			tag := data[0]
			payload := data[1:]
			switch tag {
			case wsTagData:
				if err := stream.WriteData(payload); err != nil {
					finish()
					return
				}
			case wsTagAutomaticInput:
				if err := stream.WriteAutomaticInput(payload); err != nil {
					finish()
					return
				}
			}
			continue
		}

		if msgType == websocket.TextMessage {
			var ctrl terminalControlMsg
			if err := json.Unmarshal(data, &ctrl); err != nil {
				continue
			}
			switch ctrl.Type {
			case "resize":
				if ctrl.Cols > 0 && ctrl.Rows > 0 && (ctrl.Cols != lastCols || ctrl.Rows != lastRows) {
					lastCols, lastRows = ctrl.Cols, ctrl.Rows
					_ = stream.Resize(ctrl.Cols, ctrl.Rows)
				}
			case "focus":
				_ = stream.Focus(ctrl.Focused)
			case "paste":
				if ctrl.Text != "" {
					payload := []byte(ctrl.Text)
					if ctrl.Bracketed {
						wrapped := make([]byte, 0, len(payload)+12)
						wrapped = append(wrapped, "\x1b[200~"...)
						wrapped = append(wrapped, payload...)
						wrapped = append(wrapped, "\x1b[201~"...)
						payload = wrapped
					}
					if err := stream.WriteData(payload); err != nil {
						finish()
						return
					}
				}
			}
		}
	}
}
