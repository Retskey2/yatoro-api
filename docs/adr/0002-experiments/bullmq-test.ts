// BullMQ + Redis on Bun, and the dual-write problem with a database transaction
import { Queue, Worker } from "bullmq";
import postgres from "postgres";

const connection = { host: "127.0.0.1", port: 56379 };
const results: Record<string, string> = {};

const queue = new Queue("transcode", { connection });
await queue.obliterate({ force: true });

// 1. Basic processing with a retry
const attempts: number[] = [];
const sentAt = Date.now();
const done = new Promise<void>((resolve, reject) => {
  const worker = new Worker(
    "transcode",
    async () => {
      attempts.push(Date.now());
      if (attempts.length === 1) throw new Error("ffmpeg crashed");
    },
    { connection },
  );
  worker.on("completed", async () => {
    await worker.close();
    resolve();
  });
  setTimeout(() => reject(new Error("timeout")), 15_000);
});
await queue.add("episode", { episodeId: 1 }, { attempts: 3, backoff: { type: "fixed", delay: 200 } });
try {
  await done;
  results["works on Bun, retry then success"] =
    `✅ ${attempts.length} attempts, picked up after ${attempts[0]! - sentAt} ms`;
} catch (error) {
  results["works on Bun, retry then success"] = `❌ ${(error as Error).message}`;
}

// 2. Dual write: the queue is outside the database transaction
const sql = postgres("postgresql://postgres:pg@127.0.0.1:55432/postgres", { max: 1, onnotice: () => {} });
await sql`drop table if exists exp_bull_episodes`;
await sql`create table exp_bull_episodes (id int primary key, status text)`;
try {
  await sql.begin(async (tx) => {
    await tx`insert into exp_bull_episodes values (2, 'PROCESSING')`;
    await queue.add("episode", { episodeId: 2 });
    throw new Error("rollback on purpose");
  });
} catch {}
const [{ count } = { count: 0 }] = await sql`select count(*)::int as count from exp_bull_episodes`;
const waiting = await queue.getWaitingCount();
results["rolled-back DB transaction"] =
  waiting > 0 && count === 0
    ? `⚠ orphan job: ${waiting} waiting job(s), 0 rows — needs an outbox table to be safe`
    : `rows=${count}, waiting=${waiting}`;

console.table(results);
await queue.obliterate({ force: true });
await queue.close();
await sql.end();
process.exit(0);
