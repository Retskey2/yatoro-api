// Negative checks: the storage must refuse what it should refuse
const servers = [
  { name: "rustfs", endpoint: "http://127.0.0.1:9200", key: "rustfs", secret: "rustfs-secret-123" },
  { name: "seaweedfs", endpoint: "http://127.0.0.1:9300", key: "seaweed", secret: "seaweed-secret-123" },
];

for (const server of servers) {
  const s3 = new Bun.S3Client({
    endpoint: server.endpoint,
    accessKeyId: server.key,
    secretAccessKey: server.secret,
    bucket: "yatoro-test",
    region: "us-east-1",
  });

  const results: Record<string, string> = {};

  const preflight = await fetch(s3.presign("x.bin", { method: "PUT", expiresIn: 600 }), {
    method: "OPTIONS",
    headers: { origin: "http://evil.example", "access-control-request-method": "PUT" },
  });
  const allow = preflight.headers.get("access-control-allow-origin");
  results["CORS for a foreign origin"] = allow ? `❌ allowed: ${allow}` : `✅ refused (HTTP ${preflight.status})`;

  const url = new URL(s3.presign("upload.bin", { method: "GET", expiresIn: 600 }));
  const signature = url.searchParams.get("X-Amz-Signature") ?? "";
  url.searchParams.set("X-Amz-Signature", `${signature.slice(0, -4)}0000`);
  const tampered = await fetch(url);
  results["tampered signature"] = tampered.status === 403 ? "✅ HTTP 403" : `❌ HTTP ${tampered.status}`;

  const otherKey = new URL(s3.presign("upload.bin", { method: "GET", expiresIn: 600 }));
  otherKey.pathname = otherKey.pathname.replace("upload.bin", "hello.txt");
  const swapped = await fetch(otherKey);
  results["signature reused for another key"] =
    swapped.status === 403 ? "✅ HTTP 403" : `❌ HTTP ${swapped.status}`;

  const expiring = s3.presign("upload.bin", { method: "GET", expiresIn: 1 });
  await Bun.sleep(2500);
  const expired = await fetch(expiring);
  results["expired URL"] = expired.status === 403 ? "✅ HTTP 403" : `❌ HTTP ${expired.status}`;

  const anonymous = await fetch(`${server.endpoint}/yatoro-test/upload.bin`);
  results["anonymous read of a private bucket"] =
    anonymous.status === 403 ? "✅ HTTP 403" : `❌ HTTP ${anonymous.status}`;

  console.log(`\n=== ${server.name}`);
  console.table(results);
}
