package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	herdrweb "github.com/lucacicii/herdr-code"
	"github.com/lucacicii/herdr-code/internal/hc"
	"github.com/lucacicii/herdr-code/internal/server"
)

const version = "0.1.0"

func main() {
	addr := flag.String("addr", "127.0.0.1:4242", "HTTP listen address")
	socket := flag.String("socket", hc.DefaultSocketPath(), "Path to herdr-core (hc) Unix socket")
	token := flag.String("token", os.Getenv("HERDR_CODE_TOKEN"), "Optional bearer token for API/WebSocket auth")
	openBrowser := flag.Bool("open", false, "Open the workbench URL in the default browser")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	srv := server.New(server.Config{
		Addr:       *addr,
		SocketPath: *socket,
		Token:      *token,
		StaticFS:   herdrweb.StaticFS(),
		Version:    version,
	})
	defer srv.Close()

	ln, err := srv.ListenAndServe(ctx)
	if err != nil {
		log.Fatalf("failed to start server: %v", err)
	}

	url := fmt.Sprintf("http://%s", ln.Addr().String())
	if *token != "" {
		url = fmt.Sprintf("%s/?token=%s", url, *token)
	}
	log.Printf("herdr-code %s listening at %s (hc socket: %s)", version, url, *socket)

	if *openBrowser {
		go openURL(url)
	}

	httpSrv := &http.Server{
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http serve error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down...")
	shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutCtx)
}

func openURL(u string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", u)
	case "linux":
		cmd = exec.Command("xdg-open", u)
	default:
		return
	}
	_ = cmd.Start()
}
