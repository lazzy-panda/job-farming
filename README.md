# Job Farm

Один источник правды по запуску приложения и работе с парсером вакансий.

## Функционал
- **Источники вакансий (Sources)**:
  - добавление Telegram-каналов/сайтов как источников
  - подгрузка и кэш аватарок Telegram-источников (`/api/sources/:id/avatar`)
- **Сбор и хранение вакансий (Job postings)**:
  - дедупликация на сервере при создании/скрейпе и при чтении списка
  - политика хранения: автоматическая чистка вакансий старше **14 дней** (и связанных `applications`)
- **Парсинг вакансий (Vacancy parser)**:
  - извлечение структурированных полей (title/company/location/salary/workFormat/…)
  - `meta.warnings` для контроля качества и `confidence` по полям
  - UI-оверлей с JSON результатом парсера на карточке вакансии
- **UI-доска**:
  - список карточек вакансий
  - локальный поиск по ключевым словам (title/company/location/description/link)

## Архитектура
Монорепа **Nx**: приложения лежат в `apps/`, библиотеки — в `libs/`.

### Apps
- **`apps/ui`** — Angular 21 (standalone) + Material: дашборд, формы, таблицы, карточки вакансий.
- **`apps/api`** — NestJS 11:
  - REST API `/api/*`
  - Prisma + SQLite (`better-sqlite3`)
  - периодические джобы (cleanup) через `@nestjs/schedule`
- **`apps/desktop`** — Electron (webpack сборка в `dist/apps/desktop`) — обёртка над UI.

### Libs
- **`libs/vacancy-parser`** — pure TypeScript библиотека парсинга (без DI/DB/network).
- **`libs/shared-models`** — общие интерфейсы/контракты между UI и API.
- **`libs/scrapers`** — коннекторы (заглушки) для источников (telegram/http-site/playwright/imap/linkedin/facebook).

## Стек
- **UI**: Angular 21 + Angular Material
- **API**: NestJS 11
- **DB**: Prisma + SQLite (**better-sqlite3**, важно по версии Node)
- **Монорепа**: Nx

## Требования
- **Node.js 20.x** (критично): API использует `better-sqlite3`, нативный модуль должен совпадать с версией Node.
- npm

Если у тебя включён nvm:

```bash
nvm use 20
```

## Установка

```bash
nvm use 20
npm install --legacy-peer-deps

# миграции + сид
DATABASE_URL=file:./prisma/dev.db npx prisma migrate deploy
DATABASE_URL=file:./prisma/dev.db npx prisma db seed
```

## Запуск (dev)

### Вариант 1: всё вместе

```bash
nvm use 20
./scripts/serve-all.sh
```

По умолчанию скрипт поднимает:
- **API** на `http://127.0.0.1:3000/api`
- **UI** на свободном порту (скрипт пишет порт в консоль)

Важно: UI сейчас ожидает API именно на `http://127.0.0.1:3000/api` (см. `apps/ui/src/app/api.service.ts`).

### Вариант 2: раздельно

```bash
nvm use 20

# API
npx nx serve api

# UI
npx nx serve ui --host=127.0.0.1 --port=4200
```

## Полезные команды

```bash
# тесты парсера
npx nx test vacancy-parser

# сборка
npx nx build api
npx nx build ui
npx nx build vacancy-parser

# общая сборка
npm run build:all
```

## Парсер вакансий

### Что это
- `libs/vacancy-parser` — **pure TS** библиотека (без Nest/DI/DB/network).
- `apps/api/src/vacancy-parse` — **тонкая обёртка** и HTTP endpoint.

### HTTP endpoint
- **POST** `http://127.0.0.1:3000/api/vacancies/parse`

Request:

```json
{
  "text": "...",
  "pageTitle": "...",
  "sourceUrl": "...",
  "debug": false
}
```

Response: `ParseResult` (включая `confidence` и `meta.warnings`).

### Флаги
- **VACANCY_PARSER_ENABLED**:
  - **dev**: включён по умолчанию, если переменная не задана
  - **production**: выключен по умолчанию, включается только если `VACANCY_PARSER_ENABLED=1`
- **VACANCY_PARSER_CACHE_ENABLED**: включает in-memory cache в API обёртке

### UI: просмотр JSON на карточке
В карточке вакансии есть иконка `code` рядом с блоком описания — по клику открывается оверлей с JSON результата парсера (и кнопками Copy/Refresh).

## Массовый прогон вакансий через парсер (сравнение текст → JSON)

### 1) Сгенерировать файл сравнения

```bash
# через API: берём список вакансий из /job-postings и парсим локально (быстрее и не грузит API)
# важно: перед этим должен быть собран vacancy-parser
npx nx build vacancy-parser

API_BASE=http://127.0.0.1:3000/api node scripts/parse-all-vacancies.js --local --concurrency=3 --out=storage/parser-compare.txt
```

Файл содержит блоки: META → ORIGINAL TEXT → PARSED JSON.

### 2) Собрать отчёт по несоответствиям

```bash
node scripts/analyze-parser-compare.js --in=storage/parser-compare.txt
```

Отчёты:
- `storage/parser-compare-report.txt`
- `storage/parser-compare-report.json`

## Частые проблемы

### API падает с ошибкой better-sqlite3 / NODE_MODULE_VERSION
Это значит, что API запустили на неправильной версии Node.

Решение:

```bash
nvm use 20
npm rebuild better-sqlite3
# затем перезапуск API
```
