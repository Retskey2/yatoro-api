import { describe, expect, it } from "bun:test";
import { ServiceUnavailableError } from "@/shared/errors";
import { bucketCorsRules, getStorage, isStorageReachable, requireStorage } from "@/shared/storage";
import { client } from "./helpers";

// Tests run without S3: the real storage is exercised by the docker compose job in CI

describe("storage is optional", () => {
  it("is disabled when S3_ENDPOINT is not set", async () => {
    expect(getStorage()).toBeNull();
    expect(await isStorageReachable()).toBeNull();
  });

  it("answers 503 instead of crashing when a feature needs it", () => {
    expect(() => requireStorage()).toThrow(ServiceUnavailableError);
  });

  it("is reported as disabled, not as a failure, by /health", async () => {
    const { status, data } = await client.health.get();

    expect(status).toBe(200);
    expect(data).toMatchObject({ status: "ok", database: "up", storage: "disabled" });
  });
});

describe("bucket CORS", () => {
  it("lets the given frontends upload and read, and exposes ETag", () => {
    const [rule] = bucketCorsRules(["http://localhost:3000", "http://localhost:5084"]);

    expect(rule?.AllowedOrigins).toEqual(["http://localhost:3000", "http://localhost:5084"]);
    expect(rule?.AllowedMethods).toEqual(["GET", "HEAD", "PUT"]);
    // Browsers need ETag to confirm what they uploaded
    expect(rule?.ExposeHeaders).toContain("ETag");
    expect(rule?.AllowedMethods).not.toContain("DELETE");
  });
});
