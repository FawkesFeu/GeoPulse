package main

import (
	"context"
	"errors"
	"sync"
	"time"
)

// ErrQueueFull signals backpressure when the buffered worker queue is saturated.
var ErrQueueFull = errors.New("ingestion queue is full")

type ingestResult struct {
	event TelemetryEvent
	err   error
}

type ingestJob struct {
	ctx        context.Context
	payload    TelemetryPayload
	recordedAt time.Time
	resCh      chan ingestResult
}

// WorkerPool bounds concurrent database writes using a fixed pool of goroutines.
type WorkerPool struct {
	store      TelemetryStore
	hub        *Hub
	jobs       chan ingestJob
	numWorkers int
	wg         sync.WaitGroup
}

func NewWorkerPool(store TelemetryStore, hub *Hub, numWorkers, queueSize int) *WorkerPool {
	if numWorkers <= 0 {
		numWorkers = 4
	}
	if queueSize <= 0 {
		queueSize = 100
	}
	return &WorkerPool{
		store:      store,
		hub:        hub,
		jobs:       make(chan ingestJob, queueSize),
		numWorkers: numWorkers,
	}
}

func (wp *WorkerPool) Start(ctx context.Context) {
	for i := 0; i < wp.numWorkers; i++ {
		wp.wg.Add(1)
		go func() {
			defer wp.wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case job := <-wp.jobs:
					event, err := wp.store.InsertTelemetry(job.ctx, job.payload, job.recordedAt)
					if err == nil && wp.hub != nil {
						wp.hub.Broadcast(event)
					}
					select {
					case job.resCh <- ingestResult{event: event, err: err}:
					default:
					}
				}
			}
		}()
	}
}

func (wp *WorkerPool) Wait() {
	wp.wg.Wait()
}

func (wp *WorkerPool) Submit(ctx context.Context, payload TelemetryPayload, recordedAt time.Time) (TelemetryEvent, error) {
	resCh := make(chan ingestResult, 1)
	job := ingestJob{
		ctx:        ctx,
		payload:    payload,
		recordedAt: recordedAt,
		resCh:      resCh,
	}

	select {
	case wp.jobs <- job:
	case <-ctx.Done():
		return TelemetryEvent{}, ctx.Err()
	default:
		return TelemetryEvent{}, ErrQueueFull
	}

	select {
	case res := <-resCh:
		return res.event, res.err
	case <-ctx.Done():
		return TelemetryEvent{}, ctx.Err()
	}
}
