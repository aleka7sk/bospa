# bospa

**bospa** — mobile-first система управления ранними заявками, бронированиями, оплатами и календарём квартир для команд посуточной аренды в Казахстане.

Репозиторий содержит единое приложение:

- устанавливаемую PWA для владельца и менеджеров;
- Go HTTP API;
- PostgreSQL-схему и встроенные миграции;
- cookie-authentication, CSRF и изоляцию workspace;
- Docker Compose для локального запуска полного контура;
- provider-neutral контракт будущей интеграции с Booking/Connectivity-партнёром.

Текущая версия реализует рабочий ручной сценарий без реального Connectivity-партнёра. Внешние Booking-события проверяются через безопасный Test Center.

## Реализованный продуктовый контур

### Календарь и заявки

- календарь квартир с масштабами 7/4/2 дня;
- горизонтальная прокрутка по датам и вертикальная по квартирам;
- soft-заявки, предоплаченные и оплаченные бронирования;
- несколько ранних заявок на один период;
- очередь «Нужна альтернатива» после появления hard-брони;
- серверный запрет пересечения `hard + hard` без owner override;
- ручная заявка автоматически закрепляется за автором;
- внешняя тестовая заявка остаётся свободной до нажатия «Взять в работу»;
- карточка заявки, pinned note, комментарии, timeline и результаты контактов;
- звонок и WhatsApp из карточки;
- изменение клиента, квартиры и периода с optimistic locking;
- завершение брони после checkout и полной оплаты.

### Деньги

- точная стоимость, индивидуальная предоплата, остаток и депозит;
- несколько подтверждённых платежей;
- Kaspi, перевод, наличные и другие ручные способы;
- возвраты владельцем;
- чек не считается оплатой без подтверждённой финансовой операции;
- аналитика владельца и персональная аналитика менеджера.

### Каталог, цены и управление

- view-only каталог квартир без самостоятельного бронирования;
- подбор альтернатив и персональная ссылка на 24 часа;
- Rate Calendar Lite: будни, выходные и overrides по датам;
- управление квартирами и командой;
- component billing UX и superadmin price book;
- универсальные CSV-шаблоны;
- Test Center для partner-neutral событий;
- PWA manifest, offline shell и адаптивный интерфейс.

## Рекомендуемый запуск: полный контур

Нужны Docker и Docker Compose.

```bash
git checkout feat/bospa-pwa-v1
git pull --ff-only
cp .env.example .env
docker compose up --build
```

Откройте:

```text
http://localhost:4173
```

Локальная учётная запись по умолчанию:

```text
Email:    owner@bospa.local
Пароль:   bospa-local-owner-2026!
```

Эти credentials предназначены только для локальной разработки. Перед любым внешним развёртыванием замените пароль через `.env` и используйте secrets manager.

Сервисы:

```text
web        http://localhost:4173
api        http://localhost:8080
postgres   доступен только внутри compose network
```

Web-контейнер проксирует `/api/*` в API, поэтому cookies работают в same-origin режиме.

Остановка:

```bash
docker compose down
```

Удаление локальной БД и полный сброс:

```bash
docker compose down -v
```

## Запуск без Docker

### 1. API

Поднимите PostgreSQL и задайте переменные окружения:

```bash
export BOSPA_DATABASE_URL='postgres://bospa:password@localhost:5432/bospa?sslmode=disable'
export BOSPA_PUBLIC_ORIGIN='http://localhost:4173'
export BOSPA_ALLOWED_ORIGINS='http://localhost:4173'
export BOSPA_COOKIE_SECURE='false'
export BOSPA_AUTO_MIGRATE='true'
export BOSPA_BOOTSTRAP_OWNER_EMAIL='owner@bospa.local'
export BOSPA_BOOTSTRAP_OWNER_PASSWORD='replace-with-a-local-password'
export BOSPA_BOOTSTRAP_OWNER_NAME='Локальный владелец'
export BOSPA_BOOTSTRAP_WORKSPACE='Bospa Local'

cd server
go run ./cmd/api
```

### 2. Web

В другом терминале:

```bash
npm ci
npm run dev
```

Откройте `http://localhost:4173`. Dev server проксирует `/api/*` на `http://localhost:8080`.

Другой upstream можно задать так:

```bash
BOSPA_API_UPSTREAM=http://127.0.0.1:9080 npm run dev
```

## Demo-only режим

Для UX-проверки без PostgreSQL и Go API:

```bash
npm ci
npm run dev:demo
```

На экране входа выберите **«Открыть демо без сервера»**. Изменения сохраняются только в `localStorage` текущего браузера.

## Production build web

```bash
npm ci
npm run build
npm run preview
```

`npm run preview` повторно собирает приложение перед запуском, чтобы не раздавать устаревшую или пустую папку `dist`.

## Проверки

Web:

```bash
npm run ci
```

API:

```bash
cd server
go mod tidy
gofmt -w .
go vet ./...
go test -race -count=1 ./...
go build ./cmd/api
```

GitHub Actions дополнительно поднимает PostgreSQL и проходит интеграционный flow:

```text
login → bootstrap → create application → contact → payment → prepaid
```

## Архитектура

```text
browser / installed PWA
        │ same-origin /api
        ▼
web static server + reverse proxy
        │
        ▼
Go API
        │
        ▼
PostgreSQL
```

Основные каталоги:

```text
src/
  api.js          server client, session restore and API/store mapping
  app-parts/      UI, routes, forms and interaction flows
  store.js        demo-mode domain store and local fallback
  styles/         responsive design system
server/
  cmd/api/        API entry point
  internal/bospa/ domain, HTTP, PostgreSQL store and migrations
  openapi/        HTTP contract
contracts/
  connectivity/   future provider-neutral integration contract
public/
  manifest.webmanifest, service worker and icons
```

### Серверные гарантии

- непрозрачная 256-bit session cookie с `HttpOnly`;
- double-submit CSRF с серверной проверкой digest;
- одна активная интерактивная сессия на пользователя;
- bcrypt password hashing;
- workspace scope в запросах к данным;
- атомарный claim заявки;
- PostgreSQL exclusion constraint для hard-конфликтов;
- optimistic `lockVersion` для конкурентного редактирования;
- audit log и неизменяемая timeline заявки;
- деньги в API хранятся целым числом тиынов.

## Поведение при недоступном API

Если API временно пропал после входа, PWA сохраняет последний загруженный снимок для чтения и показывает offline-индикатор. Серверные изменения не имитируются локально. После восстановления сети используется ручное или периодическое обновление.

Если API отсутствует до входа, пользователь может повторить подключение либо перейти в отдельный demo-only режим. Демо-данные никогда не отправляются в production API автоматически.

## Если браузер показывает старую сборку

```bash
rm -rf dist
npm ci
npm run dev
```

Затем выполните hard reload. Для ранее установленной PWA:

1. DevTools → **Application → Service Workers → Unregister**;
2. **Application → Storage → Clear site data**;
3. откройте приложение заново.

## Что ещё не является production-ready

- реальный Booking/Connectivity adapter;
- загрузка фотографий и чеков в KZ object storage;
- Web Push sender и realtime fan-out;
- email/WhatsApp provider;
- автоматизированный SaaS billing provider;
- self-service приглашения и восстановление пароля;
- deployment manifests, managed PostgreSQL, PITR и observability для production;
- security review и legal review перед обработкой реальных персональных данных.

## API

OpenAPI: [`server/openapi/openapi.yaml`](server/openapi/openapi.yaml)

Health endpoints:

```text
GET /api/v1/health/live
GET /api/v1/health/ready
```

## Документы продукта

- `docs/PRD-v0.10.md`
- `docs/UX-SPEC-v0.2.md`

## Лицензия

Private product work. Copyright © bospa.
