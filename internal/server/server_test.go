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
		// Keep the test off the real ~/.config/herdr-code/workspaces.json.
		WorkspaceConfigPath: filepath.Join(t.TempDir(), "workspaces.json"),
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

	// 5. Same-host remote Origin allowed when token auth is enabled
	req = httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	req.Host = "100.64.0.12:4242"
	req.Header.Set("Authorization", "Bearer secret-token")
	req.Header.Set("Origin", "http://100.64.0.12:4242")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("same-host token-protected remote origin expected 200, got %d", rec.Code)
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

func TestDependenciesEndpoints(t *testing.T) {
	srv := New(Config{
		SocketPath: filepath.Join(t.TempDir(), "nonexistent.sock"),
		Version:    "test",
	})
	defer srv.Close()
	h := srv.Handler()

	// Check GET /api/settings/dependencies
	req := httptest.NewRequest(http.MethodGet, "/api/settings/dependencies", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var status DependenciesStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if status.OS == "" || status.HCDaemon.Running {
		t.Fatalf("unexpected dependencies status: %+v", status)
	}

	// Unsupported target must return 400
	req = httptest.NewRequest(http.MethodPost, "/api/settings/dependencies/install", strings.NewReader(`{"target":"rm -rf /"}`))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid target, got %d", rec.Code)
	}
}
