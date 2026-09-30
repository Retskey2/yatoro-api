# Yatoro API

Бэкенд аниме-кинотеки на **Bun + Elysia**: каталог с жанрами и сериями, пользователи с ролями,
загрузка медиа. В планах — адаптивный стриминг (HLS), полнотекстовый поиск и совместный просмотр
([ROADMAP](docs/ROADMAP.md)).

## Стек

| Слой | Технологии |
|---|---|
| Рантайм и HTTP | Bun 1.4, Elysia 1.4 (macro v2, TypeBox-валидация, OpenAPI/Scalar) |
| База данных | PostgreSQL, Drizzle ORM 0.45 + drizzle-kit (миграции) |
| Авторизация | JWT (access-токен с TTL), argon2id через `Bun.password`, иерархия ролей USER < MODERATOR < ADMIN |
| Качество | TypeScript 7 (нативный `tsc`), Biome, `bun test` + PGlite, Eden Treaty |
| Наблюдаемость | pino (JSON-логи), `X-Request-Id` на каждый запрос |

## Быстрый старт

Нужны [Bun](https://bun.sh) ≥ 1.4 и PostgreSQL.

```bash
bun install
cp .env.example .env        # укажите DATABASE_URL и JWT_SECRET (≥ 32 символов)
bun run db:migrate
bun run dev
```

- API: http://localhost:5084/api
- Документация (OpenAPI/Scalar): http://localhost:5084/docs

## Скрипты

| Команда | Что делает |
|---|---|
| `bun run dev` | Сервер с перезапуском при изменениях |
| `bun run check` | Линтер + проверка типов + тесты |
| `bun test` | Тесты на настоящем Postgres (PGlite в памяти, Docker не нужен) |
| `bun run db:generate` | Сгенерировать миграцию из изменений схемы |
| `bun run db:migrate` | Применить миграции |

## API

| Метод | Путь | Доступ |
|---|---|---|
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
  app.ts, index.ts        # сборка приложения / запуск сервера
  setup.ts                # CORS, rate limit, логи, ошибки, статика, OpenAPI
  config/env.ts           # валидация окружения (zod)
  database/               # клиент, схема, миграции
  modules/<feature>/      # controller → service → repository (+ model: схемы и маппинг)
  shared/                 # ошибки, HTTP-утилиты, плагины (auth-guard, error-handler, ...)
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
