# 团队版自托管 BotBrowser 使用手册

语言：[English](./team-self-hosted-botbrowser.md) | [中文](./team-self-hosted-botbrowser.zh.md)

这份文档用于启动本地团队版浏览器栈，并创建第一个可用的团队 profile。

当前版本所有功能和边界见 [团队版当前功能总览](./team-current-feature-overview.zh.md)。

## 0. 本地快速启动

启动自托管团队同步服务：

```bash
bash scripts/start-team-browser-stack.sh
```

本地服务地址：

```text
donut-sync API: http://127.0.0.1:12342
MinIO console:  http://127.0.0.1:8988
Next dev UI:    http://127.0.0.1:12341
```

检查后端：

```bash
curl http://127.0.0.1:12342/health
curl http://127.0.0.1:12342/readyz
```

运行产品 API 验收测试：

```bash
pnpm test:team-product
```

完整测试矩阵见 [团队版自托管产品测试计划](./team-product-test-plan.zh.md)。

部署方式、服务器配置和桌面安装包说明见 [团队版部署指南](./team-deployment-guide.zh.md)。

如果当前机器没有 `pnpm`，先创建本地 Corepack shim：

```bash
mkdir -p /private/tmp/corepack-bin
COREPACK_HOME=/private/tmp/corepack-cache corepack enable --install-directory /private/tmp/corepack-bin
```

在当前 shell 中使用这个 Corepack shim：

```bash
export PATH="/private/tmp/corepack-bin:/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH"
export COREPACK_HOME=/private/tmp/corepack-cache
```

安装依赖：

```bash
pnpm install
```

如果缺少 `cargo`，安装 Rust：

```bash
HOMEBREW_NO_AUTO_UPDATE=1 brew install rust
```

先构建一次 Donut sidecar 二进制，避免 Tauri 等前端时超时：

```bash
pnpm copy-proxy-binary
```

启动 Donut Desktop：

```bash
pnpm tauri dev
```

检查运行中的进程：

```bash
pgrep -fl 'tauri dev|next dev|donutbrowser'
```

停止桌面端开发会话：在运行 `pnpm tauri dev` 的终端里按 `Ctrl+C`。

停止服务端：

```bash
cd donut-sync
docker compose down
```

## 1. 启动服务端

在仓库根目录运行：

```bash
bash scripts/start-team-browser-stack.sh
```

默认本地管理员账号：

```text
email: admin@example.com
password: change-me
```

真实团队使用时请覆盖默认值：

```bash
JWT_SECRET='replace-with-a-long-random-secret' \
ADMIN_EMAIL='admin@your-team.com' \
ADMIN_PASSWORD='replace-with-a-strong-password' \
bash scripts/start-team-browser-stack.sh
```

健康检查：

```bash
curl http://127.0.0.1:12342/health
```

预期返回：

```json
{"status":"ok"}
```

常用服务地址：

```text
donut-sync API: http://127.0.0.1:12342
MinIO console:  http://127.0.0.1:8988
```

`docker-compose.yml` 使用 `public.ecr.aws/docker/library/postgres:16`、`quay.io/minio/minio:latest` 和 `public.ecr.aws/docker/library/node:22-alpine`，本地启动不依赖 Docker Hub。

## 2. 以管理员登录

```bash
TOKEN="$(curl -sS http://127.0.0.1:12342/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"change-me"}' \
  | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
```

## 3. 创建团队用户

最快 Web 管理路径：

1. 打开 `http://127.0.0.1:12342/admin`。
2. 用管理员账号登录。
3. 打开 `用户`。
4. 填写邮箱、临时密码和角色。
5. 点击 `创建用户`。

推荐桌面端操作：

1. 在 Donut Desktop 打开 Sync settings。
2. 用管理员账号登录 `Self-hosted`。
3. 点击 `团队管理`。
4. 打开 `用户`，填写邮箱、临时密码和角色，然后点击 `创建用户`。

CLI 备用方式：

```bash
curl -sS http://127.0.0.1:12342/v1/admin/users \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"email":"a@team.local","password":"a-password","role":"member"}'

curl -sS http://127.0.0.1:12342/v1/admin/users \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"email":"b@team.local","password":"b-password","role":"member"}'
```

查看用户列表：

```bash
curl -sS http://127.0.0.1:12342/v1/admin/users \
  -H "authorization: Bearer $TOKEN"
```

## 4. 上传 BotBrowser `.enc` 模板

推荐桌面端操作：

1. 在 `团队管理` 打开 `BotBrowser 模板`。
2. 选择本地 `.enc` 文件。
3. 填写模板名称、浏览器大版本和平台。
4. 点击 `上传`。

CLI 备用方式：

先把 BotBrowser 加密 profile 放到本地，例如：

```text
/Users/zhongziyun/Desktop/template.enc
```

上传模板：

```bash
ENC_BASE64="$(base64 < /Users/zhongziyun/Desktop/template.enc | tr -d '\n')"

curl -sS http://127.0.0.1:12342/v1/admin/bot-profiles \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"default-bot-template\",\"contentBase64\":\"$ENC_BASE64\",\"browserMajorVersion\":\"120\",\"platform\":\"macos\"}"
```

保存返回结果里的 `id`，后面记为 `BOT_ASSET_ID`。

## 5. 启动 Donut Desktop

安装依赖并启动桌面端：

```bash
corepack enable
pnpm install
pnpm copy-proxy-binary
pnpm tauri dev
```

如果 `pnpm` 不可用，可以通过 Node Corepack 运行：

```bash
COREPACK_HOME=/private/tmp/corepack-cache corepack pnpm install
COREPACK_HOME=/private/tmp/corepack-cache corepack pnpm copy-proxy-binary
COREPACK_HOME=/private/tmp/corepack-cache corepack pnpm tauri dev
```

## 6. 登录自托管同步

在 Donut Desktop 里：

1. 打开 Sync settings。
2. 选择 `Self-hosted`。
3. Server URL 填：

```text
http://127.0.0.1:12342
```

管理员登录后会看到 `团队管理` 按钮。这个面板可以管理团队用户、BotBrowser 模板、团队 profile、profile 权限、强制解锁和带 action/profile/user 筛选的审计日志。普通成员使用同一个自托管登录入口，但不会看到管理员面板。

4. 使用团队用户登录，例如：

```text
email: a@team.local
password: a-password
```

## 7. 创建第一个共享 Chromium profile

推荐桌面端操作：

1. 点击 `Create Profile`。
2. 选择 `Chromium` / `Wayfern`。
3. 输入 profile 名称。
4. 按需要配置代理、指纹、扩展或 DNS 选项。
5. 创建 profile。

只要已经登录 self-hosted 团队账号，Donut 现在会自动把这个 Wayfern/Chromium profile 当成团队环境处理：

- 在本机创建 profile metadata 和指纹配置；
- 在服务端注册对应的 `TeamProfile`，engine 为 `wayfern`；
- sync mode 自动设为 `Regular`；
- Donut 会短暂获取服务端 lock，上传初始 profile metadata/manifest，然后释放 lock。

这才是正常 AdsPower 类产品的默认流程：默认共享 Chromium 环境不需要 BotBrowser `.enc` 模板。

BotBrowser 仍然保留为高级 engine。只有当你明确想用某个 Chromium 兼容可执行文件配合预制 `.enc` 指纹 profile 时才选择 `BotBrowser`。这种情况下管理员需要先上传 `.enc` 模板，或者创建者填写本地 `.enc` 路径。

CLI 调试备用方式：

```bash
PROFILE_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
PROFILE_DIR="$HOME/Library/Application Support/DonutBrowserDev/profiles/$PROFILE_ID"
mkdir -p "$PROFILE_DIR"
```

把 `BOT_ASSET_ID_HERE` 替换成第 4 步返回的 asset id：

```bash
cat > "$PROFILE_DIR/metadata.json" <<EOF
{
  "id": "$PROFILE_ID",
  "name": "Team Bot Profile 01",
  "browser": "botbrowser",
  "engine": "botbrowser",
  "version": "external",
  "sync_mode": "Regular",
  "host_os": "macos",
  "botbrowser_config": {
    "executable_path": "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "bot_profile_asset_id": "BOT_ASSET_ID_HERE",
    "locale": "en-US",
    "timezone": "America/Los_Angeles",
    "languages": "en-US,en",
    "local_dns": true,
    "port_protection": true
  }
}
EOF
```

重启 Donut Desktop，profile 应该会出现在列表中。这个 CLI fallback 只用于 BotBrowser 调试；正常团队环境应该在桌面 UI 里创建 Wayfern/Chromium profile。

## 8. 成员加入共享 Profile

管理员授权后，成员不需要手动创建本地 profile，可以直接加入共享 profile：

1. 登录同一个自托管服务器。
2. 打开顶部菜单，点击 `共享 Profiles`。
3. 找到目标 Chromium/Wayfern profile。
4. 点击 `加入本机`。
5. 点击 `预检`，检查登录状态、启动权限、浏览器运行时/指纹数据和 lock 状态。
6. 预检通过后点击 `启动`。

如果是高级 BotBrowser profile，Shared Profiles 会额外显示可选的 BotBrowser executable path，并在预检时检查 `.enc` 模板。

Wayfern/Chromium 共享 profile 现在可以从成员入口一键加入和启动。Camoufox 团队 profile 记录仍然兼容服务端数据，但当前版本还不开放成员一键启动。

常见预检失败处理：

| 失败项 | 处理方式 |
| --- | --- |
| 自托管登录 | 回到 Sync settings 重新登录。 |
| 启动权限 | 让管理员授予 `owner` 或 `editor` 权限。 |
| 浏览器运行时 | 下载需要的 Wayfern/Chromium 运行时；如果是 BotBrowser profile，则填写有效的 BotBrowser executable path。 |
| 指纹数据 | Wayfern 会自动生成指纹数据；如果是 BotBrowser profile，则让管理员上传并选择 `.enc` 模板。 |
| Profile 锁 | 等另一个用户关闭 profile；如果锁已经异常残留，让管理员强制解锁。 |

## 9. 启动和共享

用户 A 启动 profile 时，流程是：

```text
Donut 获取服务端 lock
Donut 下载最新服务端 profile 状态
仅 BotBrowser profile 会在本地缺少 .enc asset 时自动下载
Donut 启动所选 engine
Donut 持续发送 lock heartbeat
浏览器关闭后，Donut 先等待 profile 文件稳定
Donut 在仍持有 lock 时同步 cookies/local storage/profile files
Donut 释放 lock
```

给用户 B 授权：

推荐桌面端操作：

1. 管理员打开 `Sync settings` → `团队管理`。
2. 打开 `Profile`。
3. 在目标 profile 里选择用户 B 和 `Editor`。
4. 点击 `保存权限`。

CLI 备用方式：

```bash
curl -sS http://127.0.0.1:12342/v1/team-profiles/$PROFILE_ID/permissions \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"userId":"B_USER_ID","permission":"editor"}'
```

如果 B 在 A 使用同一个 profile 时启动，会收到 lock conflict。A 关闭浏览器并同步完成后，B 可以打开 `共享 Profiles`，加入或刷新本地 profile，再启动同一个 profile，并复用服务端保存的状态。

## 10. 停止服务端

```bash
cd donut-sync
docker compose down
```

删除所有本地服务端数据：

```bash
cd donut-sync
docker compose down -v
```
