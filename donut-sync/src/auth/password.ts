import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const ITERATIONS = 120000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const key = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
  return `pbkdf2$${ITERATIONS}$${salt}$${key.toString("hex")}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [scheme, iterationsRaw, salt, expectedRaw] = encoded.split("$");
  if (scheme !== "pbkdf2" || !iterationsRaw || !salt || !expectedRaw) {
    return false;
  }

  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  const expected = Buffer.from(expectedRaw, "hex");
  const actual = pbkdf2Sync(
    password,
    salt,
    iterations,
    expected.length,
    DIGEST,
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
