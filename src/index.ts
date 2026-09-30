import { app } from "./app";
import { env } from "./config/env";
import { client } from "./database";
import { logger } from "./shared/logger";

app.listen(env.PORT, (server) => {
  const url = `http://${server.hostname}:${server.port}`;
  logger.info(`🦊 Yatoro API запущен: ${url}`);
  logger.info(`📚 Документация OpenAPI: ${url}/docs`);
});

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests finish,
 * then close the database pool. Docker sends SIGTERM, Ctrl+C sends SIGINT.
 */
async function shutdown(signal: NodeJS.Signals) {
  logger.info(`${signal}: останавливаю сервер`);

  const forceExit = setTimeout(() => {
    logger.error("Не удалось остановиться за 10 с, выхожу принудительно");
    process.exit(1);
  }, 10_000);

  await app.stop();
  await client.end({ timeout: 5 });

  clearTimeout(forceExit);
  logger.info("Сервер остановлен");
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal));
}
