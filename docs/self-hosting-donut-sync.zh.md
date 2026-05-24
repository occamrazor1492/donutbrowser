# 自托管 `donut-sync`

Languages: [English](./self-hosting-donut-sync.md) | [中文](./self-hosting-donut-sync.zh.md)

`donut-sync` 是支撑这个内部使用 fork 的团队感知同步服务。它把用户账号、团队 profile 元数据、权限、profile 锁和审计日志存进 **Postgres**，把 profile bundle、扩展和 BotBrowser `.enc` 模板存进 **S3 兼容对象存储**（默认捆绑 MinIO）。

本指南讲怎么用 Docker Compose 自托管。如果想要带 HTTPS 的生产 VPS / 宝塔 / Caddy 走查，再读一下 [team-deployment-guide.md](./team-deployment-guide.md)（以及它的 [中文版](./team-deployment-guide.zh.md)）。

## 两种运行模式

| 模式 | 何时用 | 鉴权 |
|---|---|---|
| **`MULTI_USER_ENABLED=true`**（推荐） | 真实团队部署 —— 多用户、团队管理 UI、profile 权限、分布式锁、审计日志 | JWT 登录；每个用户有自己的 email 和密码；首次启动时根据 `ADMIN_EMAIL` / `ADMIN_PASSWORD` bootstrap 一个初始管理员 |
| **`MULTI_USER_ENABLED=false`**（legacy） | 单用户 / 单 token 部署，兼容原上游同步模型 | 共享 bearer `SYNC_TOKEN`；没有逐用户账号 |

本 fork 的桌面 UI 是围绕团队模式做的。legacy 模式在 API 层面仍然能用，但 app 里不会出现团队菜单 / 权限 / 锁。

## 前置条件

- [Docker](https://docs.docker.com/get-docker/) 和 [Docker Compose](https://docs.docker.com/compose/install/)
- 一个 S3 兼容对象存储 —— 默认捆绑 MinIO；AWS S3、Cloudflare R2、Backblaze B2、DigitalOcean Spaces 都通过同一套 env 变量工作

## 快速开始（完整本地栈）

仓库自带一份能跑的 `donut-sync/docker-compose.yml`：

```bash
cd donut-sync
cp .env.example .env  # 然后改 ADMIN_EMAIL / ADMIN_PASSWORD / JWT_SECRET
docker compose up -d
```

会起来：

- `postgres`（镜像：`public.ecr.aws/docker/library/postgres:16`）—— 仅 Docker 内网
- `minio`（镜像：`quay.io/minio/minio:latest`）—— S3 API 绑 `127.0.0.1:8987`，console 绑 `127.0.0.1:8988`
- `donut-sync` —— NestJS API 绑 `127.0.0.1:12342`

验证是否起来：

```bash
curl http://127.0.0.1:12342/health
# {"status":"ok"}

curl http://127.0.0.1:12342/readyz
# {"status":"ready","s3":true}
```

首次启动时，服务器会根据 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD` 创建初始管理员。

## 必填环境变量

### 团队模式（默认）

```env
MULTI_USER_ENABLED=true
DATABASE_URL=postgresql://donut:donut@postgres:5432/donut
JWT_SECRET=<run: openssl rand -hex 32>
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<初始管理员密码>

# 服务端 S3 endpoint（Docker 网络地址）
S3_ENDPOINT=http://minio:9000
# 面向客户端的 S3 endpoint（桌面端跟随 presigned URL 时访问这个）
S3_PUBLIC_ENDPOINT=http://127.0.0.1:8987

S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=donut-sync
S3_FORCE_PATH_STYLE=true

PORT=12342
```

| 变量 | 必需 | 说明 |
|---|---|---|
| `MULTI_USER_ENABLED` | 是 | `true` 走团队模式，`false` 走 legacy 单 token 模式 |
| `DATABASE_URL` | 团队模式 | Postgres 连接串 |
| `JWT_SECRET` | 团队模式 | 用来签 access token 的 32 字节随机 hex |
| `ADMIN_EMAIL` | 团队模式 | 初始管理员账号 —— 首次启动且没有任何用户时创建 |
| `ADMIN_PASSWORD` | 团队模式 | 初始管理员密码 —— 首次登录后立刻改掉 |
| `SYNC_TOKEN` | legacy 模式 | 共享 bearer token；团队模式下被忽略 |
| `SYNC_JWT_PUBLIC_KEY` | 可选 | legacy 模式下 `SYNC_TOKEN` 的替代 —— 用来校验外部签发的 JWT |
| `S3_ENDPOINT` | 是 | 服务端访问 S3 的地址（例如 Docker 内 `http://minio:9000`，或 `https://s3.amazonaws.com`） |
| `S3_PUBLIC_ENDPOINT` | 是 | 桌面 app 跟随 presigned upload/download URL 时访问的地址。MinIO 挂在反向代理后面时通常和 `S3_ENDPOINT` 不一样。 |
| `S3_REGION` | 否 | 默认 `us-east-1` |
| `S3_ACCESS_KEY_ID` | 是 | S3 access key（AWS 也可以用 IAM role） |
| `S3_SECRET_ACCESS_KEY` | 是 | S3 secret key |
| `S3_BUCKET` | 否 | 默认 `donut-sync`。如果你的服务商不会自动建 bucket，首次启动前先建好。 |
| `S3_FORCE_PATH_STYLE` | 视情况 | MinIO / R2 / DigitalOcean Spaces 等 path-style 服务商设 `true` |
| `PORT` | 否 | 本 fork 默认 `12342`（上游用 `3929`） |

### Legacy 单 token 模式

```env
MULTI_USER_ENABLED=false
SYNC_TOKEN=<run: openssl rand -hex 32>
S3_ENDPOINT=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET=donut-sync
PORT=12342
```

桌面客户端同步对话框里的 "advanced token" 模式对接的就是这个 —— 但你会失去团队管理 / 权限 / 锁。

## 存储布局

所有东西都按已认证团队的 id 隔离：

```text
teams/{teamId}/profiles/{profileId}/metadata.json
teams/{teamId}/profiles/{profileId}/manifest.json
teams/{teamId}/profiles/{profileId}/files/...
teams/{teamId}/bot_profiles/{botProfileAssetId}.enc
teams/{teamId}/extensions/...
teams/{teamId}/tombstones/...
```

- `metadata.json` —— profile 配置（浏览器、指纹配置、代理分配、分组）
- `manifest.json` —— 逐文件 SHA256 账本，驱动 delta 同步
- `files/...` —— 真正的 profile 数据（cookie SQLite、IndexedDB、扩展状态等）
- `bot_profiles/{id}.enc` —— BotBrowser 指纹模板资产，一次上传，团队成员共享
- `tombstones/` —— 删除标记，传播到其它设备，让 A 上的删除传到 B

大 blob（`.enc` 模板、profile bundle）通过 **presigned URL** 往返 —— 桌面端直接打 `S3_PUBLIC_ENDPOINT`，API 服务器从不代理这些字节。

## Postgres schema（团队模式）

`prisma/schema.prisma` 是权威来源。概念上：

| 表 | 存什么 |
|---|---|
| `Team` | 团队容器 —— 其它所有行都归属到某一个团队 |
| `User` | Email、bcrypt 哈希后的密码、角色（`admin` / `member`）、禁用标志 |
| `TeamProfile` | Profile 元数据、引擎、同步模式、可选的 BotBrowser asset 引用 |
| `ProfilePermission` | 逐 (user, profile) 的 `owner` / `editor` / `viewer` |
| `ProfileLock` | 每个 profile 一条活跃写锁 + heartbeat 时间戳 |
| `BotProfileAsset` | 已上传的 BotBrowser `.enc` 模板，按哈希去重 |
| `AuditLog` | 团队关键操作：登录、profile 创建/删除、分享、锁获取/释放 |

迁移用 Prisma 管：

```bash
cd donut-sync
pnpm db:migrate   # 部署时执行
pnpm db:generate  # 修改 schema 后重新生成类型化 client
```

## 健康检查端点

| 端点 | 用途 | 状态码 |
|---|---|---|
| `GET /health` | Liveness —— 服务器进程在跑 | 进程活着就一直 200 |
| `GET /readyz` | Readiness —— 服务器在跑**且** S3 可达 | S3 ping 成功 200，否则 503 |

把 `/readyz` 接到负载均衡 / 编排器的健康检查上，S3 出问题时会自动下线。

## 使用外部 S3 存储

把 `docker-compose.yml` 里的 `minio` service 去掉，换掉 env：

### AWS S3

```yaml
environment:
  MULTI_USER_ENABLED: "true"
  DATABASE_URL: postgresql://...
  JWT_SECRET: ...
  ADMIN_EMAIL: admin@example.com
  ADMIN_PASSWORD: ...
  S3_ENDPOINT: https://s3.us-east-1.amazonaws.com
  S3_PUBLIC_ENDPOINT: https://s3.us-east-1.amazonaws.com
  S3_REGION: us-east-1
  S3_ACCESS_KEY_ID: <aws-access-key>
  S3_SECRET_ACCESS_KEY: <aws-secret-key>
  S3_BUCKET: your-bucket
  # AWS 不要设 S3_FORCE_PATH_STYLE
```

### Cloudflare R2

```yaml
environment:
  S3_ENDPOINT: https://<account-id>.r2.cloudflarestorage.com
  S3_PUBLIC_ENDPOINT: https://<account-id>.r2.cloudflarestorage.com
  S3_REGION: auto
  S3_ACCESS_KEY_ID: <r2-access-key>
  S3_SECRET_ACCESS_KEY: <r2-secret-key>
  S3_BUCKET: your-bucket
  S3_FORCE_PATH_STYLE: "true"
```

### MinIO 挂在公网反向代理后面

```yaml
environment:
  # 服务端到 S3 留在 Docker 内
  S3_ENDPOINT: http://minio:9000
  # 桌面 app 跟随 presigned URL 走公网地址
  S3_PUBLIC_ENDPOINT: https://s3.example.com
  S3_REGION: us-east-1
  S3_ACCESS_KEY_ID: minioadmin
  S3_SECRET_ACCESS_KEY: minioadmin
  S3_BUCKET: donut-sync
  S3_FORCE_PATH_STYLE: "true"
```

## 配置桌面 app

1. 打开 Donut Browser
2. 右侧 `···` 下拉 → **账户**（英文界面叫 "Sync Service"，目前中文翻成"账户"）
3. **Server URL** —— 例如 `https://sync.example.com`
4. **Email + Password** —— 首次登录用管理员账号（即 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 设置的那个）
5. **保存**

登录成功后顶栏会多出 **团队**（Team）菜单。管理员还会看到 **团队管理**（Team Admin），在那里邀请更多用户。

## 安全

- **强 `JWT_SECRET`** —— `openssl rand -hex 32`，不要进 git
- **生产环境用 HTTPS** —— 在 `donut-sync` 前面用 Caddy / Nginx / Traefik 终结 TLS。JWT 在 `Authorization` 头里走，S3 presigned URL 把凭证写在 query string 里
- **不要把 Postgres 或 MinIO 直接暴露出去** —— 让它们留在 Docker 内网，只有 API 和（可选）`S3_PUBLIC_ENDPOINT` 通过反向代理出去
- **S3 凭证** —— AWS/R2 上请用只对该 bucket 有读写权限的专用 IAM key，不要用账户级 root 凭证
- **初始管理员密码** —— 首次登录后立刻去团队管理 UI 改掉

### 示例：Caddy

```caddy
sync.example.com {
    reverse_proxy 127.0.0.1:12342
}

s3.example.com {
    reverse_proxy 127.0.0.1:8987
}
```

### 示例：Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name sync.example.com;
    ssl_certificate     /etc/letsencrypt/live/sync.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sync.example.com/privkey.pem;

    client_max_body_size 200M;  # 大 profile 通过 API 上传时需要

    location / {
        proxy_pass http://127.0.0.1:12342;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name s3.example.com;
    ssl_certificate     /etc/letsencrypt/live/s3.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/s3.example.com/privkey.pem;

    client_max_body_size 0;  # MinIO 自己处理 range upload

    location / {
        proxy_pass http://127.0.0.1:8987;
        proxy_set_header Host $host;
        proxy_request_buffering off;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 运维

### 验收测试套件

栈起来之后：

```bash
cd donut-sync
pnpm test:team-product
```

它会用一个真实的测试团队打已部署的 API，并验证完整生命周期：建团队、建 profile、分享、获取锁、presigned 上传、presigned 下载、删除 + tombstone 传播。

### 从源码跑（dev 模式）

```bash
cd donut-sync
pnpm install
pnpm db:generate
pnpm start:dev   # NestJS 在 PORT（默认 12342）热重载
```

如果想要端到端的本地同步测试（同时驱动 Rust 客户端那侧）：

```bash
bash scripts/start-team-browser-stack.sh   # 起 docker + 等到 healthy
node scripts/sync-test-harness.mjs         # 跑同步 API
```

### 备份

要备份两样东西：

1. **Postgres** —— 定期 `pg_dump`。存的是用户 / 团队 / profile 元数据这种权威数据。
2. **S3 bucket** —— 用你 S3 服务商的快照 / lifecycle / versioning。存的是每个 profile bundle 和每个 `.enc` 模板。
   
桌面 app 不需要备份 —— 它们对服务器来说只是无状态缓存。

## 故障排查

| 症状 | 诊断 |
|---|---|
| `/readyz` 返回 503 且 `"s3":false` | `S3_ENDPOINT` 写错了、bucket 不存在，或者凭证没有权限。看 `docker compose logs donut-sync` 里底层 S3 报错。 |
| 桌面端登录成功但一直看不到团队菜单 | 用户角色是 `member`，且服务器上 `MULTI_USER_ENABLED` 是 false。看 `docker compose logs donut-sync` 启动行里是不是写了 "team mode"。 |
| 同步上传失败，redirect / 403 | `S3_PUBLIC_ENDPOINT` 不是桌面真正能访问到的地址。如果挂了反向代理，确认 HTTPS 终结正确，且 bucket 策略允许该 presigned 操作。 |
| 启动浏览器时报 `Failed to load self-hosted token: Decryption failed` | 桌面 binary 重新构建时 `DONUT_BROWSER_VAULT_PASSWORD` 和当初加密磁盘上 token 的那个不一样。近期 fork 构建会自愈：丢弃坏 token、打 warning、把你显示为未登录 —— 去 Settings → Sync 重新登录即可。老版本需要先手动删 `~/Library/Application Support/DonutBrowser/settings/sync_token.dat` 再登录。 |
