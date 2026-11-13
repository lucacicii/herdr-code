package server

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type EventHub struct {
	mu      sync.RWMutex
	clients map[chan []byte]struct{}
}

func NewEventHub() *EventHub {
	return &EventHub{
		clients: make(map[chan []byte]struct{}),
	}
}

func (h *EventHub) Subscribe() (chan []byte, func()) {
	ch := make(chan []byte, 64)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		if _, ok := h.clients[ch]; ok {
			delete(h.clients, ch)
			close(ch)
		}
		h.mu.Unlock()
	}
}

func (h *EventHub) Broadcast(msg any) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.clients {
		select {
		case ch <- data:
		default:
		}
	}
}

// StartHCEventPump maintains a persistent events.subscribe stream to hc and broadcasts updates.
func (s *Server) StartHCEventPump(ctx context.Context) {
	go func() {
		for {
			if ctx.Err() != nil {
				return
			}
			stream, err := s.hc.SubscribeEvents(ctx)
			if err != nil {
				s.hub.Broadcast(map[string]any{
					"type":      "hc.disconnected",
					"error":     err.Error(),
					"timestamp": time.Now().UnixMilli(),
				})
				select {
				case <-ctx.Done():
					return
				case <-time.After(2 * time.Second):
					continue
				}
			}

			s.hub.Broadcast(map[string]any{
				"type":      "hc.connected",
				"terminals": stream.Initial.Terminals,
				"seq":       stream.Initial.Seq,
			})

			for {
				raw, err := stream.ReadEvent()
				if err != nil {
					_ = stream.Close()
					break
				}
				s.hub.Broadcast(map[string]any{
					"type":  "hc.event",
					"event": raw,
				})
			}

			select {
			case <-ctx.Done():
				return
			case <-time.After(500 * time.Millisecond):
			}
		}
	}()
}

func (s *Server) handleEventsWS(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeRequest(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	ws, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	ch, unsub := s.hub.Subscribe()
	defer unsub()

	// Send initial snapshot immediately
	if list, err := s.hc.ListTerminals(r.Context(), false); err == nil {
		initMsg, _ := json.Marshal(map[string]any{
			"type":      "hc.snapshot",
			"terminals": list.Terminals,
		})
		_ = ws.WriteMessage(websocket.TextMessage, initMsg)
	}

	// Drain client pings / close
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				return
			}
		}
	}()

	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := ws.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
