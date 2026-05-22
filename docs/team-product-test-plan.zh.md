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
| BotBrowser assets | 管理员通过兼容 API 上传 `.enc` bytes 并查看 asset 列表 | asset 存储到 `teams/{teamId}/bot_profiles/{id}.enc`，用于历史或高级 BotBrowser 记录 |
| Chromium profile 创建 | 成员 A 在 self-hosted 登录状态下创建 Wayfern/Chromium profile | profile engine 为 `wayfern`，sync mode 为 `Regular`，A 自动获得 owner 权限，初始 metadata/manifest 已上传 |
| Cloak profile 创建 | 成员 A 在 self-hosted 登录状态下创建 Cloak Chromium 团队 profile | profile engine 为 `cloak`，sync mode 为 `Regular`，A 自动获得 owner 权限，不需要 `.enc` asset |
| Chromium 共享动作 | 成员 A 对已有本地 Wayfern profile 点击 `共享到团队` | profile 注册成 team profile，sync mode 变为 `Regular`，当前本地状态已上传 |
| Asset 引用 | 管理员删除仍被 live profile 引用的模板 | 请求返回 409 |
| 隔离性 | 未共享的 B list/get/download/upload/lock A 的 profile | profile 被隐藏或请求返回 403 |
| Viewer | 管理员给 B viewer 权限 | B 能读 profile metadata，但不能上传、加锁、加入为可启动 profile 或启动 |
| 共享列表 | 管理员给 B editor 权限 | B 的 `team_list_profiles` 结果包含该共享 profile |
| 本地加入 Chromium | B 把共享 Wayfern/Chromium profile 加入本机 | 本地 `BrowserProfile` 使用团队 profile id、`engine: "wayfern"`、browser `wayfern` 和 sync mode `Regular` |
| 本地加入 Cloak | B 把共享 Cloak Chromium profile 加入本机 | 本地 `BrowserProfile` 使用团队 profile id、`engine: "cloak"`、browser `cloak`、确定性的指纹 seed 和 sync mode `Regular` |
| 重复加入 | B 再次加入同一个共享 profile | 更新已有本地 profile metadata，不创建重复 profile |
| 预检权限 | Viewer 运行共享 profile 预检 | 权限检查失败，并返回可读结果 |
| 预检运行时 | Editor 在缺 Chromium 运行时时运行预检 | 失败项明确指出缺运行时 |
| Asset 权限 | Viewer 尝试上传 `bot_profiles/*.enc` | 请求返回 403 |
| Lock gate | Editor B 未持有 lock 时上传 | upload presign 返回 403 |
| Editor sync | Editor B 获取 lock 后通过 presigned URL 上传 metadata | 上传成功，`stat` 能看到对象 |
| Lock 冲突 | B 持有 lock 时 owner A 尝试 lock | 请求返回 409 |
| 预检 lock | A 持有 lock 时 B 运行预检 | lock 检查失败，并且浏览器启动前被拦截 |
| Lock 生命周期 | B heartbeat、unlock，之后 A 获取 lock | heartbeat、unlock 和 takeover 成功 |
| 管理员解锁 | 管理员强制释放其他用户持有的 lock | lock 被释放，其他用户可以重新获取 |
| 下载/删除 | A 下载 B 上传的 profile 文件并带 tombstone 删除 | 下载 bytes 匹配，对象被删除，tombstone 创建成功 |
| 撤销权限 | 管理员移除 B 的权限 | B 不能再 get 该 profile |
| 禁用用户 | 管理员禁用 C | C 无法再次登录，也不能复用旧 JWT |
| Soft delete | A 删除 profile | profile 从 A 的列表消失，直接 get 被拒绝 |
| Audit | 管理员读取并筛选 audit log | 关键操作记录存在，action 过滤可用，user 过滤能收窄到指定操作者/目标用户 |

## 手动桌面验收

这些用例需要真实 Donut Desktop。默认 Wayfern/Cloak Chromium 流程不需要 `.enc` 文件；BotBrowser 专项用例在本 MVP 中只作为兼容项。

| 模块 | 用例 | 预期结果 |
| --- | --- | --- |
| 桌面登录 | 打开 Donut，配置 self-hosted URL、email、password | 重启应用后登录状态仍然存在 |
| Team Admin UI | 管理员打开主界面 Team 菜单并点击团队管理 | 可在桌面端管理用户、Wayfern/Cloak profile、权限、lock 和审计日志 |
| 共享动作 | A 对本地 Wayfern 或 Cloak profile 点击共享到团队 | 发布弹窗说明服务器权威源，sync 被启用，profile 出现在团队管理里 |
| Shared Profiles UI | B 打开 Team → 共享 Profiles | B 能看到所有授权给自己的 profile，以及权限、engine、lock 和本地状态 |
| 加入 Chromium 共享 profile | B 对 Wayfern/Chromium profile 点击加入本机 | 本地主列表出现该 profile，保持相同 profile id，并使用 sync mode `Regular` |
| 加入 Cloak 共享 profile | B 对 Cloak Chromium profile 点击加入本机 | 本地主列表出现该 profile，保持相同 profile id，启动时使用安装包内置 Cloak runtime |
| 不支持 engine | B 看到 BotBrowser 或 Camoufox 团队 profile | UI 显示当前不支持一键启动 |
| 预检 UI | 在共享 Profiles 里运行预检 | 登录、权限、浏览器运行时/指纹数据和 lock 检查都有可读 pass/fail 文案 |
| Chromium profile 创建 | self-hosted 登录后创建 Wayfern/Chromium profile | profile 不需要选择模板，出现在本地列表和团队列表中 |
| 启动参数 | 启动共享 Wayfern profile | 进程使用共享本地 profile data dir 和正常 Wayfern Chromium 启动参数 |
| Cloak 启动参数 | 启动共享 Cloak profile | 进程使用共享本地 profile data dir、`--fingerprint=<seed>` 和内置 CloakBrowser 可执行文件 |
| Lock UI | A 启动 profile，B 同时启动同一个 profile | B 看到冲突并无法启动 |
| 状态同步 | A 登录测试网站后关闭浏览器，B 在 unlock 后启动 | B 能看到 A 保留的登录状态 |
| 关闭稳定等待 | A 写入 cookie/local storage 后关闭共享 Chromium/BotBrowser profile | Donut 等待 profile 文件稳定后上传；超时会记录 warning，但仍尝试同步 |
| 跨机器 | B 在另一台机器登录 | 共享 Wayfern/Cloak profile 数据下载到本地缓存并启动 |
| 代理 | 测试 HTTP、SOCKS5、SOCKS5H 代理 | 共享 Chromium runtime 收到正确的本地代理参数，流量从代理出口出去 |
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
