# SeaweedFS (S3) для локального стека

`s3.json` — учётные данные S3 **только для локальной разработки** (`docker compose`).
SeaweedFS берёт их из файла, а не из переменных окружения, поэтому файл лежит в репозитории.
Значения должны совпадать с `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` сервиса `api` в `docker-compose.yml`.

Для любого окружения, кроме локального, нужен свой файл с другими ключами.
Почему SeaweedFS, а не MinIO, — [ADR 0002](../../docs/adr/0002-video-pipeline-infrastructure.md).
