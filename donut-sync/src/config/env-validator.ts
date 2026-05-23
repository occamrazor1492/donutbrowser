/**
 * Production environment validation.
 *
 * Why this exists: previously `sync.service.ts` and `team.service.ts` would
 * silently fall back to `S3_ACCESS_KEY_ID="minioadmin"` if the env var was
 * missing. In production that hides misconfiguration and connects to whatever
 * happens to respond on the configured endpoint with a well-known weak
 * credential. This validator forces an explicit value whenever
 * `NODE_ENV=production`.
 *
 * Local dev / CI is unaffected — `resolveProductionEnv` keeps returning the
 * developer-friendly default when `NODE_ENV` is anything other than
 * `production`.
 */

export type EnvMap = Record<string, string | undefined>;

const FORBIDDEN_PROD_VALUES = new Set<string>([
  "minioadmin",
  "undefined",
  "changeme",
  "null",
]);

export class MissingEnvError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[], message: string) {
    super(message);
    this.name = "MissingEnvError";
    this.missing = missing;
  }
}

function isProduction(env: EnvMap): boolean {
  return env.NODE_ENV === "production";
}

function isBlank(value: string | undefined): value is undefined | "" {
  return value === undefined || value.trim() === "";
}

function isForbiddenSentinel(value: string): boolean {
  return FORBIDDEN_PROD_VALUES.has(value.trim().toLowerCase());
}

/**
 * Assert that every key in `required` has a non-blank, non-sentinel value when
 * running in production. No-op in dev/test. Throws `MissingEnvError` listing
 * every problematic key so the operator sees them all at once instead of
 * having to fix-and-retry one at a time.
 */
export function assertProductionEnv(
  env: EnvMap,
  required: readonly string[],
): void {
  if (!isProduction(env)) {
    return;
  }

  const missing: string[] = [];
  const sentinels: string[] = [];

  for (const key of required) {
    const value = env[key];
    if (isBlank(value)) {
      missing.push(key);
      continue;
    }
    if (isForbiddenSentinel(value)) {
      sentinels.push(key);
    }
  }

  if (missing.length === 0 && sentinels.length === 0) {
    return;
  }

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(
      `Required env vars missing in production: ${missing.join(", ")}`,
    );
  }
  if (sentinels.length > 0) {
    parts.push(
      `Dev-only sentinel values (e.g. "minioadmin", "undefined") not allowed in production for: ${sentinels.join(
        ", ",
      )}`,
    );
  }
  throw new MissingEnvError([...missing, ...sentinels], parts.join(". "));
}

/**
 * In dev/test, returns `env[key] ?? devDefault`. In production, throws if the
 * value is blank or matches a known dev sentinel. Use this anywhere code
 * currently has a `|| "minioadmin"` style fallback.
 */
export function resolveProductionEnv(
  env: EnvMap,
  key: string,
  devDefault: string,
): string {
  const raw = env[key];

  if (!isProduction(env)) {
    return isBlank(raw) ? devDefault : raw;
  }

  if (isBlank(raw)) {
    throw new MissingEnvError(
      [key],
      `Required env var "${key}" is missing in production (no dev default allowed).`,
    );
  }
  if (isForbiddenSentinel(raw)) {
    throw new MissingEnvError(
      [key],
      `Env var "${key}" has dev-only value "${raw}" which is not allowed in production.`,
    );
  }
  return raw;
}
