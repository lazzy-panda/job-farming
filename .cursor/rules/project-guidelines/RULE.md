---
description: "Правила проекта Job Farm: фронт (Angular 21), бэк (Nest 11), Prisma/SQLite, UX"
alwaysApply: true
---

## Общие
- Отвечай на русском, кратко.
- После правок во фронте прогоняй `npx nx serve ui --host=127.0.0.1 --port=<свободный> --watch=false`; если порт занят — сообщай.

## Фронтенд (Angular 21, standalone, Material)
- Новые UI-блоки — в `apps/ui/src/app/components`, standalone.
- ApiService дополняй для новых вызовов.
- Данные в signals/readonly; раздельные компоненты: job-filters, job-create, source-create, template-create, settings-form, job-table, status-card.
- Маршруты — в `app.routes.ts`, контейнеры с минимальной логикой.
- Каждый Angular компонент — отдельная папка с тремя файлами: шаблон (.html), логика (.ts), стили (.scss).
- Компоненты/файлы именуем в kebab-case, суффиксы по Angular: `.component.ts`, `.service.ts`, `.module.ts`, `.directive.ts`, `.pipe.ts`, `.spec.ts`.
- Придерживайся: строгая типизация, без `any`, интерфейсы для моделей, meaningful naming (`isUserLoggedIn`, `fetchData()`), imports → class → props → methods.
- Используй композицию компонентов, immutability и чистые функции в сервисах/state, signals для реактивности; standalone-компоненты, `inject` для DI.
- Оптимизации: trackBy в `ngFor`, pure pipes для тяжёлых расчётов, async pipe для observable, lazy-load фич, NgOptimizedImage, deferrable views.
- Ошибки/валидация: Angular forms/кастомные валидаторы; sanitization, избегай `innerHTML`.
- Производительность и UX: ARIA/semantic HTML, core Web Vitals (LCP/INP/CLS), без прямой работы с DOM.
- Строки — одинарные кавычки, отступ 2 пробела, const где можно, шаблонные строки при интерполяции.
- Порядок импортов: Angular core/common → RxJS → Angular модули (Forms) → core app → shared → env → относительные.

## Бэкенд (NestJS 11)
- Prisma + SQLite (better-sqlite3). Миграции/сид: `DATABASE_URL=file:./prisma/dev.db npx prisma migrate deploy` и `... prisma db seed`.
- Новые модули подключай в `AppModule`; Health `/api/health`; Mailer `/api/mailer/send` (SMTP из env, иначе noop); Messenger (Telegram) — noop.
- Код и доки на английском; строгая типизация, без `any`, объявляй типы для параметров и возвратов. Один export на файл, kebab-case для файлов/директорий. PascalCase для классов; camelCase для методов/переменных/функций; UPPERCASE для env.
- Функции: короткие, одна ответственность, <20 инструкций; имя с глагола; boolean — is/has/can; ранние return, избегать глубокой вложенности, default params, объект для входов/выходов (RO-RO), 1 уровень абстракции.
- Данные: избегай магических чисел, выноси в константы; immutability (`readonly`, `as const`), не злоупотреблять примитивами.
- Классы: SOLID, композиция > наследование, интерфейсы для контрактов, маленькие классы (<200 инструкций, <10 public методов/свойств).
- Исключения: бросай для неожиданных ошибок; catch — чтобы исправить/добавить контекст; иначе глобальный хендлер.
- Тесты: Arrange-Act-Assert; Given-When-Then для acceptance; понятные имена переменных (inputX, mockX, expectedX); unit для каждого public метода (с тест-даблами), e2e для модулей; Jest.
- NestJS архитектура: модульная структура; один модуль на домен/роут, контроллер на роут; DTO с class-validator; сервис на сущность; core module (фильтры/глобальные middleware/гварды/интерсепторы); shared module для общих сервисов/утилит.
- Нейминг функций — глагол; булевые — is/has/can; избегать аббревиатур, кроме API/URL и общепринятых (i/j, err, ctx, req/res/next).

## Сборка/скрипты
- Общая сборка: `npm run build:all` (api → ui → desktop).
- Desktop в `apps/desktop`, сборка webpack в `dist/apps/desktop`.

## Скрэперы
- Заглушки коннекторов в `libs/scrapers` (telegram, http-site, playwright, imap/email, linkedin, facebook); ProxyManagerService доступен в api.

## UX/качество
- Компактные формы/карточки, полосатая таблица, состояние “нет данных”.
- В формах проверяй обязательные поля, показывай snackBar при ошибках.

## Документация
- См. `README.md`, `docs/chrome-extension-spec.md`.

