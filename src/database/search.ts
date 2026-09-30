/**
 * Minimal word similarity for the trigram part of catalog search.
 *
 * The `<%` operator (the only form the trigram GIN index can serve) reads its threshold
 * from the `pg_trgm.word_similarity_threshold` setting, default 0.6. That cuts off
 * common typos: "фрирэн" vs "фрирен" scores 0.57.
 *
 * Measured on 20k titles: 0.4 lets typos through but also noise ("shingeki" matched
 * 781 rows, e.g. "Shinseiki Evangelion" at 0.44); 0.5 keeps the typos and drops the noise
 * (300 rows, all relevant).
 */
export const TRIGRAM_THRESHOLD = 0.5;

/** Applied per session: startup parameter for postgres-js, `SET` for in-process PGlite */
export const SEARCH_SESSION_SETTINGS = {
  "pg_trgm.word_similarity_threshold": TRIGRAM_THRESHOLD,
};

export const SEARCH_SESSION_SQL = `SET pg_trgm.word_similarity_threshold = ${TRIGRAM_THRESHOLD}`;
