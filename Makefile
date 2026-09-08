SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help dev up down logs ps web api-test web-test ci clean reset-db

help:
	@printf '%s\n' \
	  'bospa local commands:' \
	  '  make dev       build and start PostgreSQL, Go API and PWA' \
	  '  make down      stop local services' \
	  '  make logs      follow service logs' \
	  '  make ci        run web and Go checks locally' \
	  '  make reset-db  remove the local database volume' \
	  '  make clean     remove generated web assets'

dev: up

up:
	@test -f .env || cp .env.example .env
	docker compose up --build -d
	@printf '\nBospa is starting. Open http://localhost:4173\n'
	@printf 'Owner: owner@bospa.local\n'
	@printf 'Password: value from BOSPA_BOOTSTRAP_OWNER_PASSWORD in .env\n\n'

down:
	docker compose down

logs:
	docker compose logs -f --tail=150

ps:
	docker compose ps

web:
	npm ci --ignore-scripts
	npm run dev

web-test:
	npm ci --ignore-scripts
	npm run ci

api-test:
	cd server && go mod tidy && test -z "$$(gofmt -l .)" && go vet ./... && go test -race -count=1 ./... && go build -trimpath ./cmd/api

ci: web-test api-test

clean:
	rm -rf dist

reset-db:
	docker compose down -v
