import { rateLimit } from "elysia-rate-limit";
import { env } from "@/config/env";
import { TooManyRequestsError } from "@/shared/errors";

/** Requests per minute for each bucket */
const LIMITS = {
  auth: 10,
  api: 120,
} as const;

type Bucket = keyof typeof LIMITS;

interface PeerInfo {
  requestIP(request: Request): { address: string } | null;
}

/**
 * Client address used as the rate-limit key.
 *
 * Request headers are client-controlled, so they are trusted only behind our own
 * reverse proxy (TRUST_PROXY). The proxy appends the real peer address, therefore
 * the LAST X-Forwarded-For entry is used: the leading ones can be forged by the client.
 */
export function getClientIp(
  request: Request,
  server: PeerInfo | null,
  trustProxy: boolean = env.TRUST_PROXY,
): string {
  if (trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (forwarded) return forwarded;
  }

  return server?.requestIP(request)?.address ?? "unknown";
}

const bucketOf = (request: Request): Bucket =>
  new URL(request.url).pathname.startsWith("/api/auth/") ? "auth" : "api";

export const rateLimiter = rateLimit({
  duration: 60_000,
  // Key format: "<bucket>|<ip>" — `|` never appears in IPv4/IPv6 addresses
  max: (key) => LIMITS[key.split("|", 1)[0] as Bucket] ?? LIMITS.api,
  generator: (request, server) => `${bucketOf(request)}|${getClientIp(request, server)}`,
  errorResponse: new TooManyRequestsError(),
  skip: () => !env.RATE_LIMIT_ENABLED,
  scoping: "global",
});
