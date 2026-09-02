# bospa

**bospa** — mobile-first PWA-календарь для команд посуточной аренды квартир в Казахстане. Приложение собрано по `PRD v0.10` и `Mobile Calendar & Application Card UX Specification v0.2`.

> Текущая ветка — функциональный продуктовый прототип. Он полностью запускается без внешнего API и хранит демо-данные в браузере. Реальная авторизация, multi-tenant backend, платежи, object storage и Connectivity-партнёр требуют отдельного production-этапа.

## Что работает

- основной экран **Календарь** с закреплёнными датами и квартирами;
- горизонтальная прокрутка в прошлое и будущее с динамическим расширением окна;
- масштабы на 7, 4 и 2 дня;
- ранние заявки, предоплата, полная оплата и технические блокировки;
- две параллельные ранние заявки и компактный overflow для большего количества;
- hard-conflict guard без owner override;
- создание ручной заявки с автоматическим claim автора;
- Test Center для имитации раннего Booking-события;
- quick bottom sheet и полноэкранная карточка заявки;
- звонок, WhatsApp, результаты контакта, комментарии и pinned note;
- платежи, предоплата, остаток, депозит, возвратная модель в store;
- сохранение проигравшей soft-заявки в состоянии «Нужна альтернатива»;
- платный модуль каталога и публичный view-only preview;
- персональная ссылка на подборку квартир на 24 часа;
- Rate Calendar Lite и overrides на диапазон дат;
- owner analytics, manager «Мои заявки» и superadmin price book;
- component billing, счета, team management, CSV templates и экспорт;
- role switcher для owner / manager / platform superadmin;
- PWA manifest, service worker, offline app shell и installable icons;
- адаптивный UI для iPhone, Samsung, Xiaomi, Oppo и desktop.

## Быстрый запуск

Требуется Node.js 20+.

```bash
npm ci
npm run dev
```

Откройте `http://localhost:4173`.

Сборка статического PWA:

```bash
npm run build
npm run preview
```

Проверки:

```bash
npm run ci
```

## Демо-роли

Нажмите на аватар в верхней панели:

- **Алишер** — владелец;
- **Айгерим / Данияр / Алия** — менеджеры;
- **Bospa Platform** — platform superadmin.

Изменения сохраняются в `localStorage`. Сброс: `Ещё → Сбросить демо`.

## Архитектура прототипа

```text
index.html
src/
  app-parts/   UI, маршруты, формы и interaction flows (собираются по порядку)
  store.js     domain store, statuses, conflicts, payments, billing
  connectivity.js provider-neutral adapter contract and mock mapping
  data.js      deterministic demo workspace
  utils.js     dates, money, CSV and artwork helpers
  icons.js     dependency-free SVG icon set
  styles/      responsive design system and mobile calendar
contracts/
  connectivity/v1alpha/ schemas and fixtures for future partners
public/
  manifest.webmanifest
  sw.js
  icons/
docs/
  PRD-v0.10.md
  UX-SPEC-v0.2.md
```

Внешние UI-библиотеки и CDN не используются. Это сохраняет offline-работу и делает прототип простым для аудита.

## Важные инварианты

1. `soft + soft` разрешено.
2. `hard + hard` запрещено атомарной проверкой store.
3. Тестовые заявки не блокируют production-календарь и не входят в реальные финансы.
4. Чек не считается оплатой: сумму создаёт только подтверждённая операция.
5. Все менеджеры видят полную карточку, но редактирует claim-holder или owner.
6. Ручная заявка автоматически claim-ится автором.
7. Каталог синхронизируется только с production hard-занятостью и не содержит booking CTA.

## Что сознательно отложено

- реальная интеграция Booking / Channex / Beds24;
- production Go API и PostgreSQL;
- полноценная аутентификация, сессии и tenant isolation;
- серверные push и realtime;
- загрузка чеков и фотографий в KZ object storage;
- Kaspi API/deep-link integration;
- автоматический CSV adapter RealtyCalendar;
- billing provider и автоматическое списание.

Контракты будущего partner adapter уже подготовлены в `contracts/connectivity/v1alpha` и не зависят от конкретного Connectivity-провайдера.

## Docker

```bash
docker compose up --build
```

После запуска приложение доступно на `http://localhost:4173`.

## Документы

- [`docs/PRD-v0.10.md`](docs/PRD-v0.10.md)
- [`docs/UX-SPEC-v0.2.md`](docs/UX-SPEC-v0.2.md)

## Лицензия

Private product work. Copyright © bospa.
