// pg-boss on Bun: our postgres-js driver, transactional enqueue, retries, PGlite
import { PGlite } from "@electric-sql/pglite";
import { sql as dsql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgBoss } from "pg-boss";
import postgres from "postgres";

type Executor = { execute: (query: SQL) => Promise<unknown> };

/**
 * pg-boss speaks `$1`-style SQL; parameterized queries go through Drizzle so they join our
 * transactions. Parameterless SQL (pg-boss's own schema migrations) contains several statements
 * and needs the simple query protocol, which prepared statements don't allow.
 */
const viaDrizzle = (executor: Executor) => ({
  executeSql: async (text: string, values: unknown[] = []) => {
    if (values.length === 0) {
      // Contains BEGIN/COMMIT: postgres-js only allows that on a dedicated connection
      const reserved = await client.reserve();
      try {
        const result = await reserved.unsafe(text).simple();
        const last = Array.isArray(result.at?.(-1)) ? result.at(-1) : result;
        return { rows: [...(last as unknown[])] };
      } finally {
        reserved.release();
      }
    }
    const parts = text.split(/\$(\d+)/);
    // sql.param keeps a JS array as ONE parameter (a Postgres array); a bare ${array}
    // would be expanded by Drizzle into a list ($1, $2, ...)
    // `pg` serializes plain objects to JSON by itself; postgres-js needs it done explicitly
    const toParam = (value: unknown) =>
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      !(value instanceof Uint8Array)
        ? JSON.stringify(value)
        : value;
    const chunks = parts.map((part, i) =>
      i % 2 === 0 ? dsql.raw(part) : dsql`${dsql.param(toParam(values[Number(part) - 1]))}`,
    );
    const result = await executor.execute(dsql.join(chunks, dsql.raw("")));
    return { rows: Array.isArray(result) ? result : (result as { rows: unknown[] }).rows };
  },
});

const results: Record<string, string> = {};
const check = async (name: string, fn: () => Promise<string>) => {
  try {
    results[name] = `✅ ${await fn()}`;
  } catch (error) {
    const cause = (error as { cause?: Error }).cause;
    results[name] = `❌ ${(cause ?? (error as Error)).message.slice(0, 110)}`;
  }
};

// ---------- real PostgreSQL 18 via postgres-js + Drizzle ----------
const client = postgres("postgresql://postgres:pg@127.0.0.1:55432/postgres", { max: 5, onnotice: () => {} });
const db = drizzle(client);
await db.execute(dsql`drop table if exists exp_episodes; create table exp_episodes (id int primary key, status text)`);

const boss = new PgBoss({ db: viaDrizzle(db) });
boss.on("error", (error) => console.error("pg-boss error:", (error as { cause?: Error }).cause?.message ?? error.message, "| query starts:", error.message.slice(14, 120).replace(/s+/g, " ")));

await check("start on Bun with postgres-js (custom db adapter)", async () => {
  await boss.start();
  await boss.createQueue("transcode", { retryLimit: 2, retryDelay: 1 });
  return "schema pgboss created";
});

await check("rolled-back transaction leaves no job", async () => {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(dsql`insert into exp_episodes values (1, 'PROCESSING')`);
      await boss.send("transcode", { episodeId: 1 }, { db: viaDrizzle(tx) });
      throw new Error("rollback on purpose");
    });
  } catch {}
  const jobs = await boss.fetch("transcode");
  if (jobs.length > 0) throw new Error(`found ${jobs.length} orphan job(s)`);
  return "0 jobs, 0 rows";
});

await check("committed transaction: status + job together", async () => {
  await db.transaction(async (tx) => {
    await tx.execute(dsql`insert into exp_episodes values (2, 'PROCESSING')`);
    await boss.send("transcode", { episodeId: 2 }, { db: viaDrizzle(tx) });
  });
  const jobs = await boss.fetch("transcode");
  if (jobs.length !== 1) throw new Error(`expected 1 job, got ${jobs.length}`);
  await boss.complete("transcode", jobs[0]!.id);
  return "1 job, completed";
});

await check("retry after a failing attempt, then success", async () => {
  const attempts: number[] = [];
  const done = new Promise<void>((resolve) => {
    boss.work("transcode", { pollingIntervalSeconds: 0.5 }, async ([job]) => {
      attempts.push(Date.now());
      if (attempts.length === 1) throw new Error("ffmpeg crashed");
      resolve();
      return job?.data;
    });
  });
  const sentAt = Date.now();
  const jobId = await boss.send("transcode", { episodeId: 3 });
  try {
    await Promise.race([done, Bun.sleep(15_000).then(() => Promise.reject(new Error("timeout")))]);
  } catch (error) {
    const job = await boss.getJobById("transcode", jobId ?? "");
    throw new Error(
      `${(error as Error).message}: attempts=${attempts.length} state=${job?.state} retryCount=${job?.retryCount} startAfter=${job?.startAfter?.toISOString?.()}`,
    );
  }
  return `${attempts.length} attempts, picked up after ${attempts[0]! - sentAt} ms`;
});

await boss.stop({ graceful: true, wait: true });
await client.end();

// ---------- PGlite (what our tests use) ----------
await check("PGlite: start + send + fetch + complete", async () => {
  const pglite = new PGlite();
  const liteBoss = new PgBoss({
    db: {
      executeSql: async (text: string, values: unknown[] = []) => {
        if (values.length > 0) return pglite.query(text, values);
        const results = await pglite.exec(text);
        return { rows: results.at(-1)?.rows ?? [] };
      },
    },
  });
  await liteBoss.start();
  await liteBoss.createQueue("transcode");
  const id = await liteBoss.send("transcode", { episodeId: 4 });
  const [job] = await liteBoss.fetch("transcode");
  if (job?.id !== id) throw new Error("job mismatch");
  await liteBoss.complete("transcode", job.id);
  await liteBoss.stop({ graceful: false, wait: true });
  await pglite.close();
  return "ok";
});

console.table(results);
process.exit(0);
