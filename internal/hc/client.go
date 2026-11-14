package hc

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

type Frame struct {
	Channel uint32
	Kind    uint8
	Payload []byte
}

type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int64  `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type rpcError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *rpcError) Error() string {
	return fmt.Sprintf("hc rpc error (%d): %s", e.Code, e.Message)
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int64           `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type Client struct {
	socketPath string
	nextID     atomic.Int64
}

func DefaultSocketPath() string {
	if p := os.Getenv("HC_SOCKET"); p != "" {
		return p
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".local", "state", "herdr-core", "default", "default.sock")
}

func NewClient(socketPath string) *Client {
	if socketPath == "" {
		socketPath = DefaultSocketPath()
	}
	return &Client{socketPath: socketPath}
}

func (c *Client) SocketPath() string {
	return c.socketPath
}

func (c *Client) dial(ctx context.Context) (net.Conn, error) {
	var d net.Dialer
	d.Timeout = 5 * time.Second
	return d.DialContext(ctx, "unix", c.socketPath)
}

// Call executes a single plain-mode JSON-RPC 2.0 call over a short-lived Unix socket connection.
func (c *Client) Call(ctx context.Context, method string, params any, out any) error {
	conn, err := c.dial(ctx)
	if err != nil {
		return fmt.Errorf("dial hc socket %s: %w", c.socketPath, err)
	}
	defer conn.Close()

	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	} else {
		_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	}

	id := c.nextID.Add(1)
	req := rpcRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	}
	line, err := json.Marshal(req)
	if err != nil {
		return err
	}
	line = append(line, '\n')
	if _, err := conn.Write(line); err != nil {
		return err
	}

	reader := bufio.NewReader(conn)
	respBytes, err := reader.ReadBytes('\n')
	if err != nil {
		return err
	}

	var resp rpcResponse
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		return fmt.Errorf("decode hc response: %w", err)
	}
	if resp.Error != nil {
		return resp.Error
	}
	if out != nil && len(resp.Result) > 0 {
		if err := json.Unmarshal(resp.Result, out); err != nil {
			return fmt.Errorf("decode hc result: %w", err)
		}
	}
	return nil
}

func (c *Client) ServerStatus(ctx context.Context) (*StatusResult, error) {
	var res StatusResult
	if err := c.Call(ctx, "server.status", map[string]any{}, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *Client) ListTerminals(ctx context.Context, includeFinished bool) (*ListResult, error) {
	var res ListResult
	if err := c.Call(ctx, "terminal.list", map[string]any{"all": includeFinished}, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *Client) GetTerminal(ctx context.Context, terminal string) (*Terminal, error) {
	var res Terminal
	if err := c.Call(ctx, "terminal.get", map[string]any{"terminal": terminal}, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *Client) RunTerminal(ctx context.Context, params RunParams) (*RunResult, error) {
	var raw json.RawMessage
	if err := c.Call(ctx, "terminal.run", params, &raw); err != nil {
		return nil, err
	}
	var term Terminal
	if err := json.Unmarshal(raw, &term); err != nil {
		return nil, err
	}
	if term.Address != "" {
		return &RunResult{Terminal: term}, nil
	}
	var wrapped RunResult
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, err
	}
	return &wrapped, nil
}

func (c *Client) SendText(ctx context.Context, params SendParams) error {
	return c.Call(ctx, "terminal.send", params, nil)
}

func (c *Client) SendKeys(ctx context.Context, params KeysParams) error {
	return c.Call(ctx, "terminal.keys", params, nil)
}

func (c *Client) InterruptTerminal(ctx context.Context, terminal string) error {
	return c.Call(ctx, "terminal.interrupt", map[string]any{"terminal": terminal, "timeout": 2}, nil)
}

func (c *Client) KillTerminal(ctx context.Context, terminal string) error {
	return c.Call(ctx, "terminal.kill", map[string]any{"terminal": terminal}, nil)
}

func (c *Client) RemoveTerminal(ctx context.Context, terminal string) error {
	return c.Call(ctx, "terminal.rm", map[string]any{"terminal": terminal}, nil)
}

func (c *Client) SetLabels(ctx context.Context, terminal string, labels map[string]string) error {
	return c.Call(ctx, "terminal.label", map[string]any{"terminal": terminal, "labels": labels}, nil)
}

func (c *Client) ListTemplates(ctx context.Context) ([]TemplateInfo, error) {
	var res TemplatesResult
	if err := c.Call(ctx, "templates.list", map[string]any{}, &res); err != nil {
		return nil, err
	}
	return res.Templates, nil
}

func (c *Client) DocGet(ctx context.Context, name string) (json.RawMessage, error) {
	var res struct {
		Value   json.RawMessage `json:"value"`
		Version uint64          `json:"version"`
	}
	if err := c.Call(ctx, "doc.get", map[string]any{"name": name}, &res); err != nil {
		return nil, err
	}
	return res.Value, nil
}

// framedConn manages a single dedicated framed connection to hc.
type framedConn struct {
	conn   net.Conn
	reader *bufio.Reader
	mu     sync.Mutex
}

func (c *Client) dialFramed(ctx context.Context) (*framedConn, *HelloResult, error) {
	conn, err := c.dial(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("dial hc socket %s: %w", c.socketPath, err)
	}

	id := c.nextID.Add(1)
	helloBytes, err := json.Marshal(rpcRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  "hello",
		Params:  map[string]any{"framed": true},
	})
	if err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	helloBytes = append(helloBytes, '\n')
	if _, err := conn.Write(helloBytes); err != nil {
		_ = conn.Close()
		return nil, nil, err
	}

	reader := bufio.NewReaderSize(conn, 64*1024)
	respLine, err := reader.ReadBytes('\n')
	if err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	var resp rpcResponse
	if err := json.Unmarshal(respLine, &resp); err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	if resp.Error != nil {
		_ = conn.Close()
		return nil, nil, resp.Error
	}
	var hello HelloResult
	if err := json.Unmarshal(resp.Result, &hello); err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	if !hello.Framed {
		_ = conn.Close()
		return nil, nil, errors.New("hc refused framed mode")
	}

	return &framedConn{conn: conn, reader: reader}, &hello, nil
}

func (fc *framedConn) writeFrame(channel uint32, kind uint8, payload []byte) error {
	if len(payload) > MaxFramePayload {
		return fmt.Errorf("frame payload too large: %d", len(payload))
	}
	var hdr [9]byte
	binary.LittleEndian.PutUint32(hdr[0:4], channel)
	hdr[4] = kind
	binary.LittleEndian.PutUint32(hdr[5:9], uint32(len(payload)))

	fc.mu.Lock()
	defer fc.mu.Unlock()
	if _, err := fc.conn.Write(hdr[:]); err != nil {
		return err
	}
	if len(payload) > 0 {
		if _, err := fc.conn.Write(payload); err != nil {
			return err
		}
	}
	return nil
}

func (fc *framedConn) readFrame() (Frame, error) {
	var hdr [9]byte
	if _, err := io.ReadFull(fc.reader, hdr[:]); err != nil {
		return Frame{}, err
	}
	ch := binary.LittleEndian.Uint32(hdr[0:4])
	kind := hdr[4]
	length := binary.LittleEndian.Uint32(hdr[5:9])
	if length > MaxFramePayload {
		return Frame{}, fmt.Errorf("frame length exceeds limit: %d", length)
	}
	var payload []byte
	if length > 0 {
		payload = make([]byte, length)
		if _, err := io.ReadFull(fc.reader, payload); err != nil {
			return Frame{}, err
		}
	}
	return Frame{Channel: ch, Kind: kind, Payload: payload}, nil
}

func (fc *framedConn) callFramed(method string, params any, out any) error {
	reqBytes, err := json.Marshal(rpcRequest{
		JSONRPC: "2.0",
		ID:      time.Now().UnixNano(),
		Method:  method,
		Params:  params,
	})
	if err != nil {
		return err
	}
	reqBytes = append(reqBytes, '\n')
	if err := fc.writeFrame(0, FrameData, reqBytes); err != nil {
		return err
	}

	for {
		f, err := fc.readFrame()
		if err != nil {
			return err
		}
		if f.Channel != 0 || f.Kind != FrameData {
			continue
		}
		var resp rpcResponse
		if err := json.Unmarshal(f.Payload, &resp); err != nil {
			return err
		}
		if resp.Error != nil {
			return resp.Error
		}
		if out != nil && len(resp.Result) > 0 {
			return json.Unmarshal(resp.Result, out)
		}
		return nil
	}
}

func (fc *framedConn) close() error {
	return fc.conn.Close()
}

// AttachStream represents a dedicated framed attach session to one hc terminal.
type AttachStream struct {
	fc      *framedConn
	Channel uint32
	Meta    AttachResult
	closed  atomic.Bool
}

func (c *Client) Attach(ctx context.Context, params AttachParams) (*AttachStream, error) {
	fc, _, err := c.dialFramed(ctx)
	if err != nil {
		return nil, err
	}
	var res AttachResult
	if err := fc.callFramed("terminal.attach", params, &res); err != nil {
		_ = fc.close()
		return nil, err
	}
	return &AttachStream{
		fc:      fc,
		Channel: res.Channel,
		Meta:    res,
	}, nil
}

func (a *AttachStream) ReadFrame() (Frame, error) {
	return a.fc.readFrame()
}

func (a *AttachStream) WriteData(data []byte) error {
	if len(data) == 0 {
		return nil
	}
	return a.fc.writeFrame(a.Channel, FrameData, data)
}

func (a *AttachStream) WriteAutomaticInput(data []byte) error {
	if len(data) == 0 {
		return nil
	}
	if a.Meta.AutomaticInput {
		return a.fc.writeFrame(a.Channel, FrameAutomaticInput, data)
	}
	return a.fc.writeFrame(a.Channel, FrameData, data)
}

func (a *AttachStream) SendCredit(n uint32) error {
	if n == 0 {
		return nil
	}
	var buf [4]byte
	binary.LittleEndian.PutUint32(buf[:], n)
	return a.fc.writeFrame(a.Channel, FrameCredit, buf[:])
}

func (a *AttachStream) Resize(cols, rows uint16) error {
	var buf [4]byte
	binary.LittleEndian.PutUint16(buf[0:2], cols)
	binary.LittleEndian.PutUint16(buf[2:4], rows)
	return a.fc.writeFrame(a.Channel, FrameResize, buf[:])
}

func (a *AttachStream) Focus(focused bool) error {
	var b byte
	if focused {
		b = 1
	}
	return a.fc.writeFrame(a.Channel, FrameFocus, []byte{b})
}

func (a *AttachStream) Close() error {
	if a.closed.Swap(true) {
		return nil
	}
	_ = a.fc.writeFrame(a.Channel, FrameClose, nil)
	return a.fc.close()
}

// EventStream subscribes to hc events in framed mode.
type EventStream struct {
	fc      *framedConn
	Channel uint32
	Initial SubscribeResult
	closed  atomic.Bool
}

func (c *Client) SubscribeEvents(ctx context.Context) (*EventStream, error) {
	fc, _, err := c.dialFramed(ctx)
	if err != nil {
		return nil, err
	}
	var res SubscribeResult
	if err := fc.callFramed("events.subscribe", map[string]any{}, &res); err != nil {
		_ = fc.close()
		return nil, err
	}
	if res.Channel == nil {
		_ = fc.close()
		return nil, errors.New("events.subscribe did not return a framed channel")
	}
	return &EventStream{
		fc:      fc,
		Channel: *res.Channel,
		Initial: res,
	}, nil
}

func (e *EventStream) ReadEvent() (json.RawMessage, error) {
	for {
		f, err := e.fc.readFrame()
		if err != nil {
			return nil, err
		}
		if f.Channel != e.Channel {
			continue
		}
		if f.Kind == FrameClose {
			return nil, io.EOF
		}
		if f.Kind != FrameData {
			continue
		}
		if len(f.Payload) > 0 {
			var credit [4]byte
			binary.LittleEndian.PutUint32(credit[:], uint32(len(f.Payload)))
			_ = e.fc.writeFrame(e.Channel, FrameCredit, credit[:])
			return json.RawMessage(f.Payload), nil
		}
	}
}

func (e *EventStream) Close() error {
	if e.closed.Swap(true) {
		return nil
	}
	_ = e.fc.writeFrame(e.Channel, FrameClose, nil)
	return e.fc.close()
}
