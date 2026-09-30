/**
 * Minimal Shikimori GraphQL client.
 *
 * API rules (https://shikimori.io/api/doc): at most 5 rps and 90 rpm, the User-Agent must
 * name the application, never mimic a browser. We keep ≥ 700 ms between requests (≈ 85 rpm)
 * and retry 429/5xx/network errors with exponential backoff, honouring Retry-After.
 */

export interface ShikimoriAnime {
  id: string;
  malId: string | null;
  name: string;
  russian: string | null;
  english: string | null;
  japanese: string | null;
  synonyms: string[] | null;
  kind: string | null;
  status: string | null;
  episodes: number;
  episodesAired: number;
  duration: number | null;
  rating: string | null;
  score: number | null;
  /** e.g. "fall_2023" */
  season: string | null;
  airedOn: { date: string | null; year: number | null } | null;
  releasedOn: { date: string | null } | null;
  poster: { originalUrl: string | null } | null;
  genres: { id: string; name: string; russian: string; kind: string }[] | null;
  studios: { id: string; name: string }[] | null;
  description: string | null;
}

export type ShikimoriOrder = "popularity" | "ranked" | "aired_on" | "id";

export interface AnimePageRequest {
  page: number;
  limit: number;
  order: ShikimoriOrder;
  status?: "anons" | "ongoing" | "released";
}

const ANIMES_QUERY = `
  query Animes($page: PositiveInt!, $limit: PositiveInt!, $order: OrderEnum!, $status: AnimeStatusString, $kind: AnimeKindString) {
    animes(page: $page, limit: $limit, order: $order, status: $status, kind: $kind, censored: true) {
      id malId name russian english japanese synonyms
      kind status episodes episodesAired duration rating score season
      airedOn { date year } releasedOn { date }
      poster { originalUrl }
      genres { id name russian kind }
      studios { id name }
      description
    }
  }`;

/** Promo videos (pv) and commercials (cm) are not titles, so they are never requested */
const IMPORTED_KINDS = "tv,movie,ova,ona,special,tv_special,music";

export class ShikimoriApiError extends Error {}

export interface ShikimoriClientOptions {
  userAgent: string;
  baseUrl?: string;
  minIntervalMs?: number;
  maxAttempts?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class ShikimoriClient {
  private readonly baseUrl: string;
  private readonly minIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastRequestAt = 0;

  constructor(private readonly options: ShikimoriClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://shikimori.io";
    this.minIntervalMs = options.minIntervalMs ?? 700;
    this.maxAttempts = options.maxAttempts ?? 4;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? Bun.sleep;
  }

  async fetchAnimePage(request: AnimePageRequest): Promise<ShikimoriAnime[]> {
    const data = await this.graphql<{ animes: ShikimoriAnime[] }>(ANIMES_QUERY, {
      ...request,
      kind: IMPORTED_KINDS,
    });
    return data.animes;
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      await this.throttle();

      let retryAfterMs: number | undefined;
      try {
        const response = await this.fetch(`${this.baseUrl}/api/graphql`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": this.options.userAgent,
          },
          body: JSON.stringify({ query, variables }),
        });

        if (response.ok) {
          const text = await response.text();
          // Under load the API sometimes answers 200 with an empty body — treat it as retryable
          if (text) {
            const body = JSON.parse(text) as { data?: T; errors?: { message: string }[] };
            if (body.errors?.length) {
              throw new ShikimoriApiError(body.errors.map((error) => error.message).join("; "));
            }
            if (body.data) return body.data;
          }
        } else if (response.status !== 429 && response.status < 500) {
          throw new ShikimoriApiError(`HTTP ${response.status}`);
        } else {
          const retryAfter = Number(response.headers.get("retry-after"));
          if (retryAfter > 0) retryAfterMs = retryAfter * 1000;
        }
      } catch (error) {
        // Client errors and GraphQL errors will not fix themselves: fail fast
        if (error instanceof ShikimoriApiError) throw error;
      }

      if (attempt >= this.maxAttempts) {
        throw new ShikimoriApiError(`Shikimori API is unavailable after ${attempt} attempts`);
      }

      await this.sleep(retryAfterMs ?? 1000 * 2 ** (attempt - 1));
    }
  }

  private async throttle() {
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = Date.now();
  }
}
