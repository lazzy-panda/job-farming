# Job Farm

Один источник правды по запуску приложения и работе с парсером вакансий.

## Режим 12-недельного плана (трек А: Delivery Manager / РП, RU-рынок)

Приложение — рабочий инструмент плана поиска работы. Что подключено:

- **Источники плана** (сидируются `node scripts/seed-plan-sources.js`):
  - RSS hh.ru (`hh.ru/search/vacancy/rss`, запрос «Delivery Manager / руководитель проектов / менеджер проектов», Россия, удалёнка). API `api.hh.ru` с зарубежных IP отдаёт 403, поэтому RSS; страницы вакансий за антиботом → у источника `metadata.fetchFullContent=false` (описание берётся из сниппета фида).
  - RSS Хабр Карьеры (два запроса: «руководитель проектов», «delivery manager»).
  - Telegram-каналы: `@projects_jobs_feed`, `@forproducts`, `@job_SA_PM`, `@itpminfo` (`@agile_jobs` из плана мёртв — не добавлен).
- **Западные API-коннекторы выключены по умолчанию** (Remotive/RemoteOK/Arbeitsagentur/DevITjobs/TheMuse/Jobicy/Findwork/Arbeitnow) — не относятся к треку А. Для запасного Angular-трека (недели 9+) включаются через `X_ENABLED=1`. Очистка старых нерелевантных источников: `node scripts/remove-irrelevant-sources.js` (`--dry-run` для проверки).
- **Воронка откликов**: на карточке вакансии — «отложить» (шортлист), «адаптированный отклик» (+2 очка), «отклик по шаблону» (+1). Статусы отклика: `sent → replied → interview → offer/rejected` (переход в `interview` даёт +8 очков, `PATCH /api/applications/:id`).
- **Очки плана** (`/api/scores`): авто — отклики и собесы; вручную с дашборда — касание +3, созвон +8, пост +5, артефакт +4. Сводка `/api/scores/summary`: очки дня (порог 6/10), недели (35/45), красный флаг «2 дня по нулям».
- **Чекпоинты** на дашборде: накопленные отклики/ответы/собесы против норм (26.09: ≥55/≥4/≥2 · 24.10: ≥100/собесов ≥8 · 21.11: ≥150).
- **Фоллоу-апы**: `/api/applications/followups` — отклики без ответа больше 3 дней, кнопки «Ответили»/«Собес» на дашборде.
- **Резюме** (страница «Шаблоны»): несколько версий резюме, одна — по умолчанию (звезда); каждый отклик автоматически штампуется именем текущей версии (`Application.resumeVersion`), A/B-статистика ответов — `/api/resumes/stats`.
- **Защита воронки**: вакансии со статусом `shortlisted`/`applied` или с откликами не удаляются никакими автоматическими чистками (история нужна чекпоинтам).

## Функционал
- **Источники вакансий (Sources)**:
  - добавление Telegram-каналов/сайтов как источников
  - подгрузка и кэш аватарок Telegram-источников (`/api/sources/:id/avatar`)
- **Auto-managed источники**:
  - HigherEdJobs RSS (через `scripts/import-higheredjobs-all-rss.js`)
- Arbeitsagentur Jobsuche API
- Arbeitnow Public API
- Remotive Public API (все активные remote-вакансии с remotive.com)
- Remote OK Public Feed (https://remoteok.com/api)
- The Muse Open API (https://www.themuse.com/api/public/jobs)
- Jobicy API (https://jobicy.com/api/v2/remote-jobs)
- Findwork API (https://findwork.dev/api/jobs/)
- DevITjobs UK API (https://devitjobs.uk/)
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
DATABASE_URL=file:./dev.db npx prisma migrate deploy
DATABASE_URL=file:./dev.db npx prisma db seed
```

## Запуск (dev)

### Вариант 1: всё вместе

```bash
nvm use 20
# короткое имя из package.json
npm run serve:all
```

Или напрямую:

```bash
OUTPUT_STYLE=stream ./scripts/serve-all.sh
```

Для фонового режима с логом:

```bash
OUTPUT_STYLE=stream ./scripts/serve-all.sh > tmp/serve-all.log 2>&1 &
tail -f tmp/serve-all.log    # мониторинг
```

Остановить можно `kill <PID>` (PID выводится после запуска или через `lsof -ti tcp:3000`).

По умолчанию скрипт поднимает:
- **API** на `http://127.0.0.1:3000/api`
- **UI** на `http://127.0.0.1:4216/`

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

## Обслуживание Telegram-источников

Пороговые значения регулируются переменными окружения:

- `TELEGRAM_EMPTY_RUNS_WARN` (по умолчанию 3) — после стольких пустых прогонов в лог летит предупреждение.
- `TELEGRAM_EMPTY_RUNS_PAUSE` (5) — источник получает `stopUntil`.
- `TELEGRAM_EMPTY_RUNS_DISABLE` (40) — канал переводится в `inactive`.
- `TELEGRAM_BLOCK_STRIKE_LIMIT` (5) — сколько подряд блокировок прокси допускаем до отключения источника.
- `TELEGRAM_INACTIVE_COOLDOWN_HOURS` (24) — насколько долго держать `inactive` после автоотключения.

Очистку старых/молчащих каналов можно запускать отдельно:

```bash
DATABASE_URL=file:./dev.db node scripts/cleanup-telegram-sources.js --max-empty=50 --max-age-days=45
```

Скрипт пометит подходящие источники как `inactive`, чтобы краулер не тратил время на мёртвые каналы.

### Remotive Public API

Сбор ремоут-вакансий включён по умолчанию и управляется переменными окружения:

| Переменная | По умолчанию | Описание |
|-----------|--------------|----------|
| `REMOTIVE_ENABLED` | `true` | включить/выключить сбор |
| `REMOTIVE_DAYS` | `14` | сколько дней назад брать вакансии |
| `REMOTIVE_PAGE_SIZE` | `100` | размер страницы API (max 200) |
| `REMOTIVE_MAX_PAGES` | `5` | предел страниц за один прогон |
| `REMOTIVE_CATEGORY` / `REMOTIVE_SEARCH` / `REMOTIVE_COMPANY` | пусто | опциональные фильтры API |
| `REMOTIVE_MAX_AGE_DAYS` | `14` | политика очистки старых вакансий Remotive |

Каждый запуск создаёт/обновляет источник `Remotive Public API` (`sourceType = remotive`) и хранит свежие вакансии.

### Arbeitnow Public API

Работаем с открытым job-board API https://www.arbeitnow.com/api/job-board-api:

| Переменная | По умолчанию | Описание |
|-----------|--------------|----------|
| `ARBEITNOW_ENABLED` | `true` | включить/выключить сбор |
| `ARBEITNOW_DAYS` | `14` | глубина выгрузки |
| `ARBEITNOW_MAX_PAGES` | `5` | предел страниц за прогон |
| `ARBEITNOW_MAX_AGE_DAYS` | `14` | политика удаления устаревших записей |

Источник (`sourceType = arbeitnow`) создаётся автоматически, и после каждой выгрузки старые вакансии чистятся.

### The Muse Open API

Подтягиваем свежие вакансии с https://www.themuse.com/api/public/jobs:

| Переменная | По умолчанию | Описание |
|-----------|--------------|----------|
| `THEMUSE_ENABLED` | `true` | включить/выключить импорт |
| `THEMUSE_DAYS` | `14` | глубина по дате публикации |
| `THEMUSE_PAGE_SIZE` | `50` | элементов на страницу (max 100) |
| `THEMUSE_MAX_PAGES` | `5` | предел страниц за прогон |
| `THEMUSE_CATEGORY` / `THEMUSE_COMPANY` / `THEMUSE_LOCATION` / `THEMUSE_LEVEL` | пусто | фильтры API |
| `THEMUSE_MAX_AGE_DAYS` | `14` | очистка старых вакансий |

Источник (`sourceType = themuse`) создаётся автоматически, а старые записи удаляются после скрапинга.

### Remote OK Public Feed

Remote OK отдаёт единый JSON-фид по адресу https://remoteok.com/api.  
Мы фильтруем вакансии по дате, опциональным тегам/локации/компании и автоматически чистим записи старше заданного срока:

| Переменная | По умолчанию | Описание |
|-----------|--------------|----------|
| `REMOTEOK_ENABLED` | `true` | включить/выключить импорт |
| `REMOTEOK_DAYS` | `14` | глубина выгрузки по дате публикации |
| `REMOTEOK_MAX_ITEMS` | `250` | лимит вакансий за один прогон |
| `REMOTEOK_TAG` / `REMOTEOK_LOCATION` / `REMOTEOK_COUNTRY` / `REMOTEOK_COMPANY` | пусто | опциональные фильтры (по тегу, локации или компании) |
| `REMOTEOK_SEARCH` | пусто | строка поиска по title/description |
| `REMOTEOK_MAX_AGE_DAYS` | `14` | политика удаления устаревших записей |

Источник `Remote OK Public Feed` (`sourceType = remoteok`) создаётся автоматически.

### Jobicy API

Jobicy предоставляет открытую ленту remote-вакансий по адресу https://jobicy.com/api/v2/remote-jobs.  
Делаем выборку по последним публикациям и опциональным фильтрам API:

| Переменная | По умолчанию | Описание |
|-----------|--------------|----------|
| `JOBICY_ENABLED` | `true` | включить/выключить импорт |
| `JOBICY_DAYS` | `14` | глубина выгрузки по дате |
| `JOBICY_COUNT` | `100` | сколько вакансий запрашивать (1…100) |
| `JOBICY_INDUSTRY` / `JOBICY_JOB_TYPE` / `JOBICY_JOB_LEVEL` | пусто | фильтры API по отрасли/типу/уровню |
| `JOBICY_GEO` / `JOBICY_TAG` / `JOBICY_COMPANY` | пусто | география, произвольные теги и название компании |
| `JOBICY_SEARCH` | пусто | поисковая строка (title/description) |
| `JOBICY_MAX_AGE_DAYS` | `14` | политика очистки старых записей |

Источник `Jobicy API` (`sourceType = jobicy`) создаётся автоматически, а вакансии старше лимита удаляются при каждом прогоне.

### Findwork API

Findwork требует персональный API token (https://findwork.dev/).  
После установки `FINDWORK_API_KEY` подтягиваем свежие вакансии с дополнительными фильтрами:

| Переменная | По умолчанию | Описание |
|-----------|--------------|----------|
| `FINDWORK_ENABLED` | `true` | включить/выключить импорт |
| `FINDWORK_API_KEY` | — | токен авторизации (_обязателен_) |
| `FINDWORK_DAYS` | `14` | глубина по дате публикации |
| `FINDWORK_PAGE_SIZE` | `50` | размер страницы (1…100) |
| `FINDWORK_MAX_PAGES` | `5` | предел страниц за прогон |
| `FINDWORK_SEARCH` / `FINDWORK_LOCATION` / `FINDWORK_COMPANY` | пусто | фильтры API |
| `FINDWORK_EMPLOYMENT_TYPE` | пусто | фильтр по типу занятости |
| `FINDWORK_REMOTE_ONLY` | `false` | брать только remote вакансии |
| `FINDWORK_MAX_AGE_DAYS` | `14` | очистка старых записей |

Источник `Findwork API` (`sourceType = findwork`) создаётся автоматически, при каждом прогоне выполняется очистка устаревших JobPosting этого типа.

### DevITjobs UK API

У DevITjobs UK есть GraphQL-интерфейс, но публичные запросы требуют прохождения их фронтовой защиты. Для надёжности мы используем их JSON-эндпоинт `/api/jobsLight` + детальные страницы, откуда вытягиваем описание вакансии.

| Переменная | По умолчанию | Описание |
|-----------|--------------|----------|
| `DEVITJOBS_ENABLED` | `true` | включить/выключить сбор |
| `DEVITJOBS_DAYS` | `14` | глубина по дате публикации |
| `DEVITJOBS_MAX_JOBS` | `100` | ограничение числа вакансий за один прогон |
| `DEVITJOBS_CITY` / `DEVITJOBS_TECH` / `DEVITJOBS_COMPANY` | пусто | фильтры по городу/категории/компании |
| `DEVITJOBS_REMOTE_ONLY` | `false` | брать только remote-вакансии |
| `DEVITJOBS_FETCH_DETAILS` | `true` | подтягивать страницы с описанием (отключайте, если API замедляется) |
| `DEVITJOBS_DETAIL_CONCURRENCY` | `4` | параллелизм при загрузке детальных страниц |
| `DEVITJOBS_MAX_AGE_DAYS` | `14` | политика очистки старых записей |

Источник `DevITjobs UK` (`sourceType = devitjobs`) создаётся автоматически; при каждой загрузке удаляются вакансии старше `DEVITJOBS_MAX_AGE_DAYS`.

## Синхронизация всех RSS HigherEdJobs

На странице https://www.higheredjobs.com/rss/ регулярно появляются новые ленты.  
Скрипт `scripts/import-higheredjobs-all-rss.js` вытягивает полный список (с зеркалом через `r.jina.ai`, если основная страница отдаёт Incapsula) и добавляет отсутствующие источники (`sourceType = rss`).

```bash
npm run rss:sync:higheredjobs
# или вручную:
DATABASE_URL=file:./dev.db node scripts/import-higheredjobs-all-rss.js
```

Сценарий безопасно переисполнять: существующие источники пропускаются.

## Обновление пула прокси

Со свежими публичными HTTP‑прокси удобно работать через `scripts/refresh-proxies.sh`:

```bash
npm run serve:all   # в другой вкладке
npm run proxies:refresh
# либо
./scripts/refresh-proxies.sh
```

Команда скачает открытые прокси, прогонит проверку (`scripts/verify-proxies.js`) и покажет количество активных записей в таблице `Proxy`.
По умолчанию она запускает импорт с конкуренцией 40/12 (проверка/cookie) и раздачей UA, а затем прогоняет быструю повторную проверку (`PROXY_TEST_CONCURRENCY=60`).
Параметры можно переопределить переменными окружения `IMPORT_*` / `VERIFY_*` перед вызовом скрипта.

### Реальные cookies HigherEdJobs

Чтобы HigherEdJobs RSS не блокировались Incapsula, для каждого прокси можно пробросить cookies из живой браузерной сессии:

1. В браузере авторизуйтесь на https://www.higheredjobs.com и скопируйте целиком заголовок `Cookie:` из DevTools (либо экспортируйте cookies в JSON).
2. Сохраните его в `storage/higheredjobs.cookies.txt` (одна строка `Cookie: ...` — один набор; можно указать свой путь через `HIGHEREDJOBS_COOKIE_FILE`).  
   Допустимы форматы: текст, массив строк, массив объектов `{ name, value }` или JSON c полем `cookies`.
3. Запустите `npm run proxies:apply-cookies` — скрипт распределит cookies по всем активным прокси и отметит дату обновления.

Скрипт импорта `scripts/import-open-proxies.js` автоматически использует файл, если он существует: каждому новому прокси достанется уникальный User-Agent и cookie header из указанного пула. Если файл отсутствует, коннектор попытается получить cookies через сам прокси и в крайнем случае применит fallback.

## Сбор вакансий вручную

```bash
# синхронно (ожидаем завершения вызова)
curl -X POST 'http://127.0.0.1:3000/api/job-postings/scrape'

# асинхронно (возвращает jobId сразу)
curl -X POST 'http://127.0.0.1:3000/api/job-postings/scrape?async=true'

# проверка статуса фоновой задачи
curl 'http://127.0.0.1:3000/api/job-postings/scrape/<jobId>'
```
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
