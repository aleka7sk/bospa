FROM golang:1.27.1-alpine AS build
WORKDIR /src
RUN apk add --no-cache ca-certificates git
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/bospa-api ./cmd/api

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && addgroup -S bospa && adduser -S -G bospa -u 10001 bospa
COPY --from=build /out/bospa-api /usr/local/bin/bospa-api
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/bospa-api"]
