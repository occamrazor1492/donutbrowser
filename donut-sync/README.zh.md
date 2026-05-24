# donut-sync

Languages: [English](./README.md) | [中文](./README.zh.md)

[Donut Browser（内部使用 fork）](../README.zh.md)的自托管团队同步服务。

`donut-sync` 是一个 NestJS API，后端用 **Postgres**（用户、团队、profile 元数据、权限、锁、审计日志）和 **S3 兼容对象存储**（profile bundle、BotBrowser `.enc` 模板、扩展、tombstone —— 默认捆绑 MinIO）。桌面 app 用 JWT 鉴权，大 blob 通过 presigned URL 直接和对象存储往返。

完整部署走查（env 变量、Postgres schema、HTTPS、AWS S3 / Cloudflare R2 / MinIO 各种配置、Caddy / Nginx 示例）见 [**docs/self-hosting-donut-sync.md**](../docs/self-hosting-donut-sync.zh.md)。下面是 TL;DR。

## 快速开始（Docker）

```bash
cp .env.example .env   # 然后改 ADMIN_EMAIL / ADMIN_PASSWORD / JWT_SECRET
docker compose up -d
```

会起来：

- `postgres`（镜像：`public.ecr.aws/docker/library/postgres:16`）—— 仅 Docker 内网
- `minio` —— S3 绑 `127.0.0.1:8987`，console 绑 `127.0.0.1:8988`
- `donut-sync` —— NestJS API 绑 `127.0.0.1:12342`

验证：

```bash
curl http://127.0.0.1:12342/health   # {"status":"ok"}
curl http://127.0.0.1:12342/readyz   # {"status":"ready","s3":true}
```

首次启动时根据 `ADMIN_EMAIL` / `ADMIN_PASSWORD` bootstrap 初始管理员账号。

## 两种运行模式

| 模式 | Env 开关 | 鉴权 | 何时用 |
|---|---|---|---|
| **团队模式（默认）** | `MULTI_USER_ENABLED=true` | 逐用户 JWT，bcrypt 哈希密码 | 真实团队 —— 多用户、权限、锁、管理 UI |
| **Legacy 单 token** | `MULTI_USER_ENABLED=false` | 共享 bearer `SYNC_TOKEN` | 单用户 / 兼容原上游模型 |

桌面 app 的团队 UI（`团队管理` / `共享 Profiles` / `分享 profile`）只在团队模式下出现。

## 必填环境变量

```env
MULTI_USER_ENABLED=true
DATABASE_URL=postgresql://donut:donut@postgres:5432/donut
JWT_SECRET=<openssl rand -hex 32>
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<初始管理员密码>

S3_ENDPOINT=http://minio:9000                # 服务端访问 S3
S3_PUBLIC_ENDPOINT=http://127.0.0.1:8987     # 客户端跟随 presigned URL 走这个地址
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=donut-sync
S3_FORCE_PATH_STYLE=true                     # MinIO / R2 / DO Spaces

PORT=12342                                   # 本 fork 默认值
```

完整 env 变量参考和各 S3 服务商示例（AWS S3、Cloudflare R2、MinIO 挂反向代理后）在 [docs/self-hosting-donut-sync.md](../docs/self-hosting-donut-sync.zh.md)。

## 存储布局

每个对象都按已认证 JWT 所属团队隔离：

```text
teams/{teamId}/profiles/{profileId}/metadata.json
teams/{teamId}/profiles/{profileId}/manifest.json
teams/{teamId}/profiles/{profileId}/files/...
teams/{teamId}/bot_profiles/{botProfileAssetId}.enc
teams/{teamId}/extensions/...
teams/{teamId}/tombstones/...
```

大 blob（`.enc` 模板、profile bundle）完全绕过 API —— 桌面端通过 presigned upload/download URL 直接打 `S3_PUBLIC_ENDPOINT`。

## Postgres schema

权威来源：[`prisma/schema.prisma`](prisma/schema.prisma)。概念上的表：

| 表 | 用途 |
|---|---|
| `Team` | 团队容器 —— 其它每一行都归属到某一个团队 |
| `User` | Email、bcrypt 哈希后的密码、角色（`admin`/`member`）、禁用标志 |
| `TeamProfile` | Profile 元数据、引擎、同步模式、可选的 BotBrowser asset 引用 |
| `ProfilePermission` | 逐 (user, profile) 的 `owner` / `editor` / `viewer` |
| `ProfileLock` | 每个 profile 一条活跃写锁 + heartbeat 时间戳 |
| `BotProfileAsset` | 已上传的 BotBrowser `.enc` 模板，按哈希去重 |
| `AuditLog` | 登录、profile 创建/删除、分享、锁获取/释放 |

迁移：

```bash
pnpm db:migrate    # 应用未执行的迁移
pnpm db:generate   # 修改 schema 后重新生成类型化的 Prisma client
```

## 开发

```bash
pnpm install
pnpm db:generate
pnpm start:dev     # NestJS 在 PORT 上热重载
```

产品验收套件端到端打已部署的服务：

```bash
pnpm test:team-product   # 在仓库根目录执行
```

它会建一个真实的测试团队、profile、锁，做 presigned 上传 + 下载，做删除 + tombstone 传播。在把部署 promote 之前先对 staging 跑一遍。

单元测试：

```bash
pnpm test
pnpm test:cov
```

## 另见

- [docs/self-hosting-donut-sync.md](../docs/self-hosting-donut-sync.zh.md) —— 带 HTTPS 示例的完整自托管指南
- [docs/team-deployment-guide.md](../docs/team-deployment-guide.md) ([中文](../docs/team-deployment-guide.zh.md)) —— VPS + 宝塔 / Caddy / Nginx 走查
- [docs/architecture.md](../docs/architecture.zh.md) —— 桌面端和服务器是怎么对接起来的
- [docs/team-current-feature-overview.md](../docs/team-current-feature-overview.md) —— 团队模式当前真正能做什么
