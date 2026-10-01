import { expect, it } from "bun:test";
import { app } from "@/app";

it("serves the demo page", async () => {
  const response = await app.handle(new Request("http://localhost/demo"));
  const html = await response.text();

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  // The player and the endpoints the page relies on
  expect(html).toContain("hls.js@1.7.3");
  expect(html).toMatch(/\/episodes\/\$\{episode\.number\}\/video/);
  expect(html).toMatch(/\$\{base\}\/upload/);
  expect(html).toMatch(/\$\{base\}\/complete/);
  // Catalog data comes from an external source: the page must never inject it as HTML
  expect(html).not.toMatch(/\.innerHTML\s*=/);
});
