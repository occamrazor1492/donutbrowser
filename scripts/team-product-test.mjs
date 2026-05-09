#!/usr/bin/env node

const BASE_URL = (
  process.env.TEAM_TEST_BASE_URL || "http://127.0.0.1:12342"
).replace(/\/$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";
const RUN_ID =
  process.env.TEAM_TEST_RUN_ID ||
  `product-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const state = {
  adminToken: "",
  aToken: "",
  bToken: "",
  userIds: [],
  profileId: "",
  assetId: "",
};

const passed = [];

function log(message) {
  console.log(`[team-product-test] ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestJson(method, path, options = {}) {
  const expected = Array.isArray(options.expected)
    ? options.expected
    : [options.expected || 200];
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...authHeaders(options.token),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await readBody(response);
  if (!expected.includes(response.status)) {
    throw new Error(
      `${method} ${path} returned ${response.status}, expected ${expected.join(
        "/",
      )}: ${JSON.stringify(body)}`,
    );
  }
  return { status: response.status, body };
}

async function step(name, fn) {
  log(`RUN ${name}`);
  await fn();
  passed.push(name);
  log(`OK  ${name}`);
}

async function login(email, password, expected = 201) {
  const response = await requestJson("POST", "/v1/auth/login", {
    expected,
    body: { email, password },
  });
  return response.body;
}

async function createUser(adminToken, label) {
  const email = `${label}.${RUN_ID}@product.test`;
  const password = `Pass-${RUN_ID}-${label}`;
  const response = await requestJson("POST", "/v1/admin/users", {
    token: adminToken,
    expected: 201,
    body: { email, password, role: "member" },
  });
  state.userIds.push(response.body.id);
  return { ...response.body, email, password };
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET presigned URL failed with ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function putBytes(url, bytes, contentType) {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: bytes,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PUT presigned URL failed with ${response.status}: ${body}`);
  }
}

async function cleanup() {
  if (!state.adminToken) return;

  for (const userId of state.userIds) {
    await requestJson("PATCH", `/v1/admin/users/${userId}`, {
      token: state.adminToken,
      expected: [200, 404],
      body: { disabled: true },
    }).catch((error) => log(`cleanup user ${userId} skipped: ${error.message}`));
  }

  if (state.assetId) {
    await requestJson("DELETE", `/v1/admin/bot-profiles/${state.assetId}`, {
      token: state.adminToken,
      expected: [200, 404],
    }).catch((error) => log(`cleanup asset skipped: ${error.message}`));
  }
}

async function main() {
  let userA;
  let userB;
  let userC;
  const botProfileBytes = Buffer.from(`bot-profile-template:${RUN_ID}`);
  const profilePayload = Buffer.from(
    JSON.stringify({
      runId: RUN_ID,
      cookies: [{ name: "session", value: "from-user-b" }],
    }),
  );

  try {
    await step("health and readiness endpoints are up", async () => {
      await requestJson("GET", "/health");
      const ready = await requestJson("GET", "/readyz");
      assert(ready.body.status === "ready", "readyz did not report ready");
    });

    await step("admin can log in and receives a team JWT", async () => {
      const loginBody = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
      state.adminToken = loginBody.token;
      assert(loginBody.user.role === "admin", "admin login did not return admin role");
      assert(loginBody.user.teamId, "admin login did not include teamId");

      const me = await requestJson("GET", "/v1/me", {
        token: state.adminToken,
      });
      assert(me.body.user.mode === "team", "/v1/me did not return team mode");
    });

    await step("admin can create and list team users", async () => {
      userA = await createUser(state.adminToken, "user-a");
      userB = await createUser(state.adminToken, "user-b");
      userC = await createUser(state.adminToken, "user-c");
      const users = await requestJson("GET", "/v1/admin/users", {
        token: state.adminToken,
      });
      const ids = new Set(users.body.map((user) => user.id));
      assert(ids.has(userA.id) && ids.has(userB.id), "created users were not listed");
    });

    await step("members cannot access admin-only user APIs", async () => {
      state.aToken = (await login(userA.email, userA.password)).token;
      await requestJson("GET", "/v1/admin/users", {
        token: state.aToken,
        expected: 403,
      });
    });

    await step("admin can upload and list a BotBrowser .enc asset", async () => {
      const asset = await requestJson("POST", "/v1/admin/bot-profiles", {
        token: state.adminToken,
        expected: 201,
        body: {
          name: `Bot template ${RUN_ID}`,
          contentBase64: botProfileBytes.toString("base64"),
          browserMajorVersion: "124",
          platform: "test",
        },
      });
      state.assetId = asset.body.id;
      assert(
        asset.body.s3Key.endsWith(`/bot_profiles/${state.assetId}.enc`),
        "BotBrowser asset was stored under an unexpected key",
      );

      const list = await requestJson("GET", "/v1/admin/bot-profiles", {
        token: state.adminToken,
      });
      assert(
        list.body.some((item) => item.id === state.assetId),
        "BotBrowser asset was not listed",
      );
    });

    await step("member can create a BotBrowser team profile using that asset", async () => {
      const profile = await requestJson("POST", "/v1/team-profiles", {
        token: state.aToken,
        expected: 201,
        body: {
          name: `Team profile ${RUN_ID}`,
          engine: "botbrowser",
          botProfileAssetId: state.assetId,
        },
      });
      state.profileId = profile.body.id;
      assert(profile.body.engine === "botbrowser", "profile engine was not botbrowser");
      assert(
        profile.body.permissions.some(
          (permission) =>
            permission.userId === userA.id && permission.permission === "owner",
        ),
        "profile creator did not receive owner permission",
      );
    });

    await step("referenced BotBrowser assets cannot be deleted", async () => {
      await requestJson("DELETE", `/v1/admin/bot-profiles/${state.assetId}`, {
        token: state.adminToken,
        expected: 409,
      });
    });

    await step("unshared member cannot see, read, upload, or lock the profile", async () => {
      state.bToken = (await login(userB.email, userB.password)).token;
      const list = await requestJson("GET", "/v1/team-profiles", {
        token: state.bToken,
      });
      assert(
        !list.body.some((profile) => profile.id === state.profileId),
        "unshared profile appeared in member list",
      );

      await requestJson("GET", `/v1/team-profiles/${state.profileId}`, {
        token: state.bToken,
        expected: 403,
      });
      await requestJson("POST", `/v1/team-profiles/${state.profileId}/lock`, {
        token: state.bToken,
        expected: 403,
      });
      await requestJson("POST", "/v1/objects/presign-download", {
        token: state.bToken,
        expected: 403,
        body: { key: `profiles/${state.profileId}/metadata.json` },
      });
      await requestJson("POST", "/v1/objects/presign-upload", {
        token: state.bToken,
        expected: 403,
        body: {
          key: `profiles/${state.profileId}/metadata.json`,
          contentType: "application/json",
        },
      });
    });

    await step("viewer can read shared metadata and BotBrowser asset but cannot write", async () => {
      await requestJson("POST", `/v1/team-profiles/${state.profileId}/permissions`, {
        token: state.adminToken,
        expected: 201,
        body: { userId: userB.id, permission: "viewer" },
      });
      await requestJson("GET", `/v1/team-profiles/${state.profileId}`, {
        token: state.bToken,
      });

      await requestJson("POST", `/v1/team-profiles/${state.profileId}/lock`, {
        token: state.bToken,
        expected: 403,
      });
      await requestJson("POST", "/v1/objects/presign-upload", {
        token: state.bToken,
        expected: 403,
        body: {
          key: `profiles/${state.profileId}/metadata.json`,
          contentType: "application/json",
        },
      });
      await requestJson("POST", "/v1/objects/presign-upload", {
        token: state.bToken,
        expected: 403,
        body: {
          key: `bot_profiles/${state.assetId}.enc`,
          contentType: "application/octet-stream",
        },
      });

      const download = await requestJson("POST", "/v1/objects/presign-download", {
        token: state.bToken,
        body: { key: `bot_profiles/${state.assetId}.enc` },
      });
      const downloaded = await fetchBytes(download.body.url);
      assert(
        Buffer.compare(downloaded, botProfileBytes) === 0,
        "downloaded BotBrowser asset did not match uploaded bytes",
      );
    });

    await step("editor must hold the profile lock before uploading", async () => {
      await requestJson("POST", `/v1/team-profiles/${state.profileId}/permissions`, {
        token: state.adminToken,
        expected: 201,
        body: { userId: userB.id, permission: "editor" },
      });
      await requestJson("POST", "/v1/objects/presign-upload", {
        token: state.bToken,
        expected: 403,
        body: {
          key: `profiles/${state.profileId}/metadata.json`,
          contentType: "application/json",
        },
      });

      await requestJson("POST", `/v1/team-profiles/${state.profileId}/lock`, {
        token: state.bToken,
        expected: 201,
      });
      const upload = await requestJson("POST", "/v1/objects/presign-upload", {
        token: state.bToken,
        body: {
          key: `profiles/${state.profileId}/metadata.json`,
          contentType: "application/json",
        },
      });
      await putBytes(upload.body.url, profilePayload, "application/json");

      const stat = await requestJson("POST", "/v1/objects/stat", {
        token: state.bToken,
        body: { key: `profiles/${state.profileId}/metadata.json` },
      });
      assert(stat.body.exists === true, "uploaded profile metadata was not visible");
    });

    await step("lock conflict, heartbeat, unlock, and owner takeover work", async () => {
      await requestJson("POST", `/v1/team-profiles/${state.profileId}/lock`, {
        token: state.aToken,
        expected: 409,
      });
      await requestJson("POST", `/v1/team-profiles/${state.profileId}/lock/heartbeat`, {
        token: state.bToken,
        expected: 201,
      });
      await requestJson("POST", `/v1/team-profiles/${state.profileId}/unlock`, {
        token: state.bToken,
        expected: 201,
      });
      await requestJson("POST", `/v1/team-profiles/${state.profileId}/lock`, {
        token: state.aToken,
        expected: 201,
      });
    });

    await step("admin can force unlock a profile locked by another user", async () => {
      await requestJson("POST", `/v1/team-profiles/${state.profileId}/unlock`, {
        token: state.adminToken,
        expected: 201,
      });
      await requestJson("POST", `/v1/team-profiles/${state.profileId}/lock`, {
        token: state.bToken,
        expected: 201,
      });
      await requestJson("POST", `/v1/team-profiles/${state.profileId}/unlock`, {
        token: state.adminToken,
        expected: 201,
      });
      await requestJson("POST", `/v1/team-profiles/${state.profileId}/lock`, {
        token: state.aToken,
        expected: 201,
      });
    });

    await step("owner can download and delete profile state while holding the lock", async () => {
      const download = await requestJson("POST", "/v1/objects/presign-download", {
        token: state.aToken,
        body: { key: `profiles/${state.profileId}/metadata.json` },
      });
      const downloaded = await fetchBytes(download.body.url);
      assert(
        Buffer.compare(downloaded, profilePayload) === 0,
        "owner downloaded profile metadata did not match editor upload",
      );

      const deletion = await requestJson("POST", "/v1/objects/delete", {
        token: state.aToken,
        body: {
          key: `profiles/${state.profileId}/metadata.json`,
          tombstoneKey: `tombstones/profiles/${state.profileId}/metadata.json`,
          deletedAt: new Date().toISOString(),
        },
      });
      assert(deletion.body.deleted === true, "profile metadata was not deleted");
      assert(deletion.body.tombstoneCreated === true, "profile tombstone was not created");

      const stat = await requestJson("POST", "/v1/objects/stat", {
        token: state.aToken,
        body: { key: `profiles/${state.profileId}/metadata.json` },
      });
      assert(stat.body.exists === false, "deleted profile metadata still exists");

      await requestJson("POST", `/v1/team-profiles/${state.profileId}/unlock`, {
        token: state.aToken,
        expected: 201,
      });
    });

    await step("permissions can be revoked and disabled users cannot log in or reuse old tokens", async () => {
      await requestJson("DELETE", `/v1/team-profiles/${state.profileId}/permissions/${userB.id}`, {
        token: state.adminToken,
      });
      await requestJson("GET", `/v1/team-profiles/${state.profileId}`, {
        token: state.bToken,
        expected: 403,
      });

      const userCLogin = await login(userC.email, userC.password);
      await requestJson("PATCH", `/v1/admin/users/${userC.id}`, {
        token: state.adminToken,
        body: { disabled: true },
      });
      await login(userC.email, userC.password, 401);
      await requestJson("GET", "/v1/me", {
        token: userCLogin.token,
        expected: 401,
      });
    });

    await step("soft-deleted profiles disappear from member access", async () => {
      await requestJson("DELETE", `/v1/team-profiles/${state.profileId}`, {
        token: state.aToken,
      });
      const list = await requestJson("GET", "/v1/team-profiles", {
        token: state.aToken,
      });
      assert(
        !list.body.some((profile) => profile.id === state.profileId),
        "deleted profile remained visible in list",
      );
      await requestJson("GET", `/v1/team-profiles/${state.profileId}`, {
        token: state.aToken,
        expected: 403,
      });
    });

    await step("audit log captures product-critical operations", async () => {
      const logs = await requestJson("GET", "/v1/admin/audit-logs", {
        token: state.adminToken,
      });
      const actions = new Set(logs.body.map((entry) => entry.action));
      for (const action of [
        "auth.login",
        "user.create",
        "user.disable",
        "bot_profile.create",
        "team_profile.create",
        "permission.set",
        "lock.acquire",
        "lock.unlock",
        "lock.admin_unlock",
        "team_profile.delete",
        "profile_object.upload",
        "profile_object.delete",
      ]) {
        assert(actions.has(action), `audit log did not include ${action}`);
      }

      const filtered = await requestJson("GET", "/v1/admin/audit-logs?action=bot_profile.create&limit=10", {
        token: state.adminToken,
      });
      assert(
        filtered.body.length > 0 &&
          filtered.body.every((entry) => entry.action === "bot_profile.create"),
        "audit log action filter did not work",
      );
    });

    log(`PASS ${passed.length} product test cases completed for ${RUN_ID}`);
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`[team-product-test] FAIL ${error.stack || error.message}`);
  process.exit(1);
});
