# 技术架构

Languages: [English](./architecture.md) | [中文](./architecture.zh.md)

这个 fork 在引擎盖下到底是怎么工作的 —— 哪些东西跑在哪里、数据结构长什么样、和上游有什么区别、每个子系统在源码树的哪个位置。

如果只想要一个偏总览的"和上游有什么区别"，看 [README.md § 与上游的差异](../README.zh.md#与上游的差异)。这份文档是更深入的拆解。

## 高层结构

```text
┌─────────────────────────────────────────────────────────────────┐
│ Donut 桌面 app（每个用户一个进程，本机运行）                       │
│                                                                 │
│ ┌─────────────────────────┐    ┌────────────────────────────┐   │
│ │ Next.js 16 前端          │◀──▶│ Tauri 2 Rust 后端           │   │
│ │  React 19 + Turbopack   │ IPC│  ~100 #[tauri::command]s   │   │
│ │  Tailwind, biome lint   │    │  src-tauri/src/lib.rs      │   │
│ └─────────────────────────┘    └────┬───────────────────────┘   │
│                                     │ spawns                    │
│                                     ▼                           │
│      ┌──────────┬──────────┬──────────┬──────────┐              │
│      │ Wayfern  │ Cloak    │ Camoufox │ BotBrws  │              │
│      │ Chromium │ Chromium │ Firefox  │ Chromium │              │
│      └──────────┴──────────┴──────────┴──────────┘              │
│       （每个 profile = 独立进程 + 独立 user-data-dir）             │
└─────────────────────────────────────────────────────────────────┘
                    │
              REST / 类 WebSocket 轮询
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│ donut-sync 服务器（自己跑在 VPS 上，见自托管文档）                  │
│                                                                 │
│ ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐  │
│ │ NestJS API   │──▶│ Postgres     │   │ S3 / MinIO           │  │
│ │ JWT auth     │   │ users, teams │◀──│ profile bundles,     │  │
│ │ team admin   │   │ profiles,    │   │ .enc templates,      │  │
│ │ permissions  │   │ permissions, │   │ extensions,          │  │
│ │ profile-lock │   │ locks, audit │   │ tombstones           │  │
│ │ presign URLs │   └──────────────┘   └──────────────────────┘  │
│ └──────────────┘                                                │
└─────────────────────────────────────────────────────────────────┘
```

桌面 app 在完全离线情况下也能用 —— 所有浏览器引擎都在本机跑，每个 profile 的数据都在本地磁盘上。同步服务器是团队共享 profile 的**权威副本**，但单用户场景完全不需要跟它通信（同步是逐 profile opt-in 的）。

## 为什么这个 fork 拆掉了云端控制面

上游 `zhom/donutbrowser` 在 `donut-sync` 之上还有**第二个**服务（`donutbrowser.com`），负责：

- 订阅校验（"这个用户是不是还在付费？"）
- 地理位置代理租用
- 云端发的 Wayfern 指纹 token（用于跨 OS 指纹）
- device-code OAuth 登录

本 fork 不跑那一套基础设施。但与其把散落在 `browser_runner.rs`、`team_lock.rs`、`wayfern_manager.rs`、`mcp_server.rs`、`sync/engine.rs` 等等处的 ~40 个 `CLOUD_AUTH.*` 调用点全部删掉，fork 选择把 `src-tauri/src/cloud_auth.rs` 替换成一个 160 行的桩，保留同样的 `CLOUD_AUTH` 单例和方法名，但返回宽松默认值：

| 方法 | Stub 返回 | 效果 |
|---|---|---|
| `has_active_paid_subscription()` | `true` | 所有"用户是不是在付费？"的门槛直接放行 |
| `is_fingerprint_os_allowed(os)` | `true` | 没有 OS 白名单 |
| `is_logged_in()` | `false` | "云端用户是否登录？"永远是否 —— 调用点直接走自托管那条路径 |
| `get_user()` | `None` | 没有云端用户可报告 |
| `get_wayfern_token()` | `None` | Wayfern 仍然能用，只是没有跨 OS 指纹这个特性 |
| `sync_cloud_proxy()` | no-op | 没有云端管理的代理需要同步 |
| `is_on_team_plan()` | `false` | 这里不存在"团队套餐"这一档 —— 自托管团队是另一个概念（见下文） |

打桩的目的是**保持调用点不变**：代码库其它地方一行都不用改。Pro 功能 gating 的 UI（徽章、模糊遮罩、加密同步收费墙）是另一波清扫 —— 那些 prop（`crossOsUnlocked`、`syncUnlocked`、`limitedMode`、`canUseEncryption`）从每个组件里都拆掉了，因为它们读的是 `cloudUser?.plan`，打桩后会永远是 `false`。

## 浏览器引擎

四种引擎并存。每一个都知道怎么做这三件事：

1. 定位自己的 runtime binary
2. 生成 launch flag（指纹、代理、user-data-dir）
3. 管理逐 profile 的数据目录

| 引擎 | 来源 | Runtime 位置 | 指纹机制 |
|---|---|---|---|
| **Wayfern** | [wayfern.com](https://wayfern.com) 的 Chromium fork | 自动下载到 `~/Library/Application Support/DonutBrowser/binaries/wayfern/<version>/Chromium.app` | 逐 profile 的 `wayfern_config` —— UA、platform、屏幕尺寸、accept-language、时区、WebGL 等 |
| **Cloak** | [github.com/CloakHQ/CloakBrowser](https://github.com/CloakHQ/CloakBrowser) 的 Chromium fork | 构建时从 `vendor-private/cloakbrowser/<platform>/Chromium.app` 打入 app bundle 的 `Contents/Resources/resources/cloakbrowser/` | 单一 `--fingerprint=<seed>` 参数 → 自定义 Chromium 补丁从一个确定性种子推导出所有属性。Seed 默认是 profile UUID 的哈希。 |
| **Camoufox** | [camoufox.com](https://camoufox.com) 的 Firefox fork | 自动下载到 `binaries/camoufox/<version>/Camoufox.app` | `src-tauri/src/camoufox/` 里的贝叶斯网络指纹生成器；逐 profile 的 `camoufox_config` 控制 OS / locale / WebGL / 字体 |
| **BotBrowser** | 老的 Chromium fork —— 只为兼容保留 | 逐 profile 的 `botbrowser_config.executable_path`，加上从团队服务器下载的 `.enc` 指纹模板 | `.enc` 模板在团队服务器创建时烤好；桌面端只消费它 |

**引擎在 profile 创建时选定**（`create-profile-dialog.tsx`），创建完就不可改。Launch 路径（`browser_runner.rs`）根据 `profile.browser` / `profile.engine` 派发到对应的引擎模块。

### Cloak vs Wayfern

两者都是带反检测补丁的 Chromium fork，但补丁面不一样：

- **Wayfern** 把 ~30 个具体指纹属性作为 Chromium 命令行参数暴露出来。公开 binary，更新频繁。
- **Cloak** 暴露单一确定性的 `--fingerprint=<seed>` 参数，由 Chromium 补丁内部展开成一致的指纹。参数面更小，但 binary 更难获取（macOS 公开 release 比 Linux 慢）。对抗指纹相关性攻击时的隐蔽性更好。

除非明确需要 Cloak 的隐蔽性，否则用 Wayfern。两者共享同一套 `chromium-launcher` 代码路径（`src-tauri/src/browser_runner.rs`）和同样的代理 / 扩展 / cookie 机制。

## Vault 加密

有些磁盘上的状态需要加密，因为里面有凭证：

- `~/.../DonutBrowser/settings/sync_token.dat` —— 自托管 JWT，AES-256-GCM 加密
- `~/.../DonutBrowser/settings/<various>.enc` —— 各种 settings secret（逐特性），用同一套方案

加密 key 是用 Argon2id 从烤进 binary 的**编译时 vault 密码**派生出来的：

```rust
// src-tauri/src/settings_manager.rs
fn get_vault_password() -> String {
  env!("DONUT_BROWSER_VAULT_PASSWORD").to_string()
}
```

`build.rs` 设了 `cargo:rerun-if-env-changed=DONUT_BROWSER_VAULT_PASSWORD`，env 变了 cargo 才会真的重新构建（上游有过一个真实 bug —— 没有这一行，cargo 会缓存老的 `rustc-env` 值，env 变了 binary 仍然用之前的 password）。

### 密码漂移时自愈

如果两次构建之间 vault 密码变了，之前所有加密过的文件都解不开。上游会把 AES 错误一路冒泡到 `acquire_team_lock_if_needed`，**把浏览器启动整个搞砖**，只丢出一个没用的 `Decryption failed` toast。本 fork 的 `get_sync_token`：

1. 尝试解密
2. 任何"文件不可用"的情况（bad magic、版本不对、framing 被截断、AES 失败）都打 warning 日志、**删掉坏文件**、返回 `Ok(None)`
3. 调用方看到"未登录"并优雅降级 —— 用户被提示重新登录

`settings_manager::tests::read_sync_token_discards_file_encrypted_with_wrong_vault_password` 是这个行为的回归测试。

## 团队模式鉴权流程

```text
桌面端                          donut-sync                Postgres
  │                                 │                        │
  │── POST /v1/auth/login ─────────▶│                        │
  │   { email, password }           │── SELECT user ────────▶│
  │                                 │◀──── user row ─────────│
  │                                 │── verify bcrypt        │
  │                                 │── sign JWT             │
  │◀── { token, user } ─────────────│                        │
  │                                                          │
  │── store_sync_token(token) ──┐                            │
  │   AES-GCM(vault_password)   │ → settings/sync_token.dat  │
  │   写 self_hosted_user.json（明文 JSON 缓存）              │
  │                                                          │
  │── invoke "get_team_locks" ────▶│── SELECT locks ────────▶│
  │   （每个团队操作都带 JWT          │                         │
  │    在 Authorization 头里）       │                         │
```

磁盘上有两个文件很关键：

- `self_hosted_user.json` —— `{id, email, role, teamId, ...}` 的明文 JSON 缓存，让 `cached_user()` 同步可用，永远不需要解密。`home-header.tsx` 读它来决定要不要显示 **团队** 菜单。
- `sync_token.dat` —— 加密后的 JWT。每次需要鉴权的团队 REST 调用都会读。

如果 `self_hosted_user.json` 在但 `sync_token.dat` 缺失或解不开，app 会*以为*用户已登录（团队菜单显示出来）但每次团队 REST 调用都 401。用户得重新登录。`get_sync_token` 的自愈（上面）自动覆盖这种情况。

## Profile 同步引擎

`src-tauri/src/sync/engine.rs` 是 Rust 后端最大的模块。它在后台运行，负责：

1. **逐 profile 的 manifest 同步** —— 每个 profile 有一个 `manifest.json`，列出每个文件和它的 SHA256。同步会比对本地和远端，通过 presigned URL 上传新增和变更的文件，下载远端新增的文件，传播 `tombstones/` 处理删除。
2. **加密同步** —— 可选的 E2E 密码（Argon2 + AES-GCM）会在上传前把每个文件包一层，这样连同步服务器都读不了。
3. **分组 + 代理同步** —— 小 JSON blob 作为单个对象上传。
4. **Profile bundle 往返** —— 把 profile 分享给团队时，整个 user-data-dir 打 tar 上传。
5. **后台计划同步** —— `src-tauri/src/task_scheduler.rs` 触发定时同步，无需用户操作。

## Profile 锁模型（团队模式）

`src-tauri/src/team_lock.rs` 给每个 profile 维护一个写锁，避免两个用户同时编辑同一个共享 profile。

```text
acquire_team_lock_if_needed(profile)
  │
  ▼ profile 启用同步了吗？
  no  ──▶ return Ok(())
  yes
  │
  ▼ 用户已自托管登录？
  no  ──▶ return Ok(())  （没有团队可锁）
  yes
  │
  ▼ self_hosted_team::register_team_profile(profile)
  │   POST/PATCH /v1/team-profiles/{id}
  │   ── 出错时：打 warning，return Ok(())  ◀── 本 fork 新增
  │
  ▼ acquire_self_hosted_lock(profile)
  │   POST /v1/team-profiles/{id}/lock
  │   ── 出错时：打 warning，return Ok(())  ◀── 本 fork 新增
  │
  return Ok(())
```

`── 出错时：打 warning，return Ok(())` 是本 fork **新增**的。上游对这两个调用都用 `?`，意味着团队服务器任何问题（DNS 不通、5xx、token 过期）都会把本地浏览器启动搞砖。现在启动会带着一条 warning 日志正常走完，下次启动时同步会重试。

持有锁的客户端每 30s heartbeat 一次。如果桌面进程挂了，heartbeat 停止，下一个要启动这个 profile 的用户会等租约过期（~90s）再抢。Profile 自己的文件系统并没有物理上锁 —— 这纯粹是协调信号。

## Pro 功能预检（只对 BotBrowser）

`src/app/page.tsx` 的启动时预检只对 **BotBrowser** profile 跑：

```ts
if (selfHostedSyncConfigured && profile.sync_mode !== "Disabled" && isBotBrowser) {
  const preflight = await invoke("team_preflight_botbrowser_profile", { profileId });
  if (!preflight.canLaunch) { showErrorToast(...); return; }
}
```

为什么只对 BotBrowser：

- BotBrowser **必须**有服务端的 `.enc` 指纹模板才能启动。缺模板 → 必定崩。值得拦住启动并丢出明确错误。
- Cloak / Wayfern / Camoufox 本地完全自洽。团队服务器只存它们的 config 和 cookie，不存 runtime。修这一处之前，本 fork 也对它们跑预检，结果是只要服务器对这个 profile id 有过期 / 404 的行，启动就会失败。现在它们直接走到 `launch_browser_profile`，上面那个 team-lock 的失败模式是热路径上唯一的同步触点。

## 源码布局速查

```text
src/                                # Next.js 前端
├── app/page.tsx                    # 入口：编排所有对话框 + 数据表
├── components/                     # ~50 个对话框 / UI 组件
│   ├── home-header.tsx             # 团队菜单下拉在这里（由 selfHostedUser 控制）
│   ├── sync-config-dialog.tsx      # 自托管登录（本 fork：拆掉了云端 tab）
│   ├── team-admin-dialog.tsx       # 管理员：用户 CRUD、profile 权限
│   ├── team-profiles-dialog.tsx    # 共享 profile 浏览 + 预检
│   ├── share-profile-dialog.tsx    # 把本地 profile 发布到团队
│   └── profile-data-table.tsx      # 主 profile 列表（currentUserId 驱动 team-lock 展示）
├── hooks/                          # 事件驱动的 React hook（use-browser-state、use-proxy-events 等）
├── i18n/locales/                   # en、es、fr、ja、pt、ru、zh —— 每条 UI 字符串
└── lib/                            # 主题（语义 CSS 变量）、datetime、toast helper

src-tauri/                          # Rust / Tauri 后端
├── src/
│   ├── lib.rs                      # ~100 个 Tauri 命令的 generate_handler! 注册
│   ├── cloud_auth.rs               # ★ 本 fork 已打桩 —— 见上面"为什么这个 fork 拆掉了…"
│   ├── self_hosted_auth.rs         # JWT 登录 + 读 self_hosted_user.json 的 cached_user()
│   ├── self_hosted_team.rs         # 团队 REST 包装（auth、profile CRUD、preflight、share）
│   ├── team_lock.rs                # 共享 profile 的分布式写锁
│   ├── browser_runner.rs           # 通用 launch/kill 编排
│   ├── browser.rs                  # Browser trait
│   ├── cloakbrowser.rs             # Cloak 专用 runtime 解析 + launch 参数
│   ├── wayfern_manager.rs          # Wayfern 下载 + 启动
│   ├── camoufox/                   # 贝叶斯指纹生成器（独立模块树）
│   ├── camoufox_manager.rs         # Camoufox 下载 + 启动
│   ├── botbrowser.rs               # BotBrowser 启动 + .enc 模板处理
│   ├── profile/                    # profile CRUD（manager.rs、types.rs）
│   ├── proxy_manager.rs            # 代理生命周期、地理定向代理、动态 URL 解析
│   ├── proxy_storage.rs            # 代理 JSON 持久化
│   ├── proxy_server.rs             # 本地代理 binary（donut-proxy sidecar）
│   ├── sync/                       # 同步引擎（engine.rs 是主力）
│   ├── settings_manager.rs         # AES 加密的磁盘 settings、缓存、vault password 处理
│   ├── api_server.rs               # 本地 REST API（utoipa + axum）
│   ├── mcp_server.rs               # 本地 MCP 协议服务
│   ├── vpn/                        # WireGuard 隧道
│   ├── daemon/                     # 后台 daemon + 托盘图标
│   ├── webhook_dispatcher.rs       # profile 生命周期事件的出站 webhook
│   ├── backup_manager.rs           # 完整本地备份 + 恢复
│   ├── template_manager.rs         # profile 模板
│   ├── cookie_snapshot.rs          # 版本化的 cookie 快照
│   ├── task_scheduler.rs           # 计划同步 / 启动 / 快照
│   ├── proxy_failover.rs           # 基于健康度的代理链 failover
│   └── ...（还有 ~20 个 —— 见 lib.rs 的 import）
├── build.rs                        # 把 DONUT_BROWSER_VAULT_PASSWORD + BUILD_VERSION 烤进 binary
└── Cargo.toml

donut-sync/                         # NestJS 同步服务器
├── src/
│   ├── main.ts                     # 入口 + env 校验
│   ├── auth/                       # JWT 登录、密码哈希、admin bootstrap
│   ├── team/                       # 团队 CRUD、profile 权限、锁、审计日志
│   ├── sync/                       # manifest 同步、presigned URL、tombstone 传播
│   ├── admin-web.controller.ts     # 老的 admin REST（保留以兼容）
│   └── config/env-validator.js     # 关键 env 缺失时 fail-fast（本 fork 新增）
├── prisma/
│   └── schema.prisma               # Postgres schema 的权威来源
└── docker-compose.yml              # postgres + minio + donut-sync 一整套

docs/                               # 当前目录
├── architecture.md                 # ← 你在这里
├── self-hosting-donut-sync.md      # 怎么跑同步服务
├── team-deployment-guide.md|.zh.md # VPS + 反向代理走查
├── team-current-feature-overview.md|.zh.md
├── team-self-hosted-botbrowser.md|.zh.md
└── team-product-test-plan.md|.zh.md
```

## 测试覆盖面

```text
Rust 单测                     459    `cargo test --lib`
Sync e2e（带真实服务）          15    `pnpm test:sync-e2e` → 起 docker 一套 + 驱动同步 API
后端 integration              15    `pnpm test:integration`
donut-sync Jest               14    `cd donut-sync && pnpm test`
```

pre-commit hook 在每次提交时跑 `typos + biome + cargo fmt + cargo clippy --all-targets -- -D warnings + cargo test --lib`；CI 在合并前重放完整测试矩阵。还有一个元测试（`test_no_unused_tauri_commands`），如果你新增了一个 `#[tauri::command]` 但前端没人调用，构建就会失败 —— 每个新后端命令都必须在 `src/` 某处至少有一处 `invoke()`。

## 延伸阅读

- [README.md](../README.zh.md) —— 安装、快速开始、顶层功能列表、许可证
- [self-hosting-donut-sync.md](./self-hosting-donut-sync.zh.md) —— 同步服务搭建、env 变量、S3 提供商、Caddy/Nginx
- [team-deployment-guide.md](./team-deployment-guide.md) ([中文](./team-deployment-guide.zh.md)) —— 生产 VPS 部署、宝塔面板、HTTPS、Cloak runtime 打包
- [team-current-feature-overview.md](./team-current-feature-overview.md) ([中文](./team-current-feature-overview.zh.md)) —— 团队模式当前真正能做什么
- [team-self-hosted-botbrowser.md](./team-self-hosted-botbrowser.md) ([中文](./team-self-hosted-botbrowser.zh.md)) —— BotBrowser 专用 runbook
- [team-product-test-plan.md](./team-product-test-plan.md) ([中文](./team-product-test-plan.zh.md)) —— 验收测试计划
- [AGENTS.md](../AGENTS.md)（= `CLAUDE.md`）—— 仓库约定、lint 规则、theming、i18n 严格度
