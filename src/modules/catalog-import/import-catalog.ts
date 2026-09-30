/**
 * Catalog import from Shikimori.
 *
 *   bun run catalog:import                          # top 1000 by popularity (20 pages × 50)
 *   bun run catalog:import --pages 5                # top 250
 *   bun run catalog:import --status ongoing --pages 10   # refresh airing shows
 */
import { parseArgs } from "node:util";
import { env } from "@/config/env";
import { client } from "@/database";
import { logger } from "@/shared/logger";
import { CatalogImportService } from "./catalog-import.service";
import { type AnimePageRequest, ShikimoriClient, type ShikimoriOrder } from "./shikimori.client";

const { values } = parseArgs({
  options: {
    pages: { type: "string", default: "20" },
    "start-page": { type: "string", default: "1" },
    limit: { type: "string", default: "50" },
    order: { type: "string", default: "popularity" },
    status: { type: "string" },
  },
});

const pages = Number(values.pages);
const startPage = Number(values["start-page"]);
const limit = Number(values.limit);
const order = values.order as ShikimoriOrder;
const status = values.status as AnimePageRequest["status"];

const service = new CatalogImportService(
  new ShikimoriClient({ userAgent: env.SHIKIMORI_USER_AGENT }),
);

const total = { fetched: 0, imported: 0, skipped: 0 };
const startedAt = performance.now();

for (let page = startPage; page < startPage + pages; page++) {
  const stats = await service.importPage({ page, limit, order, status });
  total.fetched += stats.fetched;
  total.imported += stats.imported;
  total.skipped += stats.skipped;

  logger.info({ page, ...stats }, "catalog page imported");
  if (stats.fetched < limit) break; // last page
}

logger.info(
  { ...total, seconds: Math.round((performance.now() - startedAt) / 1000) },
  "catalog import finished",
);
await client.end();
