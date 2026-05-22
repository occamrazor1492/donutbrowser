import { Controller, Get, Header } from "@nestjs/common";

@Controller()
export class AdminWebController {
  @Get(["admin", "admin/"])
  @Header("content-type", "text/html; charset=utf-8")
  @Header("cache-control", "no-store")
  getAdminPage(): string {
    return ADMIN_HTML;
  }
}

const ADMIN_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Donut Team Admin</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f7f9;
        --surface: #ffffff;
        --surface-2: #f9fafb;
        --text: #111827;
        --muted: #6b7280;
        --border: #d7dce3;
        --primary: #1f6feb;
        --primary-hover: #1a5fd0;
        --danger: #b42318;
        --warning: #9a6700;
        --success: #067647;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI", sans-serif;
        font-size: 14px;
        line-height: 1.45;
      }

      button,
      input,
      select {
        font: inherit;
      }

      button {
        border: 1px solid var(--border);
        background: var(--surface);
        border-radius: 6px;
        color: var(--text);
        cursor: pointer;
        padding: 8px 11px;
      }

      button:hover {
        background: var(--surface-2);
      }

      button.primary {
        background: var(--primary);
        border-color: var(--primary);
        color: #ffffff;
      }

      button.primary:hover {
        background: var(--primary-hover);
      }

      button.danger {
        border-color: color-mix(in srgb, var(--danger), transparent 60%);
        color: var(--danger);
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      input,
      select {
        width: 100%;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--surface);
        color: var(--text);
        padding: 8px 10px;
      }

      label {
        color: var(--muted);
        display: grid;
        gap: 5px;
        font-size: 12px;
        font-weight: 600;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        border-bottom: 1px solid var(--border);
        padding: 10px 8px;
        text-align: left;
        vertical-align: top;
      }

      th {
        background: var(--surface-2);
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
      }

      code {
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 1px 4px;
      }

      .shell {
        margin: 0 auto;
        max-width: 1280px;
        padding: 28px;
      }

      .topbar {
        align-items: center;
        display: flex;
        gap: 16px;
        justify-content: space-between;
        margin-bottom: 20px;
      }

      .title h1 {
        font-size: 24px;
        letter-spacing: 0;
        line-height: 1.15;
        margin: 0 0 4px;
      }

      .title p {
        color: var(--muted);
        margin: 0;
      }

      .card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 18px;
      }

      .login-card {
        margin: 80px auto;
        max-width: 420px;
      }

      .grid {
        display: grid;
        gap: 12px;
      }

      .grid.cols-2 {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .grid.cols-3 {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .grid.cols-4 {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .row {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .tabs {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
      }

      .tabs button.active {
        background: var(--text);
        border-color: var(--text);
        color: #ffffff;
      }

      .panel {
        display: none;
      }

      .panel.active {
        display: grid;
        gap: 16px;
      }

      .notice {
        border-radius: 6px;
        margin-bottom: 16px;
        padding: 10px 12px;
      }

      .notice.error {
        background: color-mix(in srgb, var(--danger), transparent 90%);
        color: var(--danger);
      }

      .notice.ok {
        background: color-mix(in srgb, var(--success), transparent 90%);
        color: var(--success);
      }

      .muted {
        color: var(--muted);
      }

      .pill {
        border: 1px solid var(--border);
        border-radius: 999px;
        display: inline-flex;
        font-size: 12px;
        gap: 5px;
        padding: 2px 8px;
      }

      .pill.success {
        border-color: color-mix(in srgb, var(--success), transparent 55%);
        color: var(--success);
      }

      .pill.warning {
        border-color: color-mix(in srgb, var(--warning), transparent 55%);
        color: var(--warning);
      }

      .pill.danger {
        border-color: color-mix(in srgb, var(--danger), transparent 55%);
        color: var(--danger);
      }

      .profile-card {
        display: grid;
        gap: 12px;
      }

      .split {
        display: grid;
        gap: 12px;
        grid-template-columns: 1fr 1fr;
      }

      .table-wrap {
        overflow: auto;
      }

      .small-input {
        min-width: 170px;
        width: 170px;
      }

      .nowrap {
        white-space: nowrap;
      }

      .hide {
        display: none !important;
      }

      @media (max-width: 840px) {
        .shell {
          padding: 16px;
        }

        .grid.cols-2,
        .grid.cols-3,
        .grid.cols-4,
        .split {
          grid-template-columns: 1fr;
        }

        .topbar {
          align-items: flex-start;
          flex-direction: column;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section id="loginView" class="card login-card">
        <div class="title">
          <h1>Donut Team Admin</h1>
          <p>Sign in with a self-hosted admin account.</p>
        </div>
        <div id="loginNotice" class="notice error hide"></div>
        <form id="loginForm" class="grid" autocomplete="on">
          <label>
            Email
            <input id="loginEmail" type="email" autocomplete="username" required />
          </label>
          <label>
            Password
            <input id="loginPassword" type="password" autocomplete="current-password" required />
          </label>
          <button class="primary" type="submit">Login</button>
        </form>
      </section>

      <section id="adminView" class="hide">
        <div class="topbar">
          <div class="title">
            <h1>Donut Team Admin</h1>
            <p id="sessionText">Self-hosted team management</p>
          </div>
          <div class="row">
            <button id="refreshAllButton" type="button">Refresh</button>
            <button id="logoutButton" type="button">Logout</button>
          </div>
        </div>

        <div id="notice" class="notice hide"></div>

        <div class="tabs" role="tablist">
          <button class="active" data-tab="usersPanel" type="button">Users</button>
          <button data-tab="templatesPanel" type="button">BotBrowser Templates</button>
          <button data-tab="profilesPanel" type="button">Profiles</button>
          <button data-tab="auditPanel" type="button">Audit Logs</button>
        </div>

        <section id="usersPanel" class="panel active">
          <div class="card">
            <h2>Create user</h2>
            <form id="createUserForm" class="grid cols-4">
              <label>
                Email
                <input id="newUserEmail" type="email" required />
              </label>
              <label>
                Temporary password
                <input id="newUserPassword" type="password" required />
              </label>
              <label>
                Role
                <select id="newUserRole">
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </label>
              <label>
                Action
                <button class="primary" type="submit">Create user</button>
              </label>
            </form>
          </div>

          <div class="card">
            <h2>Users</h2>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="usersBody"></tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="templatesPanel" class="panel">
          <div class="card">
            <h2>Upload BotBrowser template</h2>
            <form id="uploadAssetForm" class="grid cols-4">
              <label>
                Name
                <input id="assetName" required />
              </label>
              <label>
                Browser major version
                <input id="assetBrowserMajorVersion" placeholder="120" />
              </label>
              <label>
                Platform
                <input id="assetPlatform" placeholder="macos / windows" />
              </label>
              <label>
                .enc file
                <input id="assetFile" type="file" accept=".enc,application/octet-stream" required />
              </label>
              <button class="primary" type="submit">Upload template</button>
            </form>
          </div>

          <div class="card">
            <h2>Templates</h2>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Version</th>
                    <th>Platform</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="assetsBody"></tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="profilesPanel" class="panel">
          <div class="card">
            <h2>Create team profile</h2>
            <form id="createProfileForm" class="grid cols-4">
              <label>
                Name
                <input id="profileName" required />
              </label>
              <label>
                Engine
                <select id="profileEngine">
                  <option value="botbrowser">botbrowser</option>
                  <option value="wayfern">wayfern</option>
                  <option value="cloak">cloak</option>
                  <option value="camoufox">camoufox</option>
                </select>
              </label>
              <label>
                BotBrowser template
                <select id="profileAsset"></select>
              </label>
              <label>
                Action
                <button class="primary" type="submit">Create profile</button>
              </label>
            </form>
          </div>

          <div id="profilesList" class="grid"></div>
        </section>

        <section id="auditPanel" class="panel">
          <div class="card">
            <h2>Audit log filters</h2>
            <form id="auditFilterForm" class="grid cols-4">
              <label>
                Action
                <input id="auditAction" placeholder="user.create" />
              </label>
              <label>
                Target type
                <input id="auditTargetType" placeholder="user / profile" />
              </label>
              <label>
                Target id
                <input id="auditTargetId" />
              </label>
              <label>
                User
                <select id="auditUserId"></select>
              </label>
              <button class="primary" type="submit">Load logs</button>
            </form>
          </div>

          <div class="card">
            <h2>Audit logs</h2>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Metadata</th>
                  </tr>
                </thead>
                <tbody id="auditBody"></tbody>
              </table>
            </div>
          </div>
        </section>
      </section>
    </main>

    <script>
      const tokenKey = "donut.teamAdmin.token";
      const state = {
        user: null,
        users: [],
        assets: [],
        profiles: [],
        auditLogs: [],
      };

      const $ = (id) => document.getElementById(id);

      function escapeHtml(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;");
      }

      function shortId(value) {
        const text = String(value ?? "");
        return text.length > 12 ? text.slice(0, 12) + "..." : text;
      }

      function formatDate(value) {
        if (!value) return "-";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
      }

      function setBusy(isBusy) {
        document.querySelectorAll("button, input, select").forEach((el) => {
          if (el.id === "loginEmail" || el.id === "loginPassword") return;
          el.disabled = isBusy;
        });
      }

      function showNotice(message, kind = "ok") {
        const notice = $("notice");
        notice.textContent = message;
        notice.className = "notice " + kind;
        notice.classList.remove("hide");
      }

      function hideNotice() {
        $("notice").classList.add("hide");
      }

      function showLoginError(message) {
        const notice = $("loginNotice");
        notice.textContent = message;
        notice.classList.remove("hide");
      }

      function authToken() {
        return localStorage.getItem(tokenKey) || "";
      }

      async function api(path, options = {}) {
        const headers = {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(authToken() ? { Authorization: "Bearer " + authToken() } : {}),
          ...(options.headers || {}),
        };
        const response = await fetch(path, { ...options, headers });
        const text = await response.text();
        let body = null;
        if (text.trim()) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        if (!response.ok) {
          const message =
            body?.message ||
            body?.error ||
            (typeof body === "string" ? body : response.statusText);
          throw new Error(
            Array.isArray(message) ? message.join(", ") : String(message),
          );
        }
        return body;
      }

      async function login(email, password) {
        const result = await api("/v1/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        localStorage.setItem(tokenKey, result.token);
        await loadSession();
      }

      async function loadSession() {
        const result = await api("/v1/me");
        state.user = result.user;
        if (state.user?.role !== "admin") {
          localStorage.removeItem(tokenKey);
          throw new Error("Admin role is required.");
        }
        $("loginView").classList.add("hide");
        $("adminView").classList.remove("hide");
        $("sessionText").textContent =
          state.user.email + " · " + state.user.role + " · team " + shortId(state.user.teamId);
        await loadAll();
      }

      async function loadAll() {
        hideNotice();
        setBusy(true);
        try {
          const [users, assets, profiles] = await Promise.all([
            api("/v1/admin/users"),
            api("/v1/admin/bot-profiles"),
            api("/v1/team-profiles"),
          ]);
          state.users = users || [];
          state.assets = assets || [];
          state.profiles = profiles || [];
          renderUsers();
          renderAssets();
          renderProfiles();
          await loadAuditLogs();
        } finally {
          setBusy(false);
        }
      }

      function renderUsers() {
        $("usersBody").innerHTML = state.users
          .map((user) => {
            const disabled = Boolean(user.disabledAt);
            return (
              '<tr>' +
              '<td><div>' +
              escapeHtml(user.email) +
              '</div><div class="muted"><code>' +
              escapeHtml(user.id) +
              '</code></div></td>' +
              '<td><select class="small-input" data-user-role="' +
              escapeHtml(user.id) +
              '">' +
              '<option value="member" ' +
              (user.role === "member" ? "selected" : "") +
              ">member</option>" +
              '<option value="admin" ' +
              (user.role === "admin" ? "selected" : "") +
              ">admin</option>" +
              "</select></td>" +
              '<td><span class="pill ' +
              (disabled ? "danger" : "success") +
              '">' +
              (disabled ? "Disabled" : "Active") +
              "</span></td>" +
              "<td>" +
              formatDate(user.createdAt) +
              "</td>" +
              '<td><div class="row">' +
              '<button type="button" data-save-role="' +
              escapeHtml(user.id) +
              '">Save role</button>' +
              '<input class="small-input" type="password" placeholder="New password" data-password="' +
              escapeHtml(user.id) +
              '" />' +
              '<button type="button" data-reset-password="' +
              escapeHtml(user.id) +
              '">Reset password</button>' +
              '<button class="' +
              (disabled ? "" : "danger") +
              '" type="button" data-toggle-user="' +
              escapeHtml(user.id) +
              '">' +
              (disabled ? "Enable" : "Disable") +
              "</button>" +
              "</div></td>" +
              "</tr>"
            );
          })
          .join("");

        document.querySelectorAll("[data-save-role]").forEach((button) => {
          button.addEventListener("click", () => updateUserRole(button.dataset.saveRole));
        });
        document.querySelectorAll("[data-reset-password]").forEach((button) => {
          button.addEventListener("click", () => resetUserPassword(button.dataset.resetPassword));
        });
        document.querySelectorAll("[data-toggle-user]").forEach((button) => {
          button.addEventListener("click", () => toggleUser(button.dataset.toggleUser));
        });

        const userOptions =
          '<option value="">All users</option>' +
          state.users
            .map(
              (user) =>
                '<option value="' +
                escapeHtml(user.id) +
                '">' +
                escapeHtml(user.email) +
                "</option>",
            )
            .join("");
        $("auditUserId").innerHTML = userOptions;
      }

      function renderAssets() {
        const assetOptions =
          '<option value="">No BotBrowser template</option>' +
          state.assets
            .map(
              (asset) =>
                '<option value="' +
                escapeHtml(asset.id) +
                '">' +
                escapeHtml(asset.name) +
                "</option>",
            )
            .join("");
        $("profileAsset").innerHTML = assetOptions;

        $("assetsBody").innerHTML = state.assets
          .map(
            (asset) =>
              '<tr><td><div>' +
              escapeHtml(asset.name) +
              '</div><div class="muted"><code>' +
              escapeHtml(asset.id) +
              "</code></div></td><td>" +
              escapeHtml(asset.browserMajorVersion || "-") +
              "</td><td>" +
              escapeHtml(asset.platform || "-") +
              "</td><td>" +
              formatDate(asset.createdAt) +
              '</td><td><button class="danger" type="button" data-delete-asset="' +
              escapeHtml(asset.id) +
              '">Delete</button></td></tr>',
          )
          .join("");

        document.querySelectorAll("[data-delete-asset]").forEach((button) => {
          button.addEventListener("click", () => deleteAsset(button.dataset.deleteAsset));
        });
      }

      function permissionRows(profile) {
        const permissions = profile.permissions || [];
        if (!permissions.length) return '<div class="muted">No permissions</div>';
        return permissions
          .map((permission) => {
            const user = permission.user || state.users.find((item) => item.id === permission.userId);
            return (
              '<div class="row"><span class="pill">' +
              escapeHtml(permission.permission) +
              "</span><span>" +
              escapeHtml(user?.email || permission.userId) +
              '</span><button class="danger" type="button" data-remove-permission="' +
              escapeHtml(profile.id) +
              ":" +
              escapeHtml(permission.userId) +
              '">Remove</button></div>'
            );
          })
          .join("");
      }

      function renderProfiles() {
        $("profilesList").innerHTML =
          state.profiles
            .map((profile) => {
              const lockActive = profile.lock && new Date(profile.lock.expiresAt).getTime() > Date.now();
              const asset = profile.botProfileAsset || state.assets.find((item) => item.id === profile.botProfileAssetId);
              const userOptions = state.users
                .map(
                  (user) =>
                    '<option value="' +
                    escapeHtml(user.id) +
                    '">' +
                    escapeHtml(user.email) +
                    "</option>",
                )
                .join("");
              return (
                '<article class="card profile-card">' +
                '<div class="row" style="justify-content: space-between"><div><h2>' +
                escapeHtml(profile.name) +
                '</h2><div class="muted"><code>' +
                escapeHtml(profile.id) +
                "</code> · " +
                escapeHtml(profile.engine) +
                " · template " +
                escapeHtml(asset?.name || profile.botProfileAssetId || "-") +
                '</div></div><span class="pill ' +
                (lockActive ? "warning" : "success") +
                '">' +
                (lockActive ? "Locked" : "Unlocked") +
                "</span></div>" +
                '<div class="split"><div class="grid"><strong>Permissions</strong>' +
                permissionRows(profile) +
                '</div><form class="grid" data-grant-form="' +
                escapeHtml(profile.id) +
                '"><strong>Grant permission</strong><label>User<select data-grant-user="' +
                escapeHtml(profile.id) +
                '">' +
                userOptions +
                '</select></label><label>Permission<select data-grant-level="' +
                escapeHtml(profile.id) +
                '"><option value="viewer">viewer</option><option value="editor">editor</option><option value="owner">owner</option></select></label><button type="submit">Save permission</button></form></div>' +
                '<div class="row"><button type="button" data-unlock-profile="' +
                escapeHtml(profile.id) +
                '">Force unlock</button><button class="danger" type="button" data-delete-profile="' +
                escapeHtml(profile.id) +
                '">Delete profile</button></div></article>'
              );
            })
            .join("") || '<div class="card muted">No team profiles yet.</div>';

        document.querySelectorAll("[data-grant-form]").forEach((form) => {
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            grantPermission(form.dataset.grantForm);
          });
        });
        document.querySelectorAll("[data-remove-permission]").forEach((button) => {
          button.addEventListener("click", () => {
            const [profileId, userId] = button.dataset.removePermission.split(":");
            removePermission(profileId, userId);
          });
        });
        document.querySelectorAll("[data-unlock-profile]").forEach((button) => {
          button.addEventListener("click", () => unlockProfile(button.dataset.unlockProfile));
        });
        document.querySelectorAll("[data-delete-profile]").forEach((button) => {
          button.addEventListener("click", () => deleteProfile(button.dataset.deleteProfile));
        });
      }

      async function loadAuditLogs() {
        const params = new URLSearchParams({ limit: "200" });
        if ($("auditAction").value.trim()) params.set("action", $("auditAction").value.trim());
        if ($("auditTargetType").value.trim()) params.set("targetType", $("auditTargetType").value.trim());
        if ($("auditTargetId").value.trim()) params.set("targetId", $("auditTargetId").value.trim());
        if ($("auditUserId").value) params.set("userId", $("auditUserId").value);
        state.auditLogs = (await api("/v1/admin/audit-logs?" + params.toString())) || [];
        renderAuditLogs();
      }

      function renderAuditLogs() {
        $("auditBody").innerHTML = state.auditLogs
          .map(
            (log) =>
              "<tr><td>" +
              formatDate(log.createdAt) +
              "</td><td>" +
              escapeHtml(log.user?.email || log.userId || "-") +
              "</td><td><code>" +
              escapeHtml(log.action) +
              "</code></td><td>" +
              escapeHtml(log.targetType) +
              " · <code>" +
              escapeHtml(shortId(log.targetId || "-")) +
              "</code></td><td><code>" +
              escapeHtml(JSON.stringify(log.metadata || {})) +
              "</code></td></tr>",
          )
          .join("");
      }

      async function runAction(label, action) {
        hideNotice();
        setBusy(true);
        try {
          await action();
          showNotice(label, "ok");
          await loadAll();
        } catch (error) {
          showNotice(error.message || String(error), "error");
        } finally {
          setBusy(false);
        }
      }

      function userById(userId) {
        return state.users.find((user) => user.id === userId);
      }

      async function updateUserRole(userId) {
        const role = document.querySelector('[data-user-role="' + CSS.escape(userId) + '"]').value;
        await runAction("Role updated.", () =>
          api("/v1/admin/users/" + encodeURIComponent(userId), {
            method: "PATCH",
            body: JSON.stringify({ role }),
          }),
        );
      }

      async function resetUserPassword(userId) {
        const input = document.querySelector('[data-password="' + CSS.escape(userId) + '"]');
        const password = input.value.trim();
        if (!password) {
          showNotice("Enter a new password first.", "error");
          return;
        }
        await runAction("Password reset.", () =>
          api("/v1/admin/users/" + encodeURIComponent(userId), {
            method: "PATCH",
            body: JSON.stringify({ password }),
          }),
        );
      }

      async function toggleUser(userId) {
        const user = userById(userId);
        const disabled = !user.disabledAt;
        await runAction(disabled ? "User disabled." : "User enabled.", () =>
          api("/v1/admin/users/" + encodeURIComponent(userId), {
            method: "PATCH",
            body: JSON.stringify({ disabled }),
          }),
        );
      }

      async function deleteAsset(assetId) {
        if (!confirm("Delete this template? Profiles using it will block deletion.")) return;
        await runAction("Template deleted.", () =>
          api("/v1/admin/bot-profiles/" + encodeURIComponent(assetId), {
            method: "DELETE",
          }),
        );
      }

      async function grantPermission(profileId) {
        const userId = document.querySelector('[data-grant-user="' + CSS.escape(profileId) + '"]').value;
        const permission = document.querySelector('[data-grant-level="' + CSS.escape(profileId) + '"]').value;
        await runAction("Permission saved.", () =>
          api("/v1/team-profiles/" + encodeURIComponent(profileId) + "/permissions", {
            method: "POST",
            body: JSON.stringify({ userId, permission }),
          }),
        );
      }

      async function removePermission(profileId, userId) {
        if (!confirm("Remove this permission?")) return;
        await runAction("Permission removed.", () =>
          api(
            "/v1/team-profiles/" +
              encodeURIComponent(profileId) +
              "/permissions/" +
              encodeURIComponent(userId),
            { method: "DELETE" },
          ),
        );
      }

      async function unlockProfile(profileId) {
        await runAction("Profile unlocked.", () =>
          api("/v1/team-profiles/" + encodeURIComponent(profileId) + "/unlock", {
            method: "POST",
          }),
        );
      }

      async function deleteProfile(profileId) {
        if (!confirm("Delete this team profile?")) return;
        await runAction("Profile deleted.", () =>
          api("/v1/team-profiles/" + encodeURIComponent(profileId), {
            method: "DELETE",
          }),
        );
      }

      function fileToBase64(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("Failed to read file."));
          reader.onload = () => {
            const result = String(reader.result || "");
            resolve(result.includes(",") ? result.split(",").pop() : result);
          };
          reader.readAsDataURL(file);
        });
      }

      document.querySelectorAll(".tabs button").forEach((button) => {
        button.addEventListener("click", () => {
          document.querySelectorAll(".tabs button").forEach((item) => item.classList.remove("active"));
          document.querySelectorAll(".panel").forEach((item) => item.classList.remove("active"));
          button.classList.add("active");
          $(button.dataset.tab).classList.add("active");
        });
      });

      $("loginForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        $("loginNotice").classList.add("hide");
        try {
          await login($("loginEmail").value.trim(), $("loginPassword").value);
        } catch (error) {
          localStorage.removeItem(tokenKey);
          showLoginError(error.message || String(error));
        }
      });

      $("logoutButton").addEventListener("click", () => {
        localStorage.removeItem(tokenKey);
        location.reload();
      });

      $("refreshAllButton").addEventListener("click", () => {
        runAction("Refreshed.", loadAll);
      });

      $("createUserForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        await runAction("User created.", () =>
          api("/v1/admin/users", {
            method: "POST",
            body: JSON.stringify({
              email: $("newUserEmail").value.trim(),
              password: $("newUserPassword").value,
              role: $("newUserRole").value,
            }),
          }),
        );
        $("createUserForm").reset();
      });

      $("uploadAssetForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const file = $("assetFile").files?.[0];
        if (!file) {
          showNotice("Choose a .enc file first.", "error");
          return;
        }
        await runAction("Template uploaded.", async () => {
          const contentBase64 = await fileToBase64(file);
          return api("/v1/admin/bot-profiles", {
            method: "POST",
            body: JSON.stringify({
              name: $("assetName").value.trim(),
              browserMajorVersion: $("assetBrowserMajorVersion").value.trim() || undefined,
              platform: $("assetPlatform").value.trim() || undefined,
              contentBase64,
            }),
          });
        });
        $("uploadAssetForm").reset();
      });

      $("createProfileForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const botProfileAssetId = $("profileAsset").value || null;
        await runAction("Profile created.", () =>
          api("/v1/team-profiles", {
            method: "POST",
            body: JSON.stringify({
              name: $("profileName").value.trim(),
              engine: $("profileEngine").value,
              botProfileAssetId,
              syncMode: "Regular",
            }),
          }),
        );
        $("createProfileForm").reset();
      });

      $("auditFilterForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        await runAction("Audit logs loaded.", loadAuditLogs);
      });

      if (authToken()) {
        loadSession().catch((error) => {
          localStorage.removeItem(tokenKey);
          showLoginError(error.message || String(error));
          $("loginView").classList.remove("hide");
          $("adminView").classList.add("hide");
        });
      }
    </script>
  </body>
</html>`;
