FROM golang:1.22-alpine

WORKDIR /app

COPY . .
RUN go mod tidy && \
    go build -o ingest-server . && \
    go build -o simulator ./cmd/simulator

EXPOSE 8080

CMD ["./ingest-server"]
