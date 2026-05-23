import {
  assertProductionEnv,
  MissingEnvError,
  resolveProductionEnv,
} from "./env-validator.js";

const requiredKeys = [
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "JWT_SECRET",
  "DATABASE_URL",
] as const;

function buildEnv(overrides: Record<string, string | undefined> = {}) {
  const base: Record<string, string> = {
    NODE_ENV: "production",
    MULTI_USER_ENABLED: "true",
    S3_ACCESS_KEY_ID: "real-key",
    S3_SECRET_ACCESS_KEY: "real-secret",
    JWT_SECRET: "real-jwt-secret",
    DATABASE_URL: "postgres://prod-db",
    BACKEND_INTERNAL_KEY: "real-internal-key",
  };
  const merged: Record<string, string> = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete merged[k];
    } else {
      merged[k] = v;
    }
  }
  return merged;
}

describe("env-validator", () => {
  describe("assertProductionEnv", () => {
    it("does nothing when NODE_ENV is not production", () => {
      expect(() =>
        assertProductionEnv({ NODE_ENV: "development" }, requiredKeys),
      ).not.toThrow();
      expect(() =>
        assertProductionEnv({ NODE_ENV: "test" }, requiredKeys),
      ).not.toThrow();
      // Missing NODE_ENV is treated as non-prod.
      expect(() => assertProductionEnv({}, requiredKeys)).not.toThrow();
    });

    it("passes when all required vars are set in production", () => {
      expect(() => assertProductionEnv(buildEnv(), requiredKeys)).not.toThrow();
    });

    it("throws MissingEnvError when a required var is undefined", () => {
      const env = buildEnv({ S3_ACCESS_KEY_ID: undefined });
      expect(() => assertProductionEnv(env, requiredKeys)).toThrow(
        MissingEnvError,
      );
    });

    it("throws when a required var is empty string", () => {
      const env = buildEnv({ S3_SECRET_ACCESS_KEY: "" });
      expect(() => assertProductionEnv(env, requiredKeys)).toThrow(
        MissingEnvError,
      );
    });

    it("throws when a required var is whitespace-only", () => {
      const env = buildEnv({ JWT_SECRET: "   " });
      expect(() => assertProductionEnv(env, requiredKeys)).toThrow(
        MissingEnvError,
      );
    });

    it("MissingEnvError lists every missing key in one message", () => {
      const env = buildEnv({
        S3_ACCESS_KEY_ID: undefined,
        S3_SECRET_ACCESS_KEY: "",
      });
      try {
        assertProductionEnv(env, requiredKeys);
        fail("expected MissingEnvError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(MissingEnvError);
        const e = err as MissingEnvError;
        expect(e.missing).toEqual(["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]);
        expect(e.message).toContain("S3_ACCESS_KEY_ID");
        expect(e.message).toContain("S3_SECRET_ACCESS_KEY");
      }
    });

    it("rejects the legacy minioadmin/undefined sentinel defaults in production", () => {
      const env = buildEnv({ S3_ACCESS_KEY_ID: "minioadmin" });
      expect(() => assertProductionEnv(env, requiredKeys)).toThrow(
        /minioadmin.*not allowed.*production/i,
      );

      const env2 = buildEnv({ S3_SECRET_ACCESS_KEY: "minioadmin" });
      expect(() => assertProductionEnv(env2, requiredKeys)).toThrow(
        /minioadmin.*not allowed.*production/i,
      );

      const env3 = buildEnv({ BACKEND_INTERNAL_KEY: "undefined" });
      expect(() =>
        assertProductionEnv(env3, [...requiredKeys, "BACKEND_INTERNAL_KEY"]),
      ).toThrow(/sentinel.*not allowed/i);
    });

    it("MissingEnvError extends Error and is catchable", () => {
      const err = new MissingEnvError(["FOO", "BAR"], "missing");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("MissingEnvError");
      expect(err.missing).toEqual(["FOO", "BAR"]);
    });
  });

  describe("resolveProductionEnv (developer-friendly defaults)", () => {
    it("returns the explicit value when provided", () => {
      expect(
        resolveProductionEnv(
          { NODE_ENV: "development", S3_ACCESS_KEY_ID: "myKey" },
          "S3_ACCESS_KEY_ID",
          "minioadmin",
        ),
      ).toBe("myKey");
    });

    it("returns the dev default when NODE_ENV != production", () => {
      expect(
        resolveProductionEnv(
          { NODE_ENV: "development" },
          "S3_ACCESS_KEY_ID",
          "minioadmin",
        ),
      ).toBe("minioadmin");
    });

    it("throws in production if value missing, even with a default supplied", () => {
      expect(() =>
        resolveProductionEnv(
          { NODE_ENV: "production" },
          "S3_ACCESS_KEY_ID",
          "minioadmin",
        ),
      ).toThrow(MissingEnvError);
    });

    it("throws in production if value equals the dev sentinel", () => {
      expect(() =>
        resolveProductionEnv(
          { NODE_ENV: "production", S3_ACCESS_KEY_ID: "minioadmin" },
          "S3_ACCESS_KEY_ID",
          "minioadmin",
        ),
      ).toThrow(/minioadmin/);
    });

    it("returns the explicit value in production when valid (happy path)", () => {
      expect(
        resolveProductionEnv(
          { NODE_ENV: "production", S3_ACCESS_KEY_ID: "real-prod-key" },
          "S3_ACCESS_KEY_ID",
          "minioadmin",
        ),
      ).toBe("real-prod-key");
    });
  });
});
