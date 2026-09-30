import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./shared/logger";

app.listen(env.PORT, (server) => {
  const url = `http://${server.hostname}:${server.port}`;
  logger.info(`🦊 Yatoro API запущен: ${url}`);
  logger.info(`📚 Документация OpenAPI: ${url}/docs`);
});
