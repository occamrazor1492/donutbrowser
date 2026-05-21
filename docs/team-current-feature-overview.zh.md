# 团队版当前功能总览

语言：[English](./team-current-feature-overview.md) | [中文](./team-current-feature-overview.zh.md)

这份文档梳理当前团队版自托管浏览器构建已经具备的功能、服务器和客户端分别负责什么，以及哪些能力仍然属于内部测试级别，还不是完整公开发行软件。

## 产品定位

当前版本是一个团队内部可试用的自托管多用户浏览器 MVP。

它适合：

- 团队 profile 权威数据保存在自己的服务器。
- 多个用户用团队账号登录。
- 管理员管理用户、共享 Chromium profile、权限、锁和审计日志。
- Wayfern/Chromium 作为默认团队共享浏览器环境。
- BotBrowser 仅作为兼容数据和当前团队 MVP 主流程之外的高级 engine 保留。
- Mac/Windows 桌面客户端在每个用户自己的电脑上运行浏览器进程。

它不是：

- 网页远程浏览器控制台。
- 云端浏览器画面串流系统。
- 商业化托管 SaaS。
- 已完整签名的公开发行桌面软件。
- 同一个 profile 的实时多人协作编辑系统。

## 三种浏览器环境和共享状态

当前版本支持三类浏览器环境，但共享能力不同：

| 环境 | engine/browser | 当前共享状态 | 备注 |
| --- | --- | --- | --- |
| Wayfern/Chromium | `wayfern` / `wayfern` | 默认支持，推荐团队日常使用 | 本地创建后点击 `共享到团队`，或沿用 self-hosted 同步流程注册并上传；不需要 `.enc` 模板。 |
| BotBrowser | `botbrowser` / `botbrowser` | 当前客户端 MVP 只做兼容保留 | 已有服务端记录和 `.enc` asset 会保留，但正常客户端共享流程不再要求成员导入模板。 |
| Camoufox/Firefox | `camoufox` / `camoufox` | 当前不开放成员一键共享启动 | 服务端 metadata 兼容保留，但不作为本轮团队共享验收路径。 |

因此，用户创建和共享环境时应优先选择 `Chromium` / `Wayfern`。BotBrowser 和 Camoufox 数据会保留兼容，但都不是当前版本的团队共享主流程。

## 服务端功能

服务器是团队数据的权威源。本机客户端只是缓存和运行环境。

当前服务端组件：

- `donut-sync` NestJS API。
- Postgres 保存用户、团队、profile metadata、权限、锁和审计日志。
- MinIO 或其他 S3-compatible 对象存储保存 profile 文件、manifest、tombstone、扩展和 BotBrowser `.enc` 模板。
- Nginx、Caddy 或宝塔管理的 Nginx 做 HTTPS 反向代理。

当前服务端数据模型：

- `Team`：团队容器。
- `User`：邮箱、密码哈希、角色、禁用状态。
- `TeamProfile`：团队 profile metadata、engine、sync mode、可选 BotBrowser 模板引用。
- `ProfilePermission`：`owner`、`editor` 或 `viewer`。
- `ProfileLock`：每个 profile 一个活动写锁。
- `BotProfileAsset`：上传的 BotBrowser `.enc` 模板。
- `AuditLog`：关键团队操作和同步操作。

当前对象存储路径：

```text
teams/{teamId}/profiles/{profileId}/metadata.json
teams/{teamId}/profiles/{profileId}/manifest.json
teams/{teamId}/profiles/{profileId}/files/...
teams/{teamId}/bot_profiles/{botProfileAssetId}.enc
teams/{teamId}/extensions/...
teams/{teamId}/tombstones/...
```

## 认证和权限

自托管团队模式支持 JWT 登录。

当前认证行为：

- `MULTI_USER_ENABLED=true` 开启团队 JWT 模式。
- `POST /v1/auth/login` 给启用状态的用户返回 JWT。
- `GET /v1/me` 返回用户、角色、团队和 team mode。
- 被禁用的用户不能登录。
- 被禁用的用户不能继续复用旧 token。
- 团队模式关闭时，旧的单人 `SYNC_TOKEN` 模式仍然保留。

当前角色：

| 角色 | 含义 |
| --- | --- |
| `admin` | 可以管理团队用户、BotBrowser 模板、profile、权限、锁和审计日志。 |
| `member` | 可以使用自己拥有或被授权访问的 profile。 |

当前 profile 权限：

| 权限 | 可读 metadata | 可下载 asset | 可启动/写入 | 可管理权限 |
| --- | --- | --- | --- | --- |
| `owner` | 可以 | 可以 | 可以 | 可以 |
| `editor` | 可以 | 可以 | 可以 | 不可以 |
| `viewer` | 可以 | 可以 | 不可以 | 不可以 |
| `admin` 角色 | 可以 | 可以 | 可以 | 可以 |

## 后端 API 功能

当前认证接口：

```http
POST /v1/auth/login
POST /v1/auth/logout
GET  /v1/me
```

当前管理员接口：

```http
POST   /v1/admin/users
GET    /v1/admin/users
PATCH  /v1/admin/users/:id

POST   /v1/admin/bot-profiles
GET    /v1/admin/bot-profiles
DELETE /v1/admin/bot-profiles/:id

GET    /v1/admin/audit-logs
```

当前团队 profile 接口：

```http
GET    /v1/team-profiles
POST   /v1/team-profiles
GET    /v1/team-profiles/:id
PATCH  /v1/team-profiles/:id
DELETE /v1/team-profiles/:id

POST   /v1/team-profiles/:id/permissions
DELETE /v1/team-profiles/:id/permissions/:userId

POST   /v1/team-profiles/:id/lock
POST   /v1/team-profiles/:id/lock/heartbeat
POST   /v1/team-profiles/:id/unlock
```

当前同步对象接口：

```http
POST /v1/objects/stat
POST /v1/objects/list
POST /v1/objects/presign-upload
POST /v1/objects/presign-upload-batch
POST /v1/objects/presign-download
POST /v1/objects/presign-download-batch
POST /v1/objects/delete
POST /v1/objects/delete-prefix
GET  /v1/objects/subscribe
```

重要后端行为：

- team mode 下对象路径会被 scope 到 `teams/{teamId}/...`。
- 用户只能访问自己团队的数据。
- 普通用户只能看到自己拥有或被分享的 profile，管理员可以看到团队内 profile。
- `viewer` 不能上传、删除、加锁或启动。
- `editor`、`owner` 和 `admin` 在 lock 允许时可以启动和写入。
- 上传 profile object 前必须持有未过期 lock。
- BotBrowser 模板仍被 live profile 引用时不能删除。
- Audit log 支持 `limit`、`action`、`targetType`、`targetId` 和 `userId` 筛选。
- 管理员可以强制释放异常残留的 profile lock。

## 桌面客户端功能

桌面端仍然是 Tauri App，前端是 Next.js，后端是 Rust。

当前桌面端功能：

- 自托管登录，填写 server URL、email、password。
- JWT 走现有安全 token 存储。
- 如果配置了 Donut Cloud，仍然优先使用 Donut Cloud；否则使用 self-hosted JWT。
- self-hosted 登录后 team key prefix 会解析成 `teams/{teamId}/`。
- 原来的本地 profile 列表仍然保留。
- Wayfern/Chromium 团队 profile 可以无模板创建、通过 `共享到团队` 发布、加入本机、预检、启动、同步和分享。
- BotBrowser/Camoufox 记录仍然兼容服务端数据，但当前桌面端共享流程以 Wayfern 为主。

当前团队模式 Tauri commands：

```text
team_list_users
team_create_user
team_update_user

team_list_bot_profiles

team_list_profiles
team_create_profile
team_update_profile
team_delete_profile

team_set_profile_permission
team_delete_profile_permission
team_unlock_profile

team_list_audit_logs
team_materialize_profile
team_publish_wayfern_profile
team_preflight_botbrowser_profile
```

当前错误映射：

- 未登录。
- 非管理员请求。
- 权限不足。
- Lock conflict。
- Team API 不可访问。
- S3 或 presigned URL 失败。
- 缺少 Wayfern/Chromium runtime。

## 管理员 UI 功能

当前产品形态有两个管理入口：

| 入口 | 用途 |
| --- | --- |
| Donut Desktop `团队管理` | 正式产品主入口。桌面客户端已经安装，并且管理员用 self-hosted 登录后使用。 |
| 服务器 `/admin` Web Admin | 轻量初始化和兜底入口。适合还没安装桌面客户端、快速创建用户，或者客户端不可用时做应急管理。 |

两个入口调用同一套 `/v1/...` API，管理的是同一套团队数据。

管理员在 Donut Desktop 登录自托管服务器后会看到 `团队管理` 入口。

当前 `团队管理` tabs：

| Tab | 当前能力 |
| --- | --- |
| 用户 | 查看用户、创建用户、重置密码、切换 `admin` 或 `member`、禁用或启用用户。 |
| Profiles | 查看 Wayfern/Chromium 团队 profile、修改名称、删除 profile、分配权限、移除权限、强制 unlock。 |
| Audit Logs | 查看最近日志，按 action、target type、target id 和 user 筛选。 |

管理员 UI 的用户可见文案都走翻译系统，并同步在 7 个 locale 文件里。

服务器 `/admin` 页面当前支持：

- 管理员登录。
- 用户列表、创建、修改角色、重置密码、禁用和启用。
- BotBrowser `.enc` 模板上传、列表和删除。
- 团队 profile 创建、列表、删除、权限授予/移除和强制 unlock。
- Audit log 列表和基础筛选。

## 成员共享 Profile 功能

成员 self-hosted 登录后可以使用 `共享 Profiles` 入口。

当前成员流程：

1. 登录同一个自托管服务器。
2. 打开 `共享 Profiles`。
3. 查看被分享的团队 profile，以及权限、engine、lock 状态和本地状态。
4. 对 Wayfern/Chromium profile，点击 `加入本机` 会下载服务端 profile metadata 和状态。
5. 运行 `预检`。
6. 预检通过后点击 `启动`。

当前 materialize 行为：

- `team_materialize_profile(profileId, executablePath?)` 创建或更新本地 `BrowserProfile`。
- 本地 profile 保持和团队 profile 相同的 id。
- 重复加入同一个共享 profile 会更新本地 metadata，不会创建重复 profile。
- Wayfern/Chromium profile 会下载服务端 metadata/profile state，并使用 `engine: "wayfern"`、`browser: "wayfern"` 和 `sync_mode: "Regular"`。
当前限制：

- 成员一键加入和启动支持 Wayfern/Chromium profile。
- BotBrowser 和 Camoufox 团队 profile 记录仍然兼容服务端数据，但这个版本刻意不开放成员一键启动。

## 共享 Chromium 执行功能

Wayfern/Chromium 是当前 MVP 的默认团队执行引擎。用户可以先创建本地 Wayfern profile，然后在主列表或 profile 详情动作里点击 `共享到团队`。Donut 会注册 team profile、启用 `Regular` sync、把当前 metadata/manifest 上传到团队前缀，并在每次启动/写入时使用 lock。

当前共享 Wayfern 流程：

```text
本地 Wayfern profile
-> 共享到团队
-> 注册 TeamProfile(engine=wayfern)
-> 获取 lock
-> 上传当前 profile 状态
-> 释放 lock
-> 成员从 Shared Profiles 加入
```

## 预检功能

启动共享 profile 前，客户端会运行 `team_preflight_botbrowser_profile(profileId)`。命令名为了兼容暂时保留，但当前客户端 MVP 只把 Wayfern/Chromium 作为可启动共享 engine。

当前检查项：

| 检查项 | 含义 |
| --- | --- |
| 自托管登录 | 用户已经登录 self-hosted server。 |
| 权限 | 用户是 `admin`、`owner` 或 `editor`。 |
| 浏览器运行时 | Wayfern/Chromium runtime 可用。 |
| 指纹数据 | Wayfern/Chromium 已同步指纹 metadata，不需要 `.enc` 模板。 |
| Lock | Profile 没有被其他用户锁定。 |

UI 会在启动前显示可读的通过或失败结果。

## Lock 和同步功能

当前版本每个 profile 使用一个 writer lock。

启动和同步顺序：

```text
用户点击启动
客户端检查权限
客户端申请 profile lock
客户端下载最新 profile 状态
客户端启动 Chromium/Wayfern
浏览器运行期间客户端持续发送 lock heartbeat
浏览器退出
客户端等待 profile 文件稳定
客户端在仍持有 lock 时同步本地 profile 变更
客户端释放 lock
```

当前 lock 行为：

- 默认 lock 时长是 30 分钟。
- 客户端 heartbeat 会续期 lock。
- 一个用户持有 lock 时，另一个用户会收到冲突。
- 管理员可以强制 unlock。
- 过期 lock 可以被重新获取。

当前关闭后同步行为：

- Wayfern 退出后，客户端会等待 profile 文件稳定再上传。
- 稳定的定义是连续两次采样文件 size 和 modified time 都不变。
- 等待覆盖常见 Chromium 存储文件，包括 SQLite/WAL、LocalStorage、Cookies 和相关 profile 文件。
- 最长等待 5 秒。
- 超时后仍然尝试 sync，并记录 warning。
- 如果 sync 失败，lock 仍会释放，本地缓存保留，方便后续重试。

## 部署功能

当前支持的部署方式：

- 自己服务器上用 Docker Compose 部署。
- Postgres 16。
- MinIO S3-compatible object storage。
- `donut-sync` Node 服务。
- Nginx、Caddy 或宝塔管理的 Nginx 提供 HTTPS。

当前推荐公网入口：

```text
https://sync.example.com -> donut-sync API
https://s3.example.com   -> MinIO S3 API
```

当前宝塔兼容部署行为：

- 宝塔可以继续接管公网 `80/443`。
- Docker 服务绑定到本机端口，例如 `127.0.0.1:12342`、`127.0.0.1:8987`、`127.0.0.1:8988`。
- Postgres 只留在 Docker 网络。
- 桌面客户端需要 presigned URL 访问时，只通过 HTTPS 反代暴露 MinIO S3 API。

当前 Cloudflare 建议：

- 首次部署推荐 DNS-only 记录。
- Cloudflare 可以用于 DNS、HTTPS、WAF、Tunnel，也可以后续考虑 R2。
- 完整迁移到 Workers + D1 不属于当前版本。

## 当前已部署服务器

当前内部已部署服务器对应的是这个 MVP 的服务端部分。真实域名、IP、面板地址、用户名和密码不能写进仓库。

文档里用这个公开形态表示：

```text
https://sync.<team-domain> -> donut-sync API
https://s3.<team-domain>   -> MinIO S3 API
```

2026-05-20 已验证：

```text
/health -> {"status":"ok"}
/readyz -> {"status":"ready","s3":true}
```

这个已部署服务器现在能做：

- 通过 HTTPS 提供 self-hosted team sync API。
- 用 Postgres 保存团队 profile metadata 的权威数据。
- 用 S3-compatible 对象存储保存 profile 文件、manifest、tombstone 和 BotBrowser `.enc` 模板。
- 在 `MULTI_USER_ENABLED=true` 时使用 JWT 团队登录。
- 支持已初始化的管理员账号。
- 管理员可以创建、禁用、启用和更新用户。
- 管理员可以上传 BotBrowser `.enc` 模板，并且模板仍被 live profile 引用时不能删除。
- 用户和管理员可以创建默认 Wayfern/Chromium team profile，不需要上传 `.enc` 模板。
- 如果已有 `.enc` 模板，用户和管理员也可以创建高级 BotBrowser team profile。
- 管理员和 owner 可以分配 `owner`、`editor` 和 `viewer` 权限。
- 强制执行 viewer 只读行为。
- 强制执行 lock、heartbeat、持锁上传、冲突、unlock 和管理员强制 unlock 行为。
- 给桌面客户端生成 presigned upload/download URL。
- 对 login、user、template、profile、permission、lock 和关键对象同步动作写入 audit log。
- 为当前桌面端的 `团队管理` 和 `共享 Profiles` 流程提供足够的 API。
- 部署这个版本后，会提供轻量 `/admin` Web Admin 页面，用于初始化和兜底管理。

这个已部署服务器自己不能做：

- 服务器不运行 BotBrowser 或 Chromium。
- 不通过网页串流浏览器画面。
- 不会自动生成真实 BotBrowser `.enc` 模板，必须由管理员上传。
- 不能替代 Mac 或 Windows 桌面客户端。
- 不提供已签名的 Mac 或 Windows 安装包。
- 不能省掉每个用户电脑上的本地 BotBrowser 或 Chromium executable。

实际含义：

- 已部署后端已经可以做 API 级团队测试。
- 真正团队试用仍需要每个用户安装匹配的桌面客户端构建。
- 真实 profile 复用仍需要真实 BotBrowser `.enc` 模板，以及 A/B 用户桌面端手动验收。

## 桌面安装包状态

当前 macOS 状态：

- 可以构建 Apple Silicon 内部测试 `.dmg`。
- 本地已有 ad-hoc signed 内部测试 `.dmg`，路径在 `release-artifacts/`。
- 该目录已被 Git 忽略，不会上传到仓库。
- 还没有 Developer ID 签名，也没有 notarization。
- 内测用户可能需要右键 `Open`，或者移除 quarantine 后打开。

当前 Windows 状态：

- Windows installer 构建命令已经写入文档。
- 真正的 Windows `.exe` 或 `.msi` 应该在 Windows 机器或 Windows CI runner 上构建。
- 未签名 Windows build 可能触发 Microsoft Defender SmartScreen。
- Windows 还需要单独验收 executable path、启动参数、关闭后同步和路径错误提示。

## 自动化测试覆盖

当前自动化检查包括：

- `pnpm format`
- `pnpm lint`
- `pnpm test`
- `pnpm test:team-product`
- Rust 单元测试覆盖团队 profile materialize、preflight 行为和文件稳定等待。
- Product-level 黑盒 API 测试覆盖运行中的自托管服务。

当前产品测试覆盖：

- Health 和 readiness。
- 管理员登录和 `/v1/me`。
- 用户创建、列表、更新和禁用。
- 普通用户调用 admin API 返回拒绝。
- BotBrowser 模板上传、列表和删除规则。
- 团队 profile 创建、列表、读取、更新和删除。
- Profile 权限授予和移除。
- Viewer 只读行为。
- Editor lock 和 upload 行为。
- Lock conflict、heartbeat、unlock 和管理员强制 unlock。
- 被禁用用户旧 token 被拒绝。
- Audit log 筛选。
- 共享 profile materialize。
- Preflight 的权限、浏览器运行时/指纹数据和 lock conflict 失败场景。

## 仍需手动验收

以下项目需要真实桌面端和真实浏览器测试：

- macOS 上真实 Wayfern/Chromium runtime。
- 高级 BotBrowser 专项验收需要真实 BotBrowser executable 和 `.enc` 模板。
- A/B 用户共享登录状态流程。
- 浏览器关闭后 cookie/local storage 同步。
- 第二台机器或干净用户环境下载同一个共享 profile。
- Windows executable path 选择和 Windows 进程行为。
- Mac 正式签名和 notarization 流程。
- Windows 签名安装包流程。

## 已知限制

当前限制是 MVP 阶段刻意保留的：

- 没有完整独立的 Web 管理后台。服务器 `/admin` 是轻量初始化和兜底工具；正式主入口仍然是 Donut Desktop `团队管理`。
- 没有浏览器画面串流。
- 服务器不远程运行浏览器。
- 不支持同一个 profile 的实时多人协作编辑。
- Camoufox 团队 profile 暂不支持成员一键启动。
- 还没有公开发行级别的 Mac 或 Windows 签名安装包。
- 没有自动备份恢复 UI。
- 没有组织级 SSO。
- 没有 per-profile 存储配额 UI。
- 高级 BotBrowser profile 没有内置 `.enc` 生成器；默认 Wayfern/Chromium 团队流程不需要 `.enc`。

## 最短可用路径

团队内部测试可以按这个顺序走：

1. 用 Docker Compose 部署 `donut-sync`、Postgres 和 MinIO。
2. 给 `sync.example.com` 和 `s3.example.com` 配 HTTPS。
3. 在每个用户电脑上安装或构建桌面客户端。
4. 管理员通过 self-hosted sync 登录。
5. 管理员创建用户。
6. 管理员或 owner 从 `Create Profile` 创建 Wayfern/Chromium team profile。
7. 管理员给另一个用户授予 `editor`。
8. 第二个用户打开 `共享 Profiles`，加入本机，运行预检，然后启动。
9. 验证 lock conflict、关闭后同步和共享登录状态。
