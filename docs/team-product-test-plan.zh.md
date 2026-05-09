# 团队版自托管产品测试计划

语言：[English](./team-product-test-plan.md) | [中文](./team-product-test-plan.zh.md)

这份测试计划适用于团队版：自托管 `donut-sync`、Postgres、MinIO/S3、Donut Desktop 和 BotBrowser。

## 快速运行

启动本地产品栈：

```bash
bash scripts/start-team-browser-stack.sh
```

运行黑盒产品 API 测试：

```bash
pnpm test:team-product
```

使用非默认管理员账号或远程服务：

```bash
TEAM_TEST_BASE_URL=https://sync.example.com \
ADMIN_EMAIL=admin@example.com \
ADMIN_PASSWORD='your-password' \
pnpm test:team-product
```

运行现有回归测试：

```bash
pnpm lint
pnpm test
```

## 自动化产品用例

`scripts/team-product-test.mjs` 像真实桌面客户端一样调用运行中的 API，不依赖 Nest 内部对象。

| 模块 | 用例 | 预期结果 |
| --- | --- | --- |
| 健康检查 | `/health` 和 `/readyz` | 服务可访问，S3 已就绪 |
| 认证 | 管理员登录和 `/v1/me` | JWT 可用，并返回 `mode: "team"` |
| 用户 | 管理员创建 A/B/C 用户并查看列表 | 新用户出现在管理员用户列表中 |
| 管理权限 | 普通成员访问 admin 用户列表 | 请求返回 403 |
| BotBrowser assets | 管理员上传 `.enc` bytes 并查看 asset 列表 | asset 存储到 `teams/{teamId}/bot_profiles/{id}.enc` |
| Profile 创建 | 成员 A 创建引用 asset 的 BotBrowser profile | profile engine 为 `botbrowser`，A 自动获得 owner 权限 |
| 隔离性 | 未共享的 B list/get/download/upload/lock A 的 profile | profile 被隐藏或请求返回 403 |
| Viewer | 管理员给 B viewer 权限 | B 能读 profile metadata 和下载 `.enc`，但不能上传或加锁 |
| Asset 权限 | Viewer 尝试上传 `bot_profiles/*.enc` | 请求返回 403 |
| Lock gate | Editor B 未持有 lock 时上传 | upload presign 返回 403 |
| Editor sync | Editor B 获取 lock 后通过 presigned URL 上传 metadata | 上传成功，`stat` 能看到对象 |
| Lock 冲突 | B 持有 lock 时 owner A 尝试 lock | 请求返回 409 |
| Lock 生命周期 | B heartbeat、unlock，之后 A 获取 lock | heartbeat、unlock 和 takeover 成功 |
| 下载/删除 | A 下载 B 上传的 profile 文件并带 tombstone 删除 | 下载 bytes 匹配，对象被删除，tombstone 创建成功 |
| 撤销权限 | 管理员移除 B 的权限 | B 不能再 get 该 profile |
| 禁用用户 | 管理员禁用 C | C 无法再次登录 |
| Soft delete | A 删除 profile | profile 从 A 的列表消失，直接 get 被拒绝 |
| Audit | 管理员读取 audit log | 关键操作记录存在 |

## 手动桌面验收

这些用例需要真实 Donut Desktop 和真实 BotBrowser 兼容 `.enc` 文件。

| 模块 | 用例 | 预期结果 |
| --- | --- | --- |
| 桌面登录 | 打开 Donut，配置 self-hosted URL、email、password | 重启应用后登录状态仍然存在 |
| BotBrowser 路径 | 选择或自动探测 BotBrowser/Chromium 可执行文件 | 启动 profile 时不再重复询问 |
| Profile 创建 | 创建 BotBrowser profile 并绑定已上传 `.enc` asset | profile 出现在团队列表中 |
| 启动参数 | 启动 profile | 进程包含 `--bot-profile`、`--user-data-dir`、`--remote-debugging-port`、`--disable-blink-features=AutomationControlled` |
| Lock UI | A 启动 profile，B 同时启动同一个 profile | B 看到冲突并无法启动 |
| 状态同步 | A 登录测试网站后关闭浏览器，B 在 unlock 后启动 | B 能看到 A 保留的登录状态 |
| 跨机器 | B 在另一台机器登录 | profile 和 `.enc` 下载到本地缓存并启动 |
| 代理 | 测试 HTTP、SOCKS5、SOCKS5H 代理 | BotBrowser 收到正确的 `--proxy-server`，流量从代理出口出去 |
| 崩溃恢复 | 浏览器或 App 持有 lock 时被杀掉 | lock 过期或管理员能 unlock，之后可重新启动 |
| Viewer UX | Viewer 打开共享 profile | Viewer 能查看 metadata，但不能启动或写入 |

## 发布门槛

团队内部产品级交付前，至少要求：

1. `pnpm lint` 通过。
2. `pnpm test` 通过。
3. `pnpm test:team-product` 在同一个服务端构建上通过。
4. macOS 上完成至少一次手动桌面验收。
5. 第二台干净机器或 VM 上完成跨机器验收。
6. 管理员上传真实 BotBrowser `.enc` 模板，非管理员 editor 能下载。
7. 测试 profile 经过关闭、重开、另一用户启动后，Cookie/LocalStorage 状态符合预期。

## 注意事项

部署时必须把 `S3_PUBLIC_ENDPOINT` 设置成桌面客户端能访问的 URL。内部 `S3_ENDPOINT` 可以是 `http://minio:9000`，但 presigned URL 必须用 public endpoint 签名。
