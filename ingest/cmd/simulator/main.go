package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

type sensorReading struct {
	SensorCode  string  `json:"sensor_code"`
	PM25        float64 `json:"pm25"`
	PM10        float64 `json:"pm10"`
	Temperature float64 `json:"temperature"`
	Humidity    float64 `json:"humidity"`
	RecordedAt  string  `json:"recorded_at"`
}

var ankaraSensors = []struct {
	code     string
	basePM25 float64
}{
	{"ANK-KIZILAY", 25.0},
	{"ANK-ULUS", 31.0},
	{"ANK-TUNALI", 19.0},
	{"ANK-BAHCELIEVLER", 22.0},
	{"ANK-ODTU", 11.0},
	{"ANK-BATIKENT", 17.5},
	{"ANK-KECIOREN", 28.0},
	{"ANK-ETIMESGUT", 23.0},
	{"IST-KADIKOY", 21.5},
	{"IST-BESIKTAS", 27.0},
	{"IST-TAKSIM", 30.0},
	{"IST-USKUDAR", 19.0},
	{"IST-BAKIRKOY", 24.0},
	{"IST-SARIYER", 12.5},
}

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}

func sendBatch(ctx context.Context, client *http.Client, targetURL string, rng *rand.Rand) {
	for _, s := range ankaraSensors {
		pm25 := math.Max(3.0, s.basePM25+(rng.Float64()*12.0-6.0))
		pm10 := pm25*1.65 + rng.Float64()*6.0
		payload := sensorReading{
			SensorCode:  s.code,
			PM25:        round1(pm25),
			PM10:        round1(pm10),
			Temperature: round1(11.0 + rng.Float64()*6.0),
			Humidity:    round1(42.0 + rng.Float64()*22.0),
			RecordedAt:  time.Now().UTC().Format(time.RFC3339),
		}

		body, _ := json.Marshal(payload)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(body))
		if err != nil {
			log.Printf("[%s] request build error: %v", s.code, err)
			continue
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			log.Printf("[%s] send error: %v", s.code, err)
			continue
		}
		_ = resp.Body.Close()
		log.Printf("[%s] status=%d pm25=%.1f pm10=%.1f", s.code, resp.StatusCode, payload.PM25, payload.PM10)
	}
}

func main() {
	targetURL := flag.String("url", "http://localhost:8080/ingest/telemetry", "Ingestion endpoint URL")
	once := flag.Bool("once", false, "Send one batch for all Ankara sensors and exit")
	interval := flag.Duration("interval", 3*time.Second, "Interval between batches")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	client := &http.Client{Timeout: 5 * time.Second}
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	sendBatch(ctx, client, *targetURL, rng)
	if *once {
		return
	}

	ticker := time.NewTicker(*interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("simulator stopped")
			return
		case <-ticker.C:
			sendBatch(ctx, client, *targetURL, rng)
		}
	}
}
