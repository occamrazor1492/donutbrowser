<div align="center">
  <img src="assets/logo.png" alt="Donut Browser Logo" width="150">
  <h1>Donut Browser — 内部 Fork</h1>
  <strong>自托管反检测浏览器，无云端订阅</strong>
</div>
<br>

<p align="center">
  <a style="text-decoration: none;" href="https://github.com/zhom/donutbrowser/blob/main/LICENSE" target="_blank">
    <img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License">
  </a>
  <img src="https://img.shields.io/badge/status-internal--use-orange.svg" alt="Internal use">
  <img src="https://img.shields.io/badge/upstream-zhom%2Fdonutbrowser-lightgrey.svg" alt="Upstream">
</p>

<img alt="Donut Browser 预览" src="assets/donut-preview.png" />

---

Languages: [English](./README.md) | [中文](./README.zh.md)

这是 [zhom/donutbrowser](https://github.com/zhom/donutbrowser) 的**内部使用 fork**，为自托管团队部署维护。它把上游构建里所有云端订阅相关的入口都剥掉了 —— 没有商业试用弹窗、没有云端控制面、没有 Pro 功能门槛 —— 取而代之的是一个由你自己运行的 `donut-sync` 服务。

如果你想要上游的商业产品（付费云同步、地理位置代理、BotBrowser 指纹 token），直接用 [zhom/donutbrowser](https://github.com/zhom/donutbrowser)。这个 fork 是给希望端到端自主掌控基础设施的团队用的。

> **AGPL-3.0 注意事项：** 所有衍生作品（包括这个 fork）必须以同一许可证保持开源。CloakBrowser Chromium runtime 是单独维护的专有资产，**不**包含在本仓库或任何二进制发行版中 —— 你需要自己获取（见下方 [Cloak runtime](#cloak-chromium-runtime)）。

## 目录

- [与上游的差异](#与上游的差异)
- [功能](#功能)
- [快速开始（运行起来）](#快速开始运行起来)
- [自托管 `donut-sync` 服务](#自托管-donut-sync-服务)
- [Cloak Chromium runtime](#cloak-chromium-runtime)
- [从源码构建桌面 app](#从源码构建桌面-app)
- [技术架构](#技术架构)
- [开发](#开发)
- [许可证](#许可证)

## 与上游的差异

| 方面 | 上游 `zhom/donutbrowser` | 本 fork |
|---|---|---|
| **云端控制面** | 付费云 API，用于订阅、地理位置代理、Wayfern token | **打桩** —— `cloud_auth.rs` 全部 no-op，所有 gating 谓词放行，无外部 HTTP 调用 |
| **商业试用** | 每次启动都弹试用倒计时窗 | **删除** —— `commercial_license.rs`、`commercial-trial-modal.tsx`、12 个 i18n key × 7 个语言已全部清理 |
| **Pro 功能门槛** | 跨 OS profile、高级指纹字段、加密同步、扩展、tab 同步上挂 "PRO" 徽章 | **删除** —— `crossOsUnlocked` / `syncUnlocked` / `limitedMode` / `canUseEncryption` 这些 prop 从全部 12 个组件里拆掉；`ProBadge` 组件已删 |
| **云端登录** | 走 `donutbrowser.com` 的 device-code OAuth 流程 | **删除** —— `device-code-verify-dialog.tsx` 已删，同步对话框现在只支持自托管 |
| **同步服务器** | 单一共享 bearer token，原始文件 blob | **默认 JWT + 多用户团队模式** —— Postgres 存用户 / 团队 / 权限 / 锁 / 审计日志，profile bundle 存到 S3/MinIO |
| **CloakBrowser runtime** | 只打进内部私有构建 | **不进仓库，不进 release** —— 构建前自行把 [CloakHQ release 压缩包](https://github.com/CloakHQ/CloakBrowser/releases) 解压到 `vendor-private/cloakbrowser/<platform>/` |
| **Sync token 解密** | 如果两次构建之间 `DONUT_BROWSER_VAULT_PASSWORD` 变了，启动直接硬失败 | **自愈** —— 无法解密的 token 会记日志并丢弃，app 退化为"未登录"而不是变砖 |
| **启动时获取团队锁** | 服务器不可达时启动硬失败 | **尽力而为** —— 打一条 warning 日志，本机照常启动 |
| **启动时 Pro 预检** | 对所有启用同步的引擎都跑（服务器异议时 Cloak/Wayfern 都会被拦） | **只对 BotBrowser 跑** —— Cloak/Wayfern 本地启动，不走服务器往返 |

代码层面，看清楚 diff 最干净的办法是 `git log --oneline c0d1b8f^..HEAD` —— fork 开始之后的每一个 commit 在 message body 里都有自洽的说明。

## 功能

这个 fork 保留了上游 Donut Browser 的全部功能，只是少了商业 gating：

- **不限数量的浏览器 profile** —— 每个 profile 都有自己独立的指纹、cookie、扩展和存储
- **四种引擎** —— Wayfern（Chromium，默认）、Cloak（带更深指纹补丁的私有 Chromium）、Camoufox（Firefox）、BotBrowser（保留以兼容旧场景）
- **逐 profile 代理** —— HTTP、HTTPS、SOCKS4、SOCKS5、动态 URL，可选的逐 profile WireGuard VPN
- **自托管团队同步** —— Postgres + S3/MinIO 后端，JWT 鉴权，权限分级（owner/editor/viewer），带 heartbeat 的 profile lock，审计日志
- **本地 API & MCP** —— REST API 和 [Model Context Protocol](https://modelcontextprotocol.io) 服务，给 Claude / 自动化 / 自定义脚本用
- **Profile 分组、模板、批量启动/停止、计划任务、webhook、cookie 快照、proxy failover、profile 对比** —— 近期功能优化做的所有东西都在

## 快速开始（运行起来）

需要**两**个组件：

1. **一台自托管 `donut-sync` 服务**（Postgres + MinIO + Nest API，前面挂反向代理）
2. **本仓库构建的 Donut 桌面 app**（每个平台构建一次）

### 1. 启动同步服务

```bash
cd donut-sync
cp .env.example .env  # 然后改 ADMIN_EMAIL / ADMIN_PASSWORD / JWT_SECRET
docker compose up -d
```

默认的 `docker-compose.yml` 会跑起来 Postgres + MinIO + NestJS API，API 绑在 `127.0.0.1:12342`，MinIO 绑在 `127.0.0.1:8987`。生产环境前面挂个反向代理（Caddy / Nginx / 宝塔）来终结 TLS。完整说明见 [docs/self-hosting-donut-sync.md](docs/self-hosting-donut-sync.zh.md) 和 [docs/team-deployment-guide.md](docs/team-deployment-guide.zh.md)。

### 2. 构建并安装桌面 app

```bash
pnpm install
# 可选但推荐 —— 烤一个自己的 vault password，这样重新构建时
# 之前磁盘上加密过的 token 不会失效
export DONUT_BROWSER_VAULT_PASSWORD="$(openssl rand -hex 32)"
pnpm tauri build
```

打好的 `.app` 在 `src-tauri/target/release/bundle/macos/Donut.app`。如果你 macOS 上没有 Apple Developer ID：

```bash
# ad-hoc 签名，让 Gatekeeper 允许本机启动
codesign --force --deep --sign - src-tauri/target/release/bundle/macos/Donut.app
cp -R src-tauri/target/release/bundle/macos/Donut.app /Applications/
```

Linux / Windows 打包方式与上游一致 —— 见 [docs/team-deployment-guide.md](docs/team-deployment-guide.zh.md)。

### 3. 在桌面 app 里登录

1. 右侧下拉菜单（`···`）→ **账户**（Sync Service）
2. **Server URL**：你的同步服务地址（例如 `https://sync.example.com`）
3. **Email + Password**：第 1 步里设置的管理员账号 —— 登录之后从 **团队管理**（Team Admin）创建更多用户
4. **保存** —— 鉴权通过之后顶栏会出现团队菜单（`团队管理` / `共享 Profiles` / `分享 profile`）

## 自托管 `donut-sync` 服务

三个组件：

```text
┌────────────────────┐    ┌──────────┐    ┌──────────────────────────┐
│ Donut 桌面 app     │───▶│ donut-   │───▶│ Postgres                 │
│ (macOS / Win / Lx) │    │ sync API │    │  users, teams, profiles, │
└────────────────────┘    │ (NestJS) │    │  permissions, locks,     │
                          │          │    │  audit log               │
                          │  JWT     │    └──────────────────────────┘
                          │  auth    │
                          │          │    ┌──────────────────────────┐
                          └──────────┤───▶│ S3 / MinIO               │
                                     │    │  profile bundles,        │
                                     │    │  Cookie snapshots,       │
                                     │    │  BotBrowser .enc assets, │
                                     │    │  extensions, tombstones  │
                                     │    └──────────────────────────┘
                                     ▼
                              （桌面端通过 presigned upload/download URL
                               直接把大 blob 推/拉到 S3）
```

必填环境变量（完整列表见 [docs/self-hosting-donut-sync.md](docs/self-hosting-donut-sync.zh.md)）：

```env
MULTI_USER_ENABLED=true           # 团队 JWT 模式（推荐）
DATABASE_URL=postgresql://...
JWT_SECRET=<random 32+ bytes>
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<初始管理员密码>
S3_ENDPOINT=http://minio:9000     # 服务端访问 S3
S3_PUBLIC_ENDPOINT=https://s3...  # 客户端通过 presign 访问 S3
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET=donut-sync
```

老的单 token 模式（`MULTI_USER_ENABLED=false` + `SYNC_TOKEN`）仍然能用，但团队功能和新 UI 都假设跑在 JWT 模式下。

## Cloak Chromium runtime

Cloak 是可选的反检测 Chromium 引擎。它**不**包含在本仓库或本 fork 的任何二进制发行版里 —— 是独立维护的 Chromium 构建。

**快速路径**（macOS Apple Silicon）：

```bash
mkdir -p vendor-private/cloakbrowser/macos-aarch64
curl -fL -o /tmp/cloak.tgz \
  https://github.com/CloakHQ/CloakBrowser/releases/download/chromium-v142.0.7444.175/cloakbrowser-darwin-arm64.tar.gz
tar -xzf /tmp/cloak.tgz -C vendor-private/cloakbrowser/macos-aarch64
pnpm tauri build  # binary 会在打包时复制进 .app
```

其它平台（Intel macOS、Linux x64、Windows x64）去 [CloakHQ releases 页面](https://github.com/CloakHQ/CloakBrowser/releases) 找对应的 `cloakbrowser-<platform>.tar.gz`。本 fork 查找的平台目录名是：

```text
vendor-private/cloakbrowser/macos-aarch64/   ← Apple Silicon
vendor-private/cloakbrowser/macos-x64/       ← Intel Mac
vendor-private/cloakbrowser/linux-x64/       ← Linux 64-bit
vendor-private/cloakbrowser/windows-x64/     ← Windows 64-bit
```

`vendor-private/` 已被 git ignore —— 不要把 binary 提交进去。如果跳过这一步，Cloak profile 启动会失败，提示 "CloakBrowser runtime was not found"；Wayfern、Camoufox、BotBrowser profile 不受影响。

> 注意：CloakHQ 的公开 macOS release 比 Linux 慢。截至撰写时，macOS arm64 在 Chromium 142，Linux 在 146。

## 从源码构建桌面 app

```bash
pnpm install                         # JS + Rust 依赖 + Tauri sidecar
pnpm tauri dev                       # 热重载 dev 模式
pnpm tauri build                     # release .app / .dmg / .deb / .msi
```

提交前的质量门（pre-commit hook 会自动跑）：

```bash
pnpm format && pnpm lint && pnpm test
```

跑的是 typos、biome、`cargo fmt`、`cargo clippy --all-targets -- -D warnings`、459 个 Rust 单测、sync e2e（15 个）、integration（15 + 14 个），以及 `donut-sync` 的 Jest。新增 Tauri 命令必须在前端至少有一处 `invoke()` 调用 —— `test_no_unused_tauri_commands` 会强制这一点。

如果你也打算往上游提补丁，上游贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 技术架构

简要 —— 完整图示和控制流见 [docs/architecture.md](docs/architecture.zh.md)。

- **前端**：Next.js 16（App Router、React 19、Turbopack）、Tailwind、biome lint、i18next（en / es / fr / ja / pt / ru / zh）。UI 在 `src/components/`，入口在 `src/app/page.tsx`。
- **后端**：Tauri 2（Rust），~100 个 Tauri 命令在 `src-tauri/src/lib.rs` 注册。每个浏览器引擎（`browser_runner.rs`、`cloakbrowser.rs`、`wayfern_manager.rs`、`camoufox_manager.rs`、`botbrowser.rs`）负责自己的 launch flag、指纹注入和 profile 数据路径。
- **同步引擎**：`src-tauri/src/sync/engine.rs` 负责 delta 同步（S3 manifest + 逐文件 SHA256）、profile bundle 往返、加密同步（Argon2 + AES-GCM，可选 E2E 密码）、后台计划同步。
- **团队模式**：`src-tauri/src/self_hosted_auth.rs` 缓存 JWT 和 user JSON，`self_hosted_team.rs` 包 REST 调用，`team_lock.rs` 管理分布式 profile 锁和 heartbeat。代码里其它地方的 `CLOUD_AUTH.*` 谓词都是 stub，返回宽松默认值，这样团队模式调用点不需要专门处理"没有云"的情况。
- **Vault 加密**：长期存放的 secret（sync token、settings）用 Argon2id + AES-256-GCM 静态加密，密钥来自编译时烤进 binary 的 `env!("DONUT_BROWSER_VAULT_PASSWORD")`。`build.rs` 现在加了 `rerun-if-env-changed`，env 变了 cargo 才会真的重新构建；`get_sync_token` 在 vault password 漂移时会自愈（记日志、丢弃、返回 `None`）。

## 开发

- [AGENTS.md](AGENTS.md)（同 `CLAUDE.md` —— 是同一个文件）—— 仓库结构、lint 规则、theming 规则、i18n 规则、安全护栏。提补丁前请看。
- [CONTRIBUTING.md](CONTRIBUTING.md) —— 上游贡献流程。
- [docs/team-deployment-guide.md](docs/team-deployment-guide.md) / [.zh.md](docs/team-deployment-guide.zh.md) —— VPS + 宝塔 / Caddy / Nginx 的部署 runbook。
- [docs/team-current-feature-overview.md](docs/team-current-feature-overview.md) / [.zh.md](docs/team-current-feature-overview.zh.md) —— 团队模式当前真正能做什么。
- [docs/team-self-hosted-botbrowser.md](docs/team-self-hosted-botbrowser.md) / [.zh.md](docs/team-self-hosted-botbrowser.zh.md) —— BotBrowser 专用 runbook（保留兼容引擎）。
- [docs/team-product-test-plan.md](docs/team-product-test-plan.md) / [.zh.md](docs/team-product-test-plan.zh.md) —— 验收测试计划。

## 许可证

AGPL-3.0 —— 见 [LICENSE](LICENSE)。任何衍生作品必须以同一许可证保持开源。你放在 `vendor-private/cloakbrowser/` 下的 Cloak Chromium runtime 是单独的资产，受 CloakHQ 自己的许可证约束 —— 本仓库只知道怎么加载它。

上游 Donut Browser 版权归原作者 [zhom/donutbrowser](https://github.com/zhom/donutbrowser) 所有。本 fork 不主张对上游工作的所有权 —— 只主张 `c0d1b8f` 之后 commit 历史里记录的改动。
