package hc

import "encoding/json"

const (
	FrameData           uint8 = 0
	FrameCredit         uint8 = 1
	FrameClose          uint8 = 2
	FrameResize         uint8 = 3
	FrameFocus          uint8 = 4
	FrameFacts          uint8 = 5
	FrameAutomaticInput uint8 = 6

	MaxFramePayload = 16 * 1024 * 1024
)

type Status struct {
	State    string `json:"state"` // idle, working, done, blocked, error
	App      string `json:"app,omitempty"`
	Kind     string `json:"kind,omitempty"` // permission, question, auth
	Msg      string `json:"msg,omitempty"`
	Progress *uint8 `json:"progress,omitempty"`
	Title    string `json:"title,omitempty"`
}

type Foreground struct {
	PID  int32    `json:"pid"`
	Name string   `json:"name"`
	Argv []string `json:"argv"`
	Cwd  string   `json:"cwd"`
}

type Terminal struct {
	Address    string            `json:"address"`
	Name       *string           `json:"name"`
	Title      string            `json:"title"`
	Argv       []string          `json:"argv"`
	Cwd        string            `json:"cwd"`
	State      string            `json:"state"` // live, finished
	CreatedMs  uint64            `json:"created_ms"`
	FinishedMs *uint64           `json:"finished_ms,omitempty"`
	ExitCode   *int32            `json:"exit_code,omitempty"`
	Signal     *int32            `json:"signal,omitempty"`
	Reason     *string           `json:"reason,omitempty"`
	Cols       uint16            `json:"cols"`
	Rows       uint16            `json:"rows"`
	PID        *uint32           `json:"pid,omitempty"`
	Parent     *string           `json:"parent,omitempty"`
	Keep       bool              `json:"keep"`
	Labels     map[string]string `json:"labels"`
	Status     *Status           `json:"status"`
	StatusMs   *uint64           `json:"status_ms,omitempty"`
	Foreground *Foreground       `json:"foreground"`
	Template   *string           `json:"template,omitempty"`
	Turn       uint64            `json:"turn"`
	Screen     string            `json:"screen"`
}

type ListResult struct {
	Terminals      []Terminal      `json:"terminals"`
	HiddenFinished uint            `json:"hidden_finished"`
	Machines       json.RawMessage `json:"machines"`
}

type CoreInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type HelloResult struct {
	Generation uint32   `json:"generation"`
	Version    string   `json:"version"`
	Core       CoreInfo `json:"core"`
	Framed     bool     `json:"framed"`
	Methods    []string `json:"methods"`
	Features   []string `json:"features"`
}

type StatusResult struct {
	Core     CoreInfo `json:"core"`
	Version  string   `json:"version"`
	Live     int      `json:"live"`
	Finished int      `json:"finished"`
	PID      int      `json:"pid"`
	UptimeMs uint64   `json:"uptime_ms"`
}

type AttachParams struct {
	Terminal            string `json:"terminal"`
	Cols                uint16 `json:"cols"`
	Rows                uint16 `json:"rows"`
	History             uint   `json:"history,omitempty"`
	Observe             bool   `json:"observe,omitempty"`
	ResizeNotifications bool   `json:"resize_notifications,omitempty"`
	Resumed             bool   `json:"resumed,omitempty"`
}

type AttachResult struct {
	Channel             uint32   `json:"channel"`
	Terminal            Terminal `json:"terminal"`
	ResizeNotifications bool     `json:"resize_notifications"`
	AutomaticInput      bool     `json:"automatic_input"`
}

type RunSize struct {
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

type RunParams struct {
	Argv   []string          `json:"argv,omitempty"`
	Line   string            `json:"line,omitempty"`
	Cwd    string            `json:"cwd,omitempty"`
	Name   string            `json:"name,omitempty"`
	Keep   bool              `json:"keep,omitempty"`
	Labels map[string]string `json:"labels,omitempty"`
	Size   *RunSize          `json:"size,omitempty"`
}

type RunResult struct {
	Terminal Terminal `json:"terminal"`
}

type SendParams struct {
	Terminal string `json:"terminal"`
	Text     string `json:"text"`
	Force    bool   `json:"force,omitempty"`
}

type KeysParams struct {
	Terminal string   `json:"terminal"`
	Keys     []string `json:"keys"`
}

type SubscribeResult struct {
	Channel   *uint32    `json:"channel"`
	Seq       uint64     `json:"seq"`
	Terminals []Terminal `json:"terminals"`
}

type TemplateInfo struct {
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Argv        []string `json:"argv,omitempty"`
}

type TemplatesResult struct {
	Templates []TemplateInfo `json:"templates"`
}
