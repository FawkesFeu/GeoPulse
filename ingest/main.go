package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func writeJSON(w http.ResponseWriter, statusCode int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(body)
}

func newMux(pool *WorkerPool, hub *Hub, pingFn func(context.Context) error) *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("/ingest/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		if pingFn != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			if err := pingFn(ctx); err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{
					"status": "degraded",
					"error":  err.Error(),
				})
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "ok",
			"service": "go-ingest",
		})
	})

	mux.HandleFunc("/ingest/telemetry", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

		var payload TelemetryPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON payload"})
			return
		}

		recordedAt, err := payload.Validate()
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		event, err := pool.Submit(r.Context(), payload, recordedAt)
		if err != nil {
			switch {
			case errors.Is(err, ErrSensorNotFound):
				writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
			case errors.Is(err, ErrQueueFull):
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			default:
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to persist telemetry"})
			}
			return
		}

		writeJSON(w, http.StatusCreated, event)
	})

	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWS(w, r)
	})

	return mux
}

func main() {
	port := os.Getenv("INGEST_PORT")
	if port == "" {
		port = "8080"
	}
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pgPool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatalf("unable to create postgres pool: %v", err)
	}
	defer pgPool.Close()

	if err := pgPool.Ping(ctx); err != nil {
		log.Fatalf("unable to ping postgres: %v", err)
	}

	hub := NewHub()
	go hub.Run(ctx)

	store := NewPGStore(pgPool)
	workerPool := NewWorkerPool(store, hub, 4, 100)
	workerPool.Start(ctx)

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           newMux(workerPool, hub, pgPool.Ping),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("Go ingestion service listening on :%s", port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down go ingestion service...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdownCtx)
	workerPool.Wait()
}
