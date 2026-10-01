# Yatoro API

[![CI](https://github.com/Retskey2/yatoro-api/actions/workflows/ci.yml/badge.svg)](https://github.com/Retskey2/yatoro-api/actions/workflows/ci.yml)

Бэкенд аниме-кинотеки на **Bun + Elysia**: каталог из 1000+ реальных тайтлов с гибридным поиском
(полнотекстовый + триграммы, устойчив к опечаткам), фильтрами и keyset-пагинацией; пользователи с ролями,
загрузка медиа. В планах — адаптивный стриминг (HLS) и совместный просмотр ([ROADMAP](docs/ROADMAP.md)).

## Стек

| Слой | Технологии |
|---|---|
| Рантайм и HTTP | Bun 1.4, Elysia 1.4 (macro v2, TypeBox-валидация, OpenAPI/Scalar) |
| База данных | PostgreSQL 18 (`pg_trgm`, full-text, GIN, expression-индексы), Drizzle ORM 0.45 + drizzle-kit |
| Авторизация | JWT (access-токен с TTL), argon2id через `Bun.password`, иерархия ролей USER < MODERATOR < ADMIN |
| Качество | TypeScript 7 (нативный `tsc`), Biome, `bun test` + PGlite, Eden Treaty, GitHub Actions |
| Эксплуатация | Docker (multi-stage), `/health`, graceful shutdown, pino (JSON-логи), `X-Request-Id` |

## Быстрый старт (без Docker и без установки Postgres)

Нужен только [Bun](https://bun.sh) ≥ 1.4. База — PGlite (Postgres, собранный в WASM),
который `db:dev` отдаёт по обычному протоколу Postgres.

```bash
bun install
cp .env.example .env     # значения по умолчанию подходят для db:dev
bun run db:dev           # терминал 1: локальная база, данные в ./.pglite
bun run db:migrate       # терминал 2
bun run db:seed          # админ из SEED_ADMIN_* + 7 демо-тайтлов (работает офлайн)
bun run catalog:import   # опционально: топ-1000 из Shikimori (~15 с)
bun run dev
```

- API: http://localhost:5084/api
- Документация (OpenAPI/Scalar): http://localhost:5084/docs
- Состояние: http://localhost:5084/health

### С Docker

```bash
JWT_SECRET=$(openssl rand -base64 48) docker compose up --build
```

Поднимает PostgreSQL 18 и API; миграции применяются при старте контейнера.

## Скрипты

| Команда | Что делает |
|---|---|
| `bun run dev` | Сервер с перезапуском при изменениях |
| `bun run check` | Линтер + проверка типов + тесты (то же, что job `check` в CI) |
| `bun test` | Тесты на настоящем Postgres (PGlite в памяти) |
| `bun run db:dev` | Локальная база без Docker |
| `bun run db:generate` | Сгенерировать миграцию из изменений схемы |
| `bun run db:migrate` | Применить миграции |
| `bun run db:seed` | Демо-данные (идемпотентно) |
| `bun run catalog:import` | Импорт каталога из Shikimori: `--pages N`, `--status ongoing` для обновления онгоингов |
| `bun run bench:catalog` | Бенчмарк каталога (p50/p95 по сценариям) на текущей базе |

## CI

Каждый push в `main` и каждый pull request проходят три проверки:

1. **Lint · Types · Tests** — Biome, `tsc`, `bun test`;
2. **PostgreSQL 18** — миграции на пустой базе, двойной seed, запуск сервера и смоук-тест API (включая вход админа);
3. **Docker image** — сборка production-образа.

## API

| Метод | Путь | Доступ |
|---|---|---|
| `GET` | `/health` | все |
| `POST` | `/api/auth/register`, `/api/auth/login` | все (строгий rate limit) |
| `GET` | `/api/users/me` | авторизованные |
| `GET` | `/api/users/:id` | все (публичный профиль, без email) |
| `GET` | `/api/anime?q=&genres=&kind=&status=&season=&yearFrom=&yearTo=&scoreMin=&sort=&cursor=` | все |
| `GET` | `/api/anime/:id`, `/api/anime/by-slug/:slug` | все |
| `POST` | `/api/anime`, `/api/anime/:id/episodes` | ADMIN |
| `PATCH` / `DELETE` | `/api/anime/:id`, `/api/anime/:id/episodes/:number` | ADMIN |
| `GET` | `/api/admin/audit-log?entityType=&entityId=&actorId=&action=&cursor=` | ADMIN |
| `GET` / `POST` | `/api/genres` | все / ADMIN |
| `POST` | `/api/media/images` | авторизованные (постеры — ADMIN) |
| `POST` | `/api/media/videos` | ADMIN |

Ошибки всегда приходят в одном формате, внутренние детали наружу не попадают:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Ошибка валидации данных", "details": [] } }
```

## Каталог и поиск

- **Гибридный поиск** в самом PostgreSQL: полнотекстовый (стемминг ru/en, веса названий) + триграммы `pg_trgm`
  (опечатки, словоформы, латиница). «фрирэн» находит «Фрирен», «алхимики» — «Стального алхимика».
- **Фильтры:** жанры (AND), тип, статус, сезон, диапазон лет, минимальная оценка.
- **Сортировки:** релевантность, популярность, оценка, новизна, название — у каждой свой keyset-индекс,
  поэтому 10-я страница стоит столько же, сколько первая.
- **Импорт** из Shikimori: идемпотентный upsert, уважение лимитов API, 18+ не импортируется.
- **Журнал действий администраторов:** каждое изменение каталога пишется в той же транзакции, что и само изменение, —
  только изменённые поля (`from` → `to`), автор и `requestId` для связи с логами.

p95 на 1 000 реальных тайтлов — 4 мс для каталога и 28–32 мс для поиска; на 20 000 строк поиск использует
оба GIN-индекса (BitmapOr). Почему так и как это измерено — [ADR 0001](docs/adr/0001-hybrid-catalog-search.md).

## Структура

```
src/
  app.ts, index.ts        # сборка приложения / запуск сервера и graceful shutdown
  setup.ts                # CORS, rate limit, логи, ошибки, статика, OpenAPI
  config/env.ts           # валидация окружения (zod)
  database/               # клиент, схема, миграции, seed
  modules/<feature>/      # controller → service → repository (+ model: схемы и маппинг)
  modules/catalog-import/ # клиент Shikimori, маппер, импорт
  shared/                 # ошибки, HTTP-утилиты, плагины (auth-guard, error-handler, ...)
scripts/                  # dev-db (Postgres на PGlite), bench-catalog
tests/                    # интеграционные тесты через Eden Treaty
docs/ROADMAP.md           # аудит, план и статус работ
docs/adr/                 # архитектурные решения с замерами
```

Данные каталога — [Shikimori](https://shikimori.io) (импорт через публичный API).

## Безопасность

Что проверяется тестами (подробности — в [аудите](docs/ROADMAP.md#2-аудит-текущего-состояния-на-коммите-d1235b4)):

- роли проверяются декларативно (`{ role: "ADMIN" }`), обычный пользователь получает 403;
- тип загружаемого файла определяется по содержимому, расширение — по реальному типу;
- email и username уникальны без учёта регистра; публичный профиль не раскрывает email;
- rate limit привязан к IP и не обходится подменой заголовков;
- ошибки базы и стек-трейсы остаются в логах, клиент получает `INTERNAL_ERROR`.
