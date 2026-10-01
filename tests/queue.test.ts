import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { PgBoss } from "pg-boss";
import { db } from "@/database";
import { enqueue, QUEUES, startJobQueue } from "@/queue";

let boss: PgBoss;

beforeAll(async () => {
  boss = await startJobQueue();
});

beforeEach(async () => {
  await boss.deleteAllJobs(QUEUES.transcode);
});

const job = { episodeId: 7, sourceKey: "videos/7/source.mp4" };

describe("job queue (pg-boss on PostgreSQL)", () => {
  it("drops the job when the surrounding transaction rolls back", async () => {
    // The reason for a PostgreSQL queue (ADR 0002): no orphan job without its episode change
    await db
      .transaction(async (tx) => {
        await enqueue(tx, QUEUES.transcode, job);
        throw new Error("rollback on purpose");
      })
      .catch(() => {});

    expect(await boss.fetch(QUEUES.transcode)).toEqual([]);
  });

  it("keeps the job when the transaction commits, with the data intact", async () => {
    await db.transaction(async (tx) => {
      await enqueue(tx, QUEUES.transcode, job);
    });

    const [fetched] = await boss.fetch(QUEUES.transcode);
    // jsonb may reorder keys, so compare by content
    expect(fetched?.data).toEqual(job);
  });

  it("schedules a retry for a failed job instead of leaving it stuck in `active`", async () => {
    // ADR 0002: with a hand-written adapter, fail() with an object payload crashed and
    // the job silently stayed `active` until it expired
    await db.transaction(async (tx) => {
      await enqueue(tx, QUEUES.transcode, job);
    });
    const [fetched] = await boss.fetch(QUEUES.transcode);
    await boss.fail(QUEUES.transcode, fetched?.id ?? "", { message: "ffmpeg crashed", code: 1 });

    const after = await boss.getJobById(QUEUES.transcode, fetched?.id ?? "");
    expect(after?.state).toBe("retry");
    expect(after?.retryLimit).toBe(2);
  });

  it("is safe to start twice (API and worker start at the same moment)", async () => {
    expect(await startJobQueue()).toBe(boss);
    await boss.createQueue(QUEUES.transcode, { retryLimit: 2 });
    expect((await boss.getQueue(QUEUES.transcode))?.name).toBe(QUEUES.transcode);
  });
});
