const UNIQUE_VIOLATION = "23505";

/**
 * Drizzle wraps driver errors (DrizzleQueryError), so the Postgres error code
 * may sit somewhere down the `cause` chain.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current !== "object") return false;
    if ("code" in current && current.code === UNIQUE_VIOLATION) return true;
    current = "cause" in current ? current.cause : undefined;
  }

  return false;
}
