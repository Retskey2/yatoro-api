# Эксперименты к ADR 0002

Скрипты, на которых основаны выводы [ADR 0002](../0002-video-pipeline-infrastructure.md).
Они не входят в проект (не проверяются линтером и типами, зависимости ставятся отдельно).

## Запуск

```bash
# временная папка с зависимостями
mkdir exp && cd exp && cp ../docs/adr/0002-experiments/* .
bun init -y && bun add pg-boss@12 bullmq@6 ioredis @aws-sdk/client-s3 @electric-sql/pglite@0.5.8 postgres@3.4.9 drizzle-orm@0.45.3

# окружение
docker run -d --name exp-rustfs  -p 9200:9000 -e RUSTFS_ACCESS_KEY=rustfs -e RUSTFS_SECRET_KEY=rustfs-secret-123 rustfs/rustfs:latest /data
docker run -d --name exp-seaweed -p 9300:8333 -v "$PWD/seaweed-s3.json:/etc/s3.json:ro" \
  chrislusf/seaweedfs:latest server -s3 -s3.config=/etc/s3.json -dir=/data
docker run -d --name exp-pg      -p 55432:5432 -e POSTGRES_PASSWORD=pg postgres:18-alpine
docker run -d --name exp-redis   -p 56379:6379 redis:8-alpine

bun s3-compat.ts      # S3-функции, нужные пайплайну
bun s3-negative.ts    # что хранилище обязано отклонять
bun pgboss-test.ts    # pg-boss: postgres-js, транзакции, повторы, PGlite
bun bullmq-test.ts    # BullMQ на Bun и проблема двойной записи
```

## Результаты (01.10.2026, Windows 11 + Docker Desktop 29.8, Bun 1.4.2)

| Скрипт | RustFS 1.0.1-preview | SeaweedFS 4.48 |
|---|---|---|
| `s3-compat.ts` — бакет, CORS, запись/чтение, PUT/GET по подписи, Range 206, multipart 16 МиБ | все ✅ | все ✅ |
| `s3-compat.ts` — подпись ссылки | 5,9 мкс | 6,2 мкс |
| `s3-negative.ts` — чужой origin, подделанная/чужая/истёкшая подпись, анонимное чтение | все → 403 | все → 403 |

| Скрипт | Результат |
|---|---|
| `pgboss-test.ts` (PostgreSQL 18) | старт ✅, откат транзакции → 0 задач ✅, коммит → задача + строка ✅, повтор после ошибки ✅ (подхват ~0,5 с) |
| `pgboss-test.ts` (PGlite) | старт, отправка, получение, завершение ✅ |
| `bullmq-test.ts` | повтор после ошибки ✅ (подхват 17 мс); **после отката транзакции в БД задача осталась** ⚠ |
