/**
 * Catalog latency benchmark: runs typical requests through the whole app
 * (routing, validation, SQL, serialization) against the configured database.
 *
 *   bun run bench:catalog            # 50 runs per scenario after a warm-up
 */
import { app } from "@/app";
import { client } from "@/database";

const RUNS = Number(process.env.BENCH_RUNS ?? 50);
const WARMUP = 5;

const scenarios: Record<string, string> = {
  "catalog, popular (default)": "/api/anime",
  "search ru: атака титанов": `/api/anime?q=${encodeURIComponent("атака титанов")}`,
  "search typo: фрирэн": `/api/anime?q=${encodeURIComponent("фрирэн")}`,
  "search en: one piece": `/api/anime?q=${encodeURIComponent("one piece")}`,
  "search romaji: shingeki": "/api/anime?q=shingeki",
  "genres AND + sort by score": "/api/anime?genres=action&genres=fantasy&sort=score",
  "season + years + status": "/api/anime?season=FALL&yearFrom=2015&yearTo=2024&status=RELEASED",
  "search + filters": `/api/anime?q=${encodeURIComponent("магия")}&kind=TV&scoreMin=7`,
  "details by id": "/api/anime/1",
};

async function request(path: string) {
  const response = await app.handle(new Request(`http://bench.local${path}`));
  if (!response.ok) throw new Error(`${path} → ${response.status}: ${await response.text()}`);
  return (await response.json()) as { items?: unknown[]; nextCursor?: string | null };
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;

async function measure(run: () => Promise<unknown>) {
  for (let i = 0; i < WARMUP; i++) await run();
  const timings: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await run();
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  return {
    p50: percentile(timings, 50).toFixed(1),
    p95: percentile(timings, 95).toFixed(1),
    max: (timings.at(-1) ?? 0).toFixed(1),
  };
}

const results: Record<string, Record<string, string | number>> = {};

for (const [name, path] of Object.entries(scenarios)) {
  const sample = await request(path);
  results[name] = { hits: sample.items?.length ?? 1, ...(await measure(() => request(path))) };
}

// Deep pagination: the 10th page costs the same as the first thanks to keyset cursors
results["10th page via cursor (score)"] = {
  hits: 20,
  ...(await measure(async () => {
    let cursor: string | null | undefined;
    for (let page = 0; page < 10; page++) {
      const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      cursor = (await request(`/api/anime?sort=score${query}`)).nextCursor;
    }
  })),
};

console.log(`\nCatalog benchmark, ms (${RUNS} runs per scenario)`);
console.table(results);
await client.end();
