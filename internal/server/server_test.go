package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func TestOriginAndTokenAuthAndWorkspaceAPI(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "hello.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	srv := New(Config{
		SocketPath: filepath.Join(t.TempDir(), "nonexistent.sock"),
		Token:      "secret-token",
		Version:    "test",
	})
	defer srv.Close()

	h := srv.Handler()

	// 1. Health endpoint works without token and reports auth_required=true
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("health expected 200, got %d", rec.Code)
	}
	var health map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &health)
	if health["auth_required"] != true {
		t.Fatalf("expected auth_required=true, got %v", health)
	}

	// 2. Unauthorized without token
	req = httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without token, got %d", rec.Code)
	}

	// 3. Evil Origin rejected even with token
	req = httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	req.Header.Set("Origin", "https://evil.example.com")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for evil origin, got %d", rec.Code)
	}

	// 4. Add workspace + read file with valid token and localhost Origin
	body := `{"path":"` + dir + `","pin":true}`
	req = httptest.NewRequest(http.MethodPost, "/api/workspaces", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret-token")
	req.Header.Set("Origin", "http://127.0.0.1:4242")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("add workspace expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var addResp struct {
		Workspace struct {
			ID string `json:"id"`
		} `json:"workspace"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &addResp)
	if addResp.Workspace.ID == "" {
		t.Fatalf("expected workspace ID")
	}

	req = httptest.NewRequest(http.MethodGet, "/api/workspaces/"+addResp.Workspace.ID+"/file?path=hello.go", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("read file expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPWAStaticHeaders(t *testing.T) {
	staticFS := fstest.MapFS{
		"index.html":           {Data: []byte("<html></html>")},
		"manifest.webmanifest": {Data: []byte(`{"name":"herdr-code"}`)},
		"sw.js":                {Data: []byte("self.addEventListener('fetch',()=>{});")},
	}

	srv := New(Config{
		SocketPath: filepath.Join(t.TempDir(), "nonexistent.sock"),
		StaticFS:   staticFS,
		Version:    "test",
	})
	defer srv.Close()

	h := srv.Handler()

	req := httptest.NewRequest(http.MethodGet, "/manifest.webmanifest", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("manifest expected 200, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/manifest+json") {
		t.Fatalf("expected application/manifest+json, got %q", ct)
	}

	req = httptest.NewRequest(http.MethodGet, "/sw.js", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("sw.js expected 200, got %d", rec.Code)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("expected sw.js Cache-Control=no-cache, got %q", cc)
	}
}
