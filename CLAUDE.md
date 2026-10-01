# Yatoro API — заметки для Claude

Бэкенд аниме-кинотеки на Bun + Elysia + Drizzle + PostgreSQL. Проект для портфолио:
важны не только фичи, но и тесты, замеры, понятная история коммитов и документированные решения.
План и статус — [docs/ROADMAP.md](docs/ROADMAP.md), решения с замерами — [docs/adr/](docs/adr/).

Общение и документация — на русском. Комментарии в коде и сообщения коммитов — на английском.

## Окружение

- Windows + Git Bash. Docker локально нет: база для разработки — `bun run db:dev` (PGlite по протоколу Postgres).
- Bun стоит в `~/.bun/bin`; в свежей оболочке инструмента его может не быть в PATH: `export PATH="$HOME/.bun/bin:$PATH"`.
- `gh` авторизован как Retskey2 (`/c/Program Files/GitHub CLI/gh`, если не в PATH).

## Команды

- `bun run check` — lint + typecheck (TypeScript 7) + тесты. Запускать перед каждым коммитом.
- `bun run format` — автоисправления Biome.
- `bun run db:generate` → проверить и при необходимости поправить SQL → `bun run db:migrate`.
  `db:push` намеренно убран: он обходит миграции.
- `bun run catalog:import`, `bun run bench:catalog` — импорт из Shikimori и бенчмарк каталога.

## Git и PR

- `main` защищён ruleset-ом: только через PR и только с зелёными проверками
  `Lint · Types · Tests`, `Migrations & smoke test on PostgreSQL 18`, `Docker image`.
- Ветка на задачу (`feat/…`, `fix/…`, `chore/…`), Conventional Commits, автор — Retskey2 (настроен глобально).
- PR открывать через `gh pr create`; в описании — что сделано, как проверено, что не проверено.

## Конвенции кода

- Модуль: `controller` (роуты + схемы) → `service` (класс, бизнес-логика) → `repository` (объект с запросами) → `model` (TypeBox-схемы и маппинг).
- Ответы — через явные мапперы (`toAnimeSummary`, `toPublicUser`) и `response`-схемы: новые колонки не утекают наружу.
- Ошибки — только наследники `AppError` из `src/shared/errors.ts`; всё остальное клиент видит как `INTERNAL_ERROR`.
- Доступ — макросы `{ auth: true }` и `{ role: "ADMIN" }` из `src/shared/plugins/auth.ts`.
- Любое изменение каталога админом пишется в журнал через `AuditRepository.record(tx, …)` **в той же транзакции**;
  контекст (`actorId`, `requestId`) собирается в роуте через `auditContext(user, set)`.

## Грабли, на которые уже наступили

- **Elysia `macro(fn)` (v1) молча игнорируется в 1.4** — только объектный macro v2. Так ломалась проверка ролей (A1 в ROADMAP).
- **`t.UnionEnum` всегда ставит `default` = первое значение**: пропущенный необязательный параметр превращается в него.
  Для входных enum — `StringEnum` из `src/shared/http.ts`.
- **Drizzle рендерит `${table.column}` в коррелированном подзапросе как голое имя колонки** — внешнюю колонку квалифицировать вручную (`"anime"."id"`).
- **Drizzle кладёт SQL и параметры в текст ошибки** — наружу его не отдавать (это делает error-handler).
- **Миграции с новым `NOT NULL` для существующих таблиц** правятся руками: колонка nullable → заполнить → `SET NOT NULL`.
- **PGlite игнорирует стартовые параметры соединения** и требует явно подключать расширения:
  настройки сессии из `src/database/search.ts` применяются через `SET` в `tests/setup.ts` и `scripts/dev-db.ts`.
- **Keyset-пагинация**: у каждой сортировки свой индекс ровно по выражению `(ключ, id)` из `ORDER BY`, иначе каждая страница сортирует всю таблицу.
- **`@types/node` держим на ^24**: с 25.x `bun-types` 1.4 скрывает перегрузки `process.on/once`.
- **`elysia-rate-limit` держим на 4.x**: 5.x требует Elysia 2.

## Тесты

- `bun test` + PGlite в памяти (настоящий Postgres, те же миграции), запросы через Eden Treaty — типизированы.
- На каждую найденную ошибку — регрессионный тест. Тесты не ходят в сеть: внешние API подменяются (`fetch`, клиенты).
- Изменения, которые нельзя проверить на PGlite (поведение настоящего Postgres, Docker, сигналы), проверяет CI — добавлять туда шаг.
