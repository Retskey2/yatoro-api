# Yatoro API

[![CI](https://github.com/Retskey2/yatoro-api/actions/workflows/ci.yml/badge.svg)](https://github.com/Retskey2/yatoro-api/actions/workflows/ci.yml)

Бэкенд аниме-кинотеки на **Bun + Elysia**: каталог с жанрами и сериями, пользователи с ролями,
загрузка медиа. В планах — адаптивный стриминг (HLS), полнотекстовый поиск и совместный просмотр
([ROADMAP](docs/ROADMAP.md)).

## Стек

| Слой | Технологии |
|---|---|
| Рантайм и HTTP | Bun 1.4, Elysia 1.4 (macro v2, TypeBox-валидация, OpenAPI/Scalar) |
| База данных | PostgreSQL 18, Drizzle ORM 0.45 + drizzle-kit (миграции) |
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
bun run db:seed          # демо-каталог + админ из SEED_ADMIN_* в .env
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
| `GET` | `/api/anime?limit=&cursor=` | все (cursor-пагинация) |
| `GET` | `/api/anime/:id` | все |
| `POST` | `/api/anime`, `/api/anime/:id/episodes` | ADMIN |
| `GET` / `POST` | `/api/genres` | все / ADMIN |
| `POST` | `/api/media/images` | авторизованные (постеры — ADMIN) |
| `POST` | `/api/media/videos` | ADMIN |

Ошибки всегда приходят в одном формате, внутренние детали наружу не попадают:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Ошибка валидации данных", "details": [] } }
```

## Структура

```
src/
  app.ts, index.ts        # сборка приложения / запуск сервера и graceful shutdown
  setup.ts                # CORS, rate limit, логи, ошибки, статика, OpenAPI
  config/env.ts           # валидация окружения (zod)
  database/               # клиент, схема, миграции, seed
  modules/<feature>/      # controller → service → repository (+ model: схемы и маппинг)
  shared/                 # ошибки, HTTP-утилиты, плагины (auth-guard, error-handler, ...)
scripts/dev-db.ts         # локальный Postgres на PGlite
tests/                    # интеграционные тесты через Eden Treaty
docs/ROADMAP.md           # аудит, план и статус работ
```

## Безопасность

Что проверяется тестами (подробности — в [аудите](docs/ROADMAP.md#2-аудит-текущего-состояния-на-коммите-d1235b4)):

- роли проверяются декларативно (`{ role: "ADMIN" }`), обычный пользователь получает 403;
- тип загружаемого файла определяется по содержимому, расширение — по реальному типу;
- email и username уникальны без учёта регистра; публичный профиль не раскрывает email;
- rate limit привязан к IP и не обходится подменой заголовков;
- ошибки базы и стек-трейсы остаются в логах, клиент получает `INTERNAL_ERROR`.
