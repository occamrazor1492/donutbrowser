# 团队版部署指南

语言：[English](./team-deployment-guide.md) | [中文](./team-deployment-guide.zh.md)

这份文档说明哪些东西跑在服务器上，哪些东西留在每个用户电脑上，自托管服务器需要什么配置，以及 Mac/Windows 安装包应该怎么规划。

当前产品能力清单见 [团队版当前功能总览](./team-current-feature-overview.zh.md)。

## 第一版推荐部署方式

第一版团队内测建议全部后端服务都放在自己的服务器上：

```text
Ubuntu VPS
  Docker Compose
    caddy 或 nginx
    donut-sync
    postgres
    minio
```

域名建议：

```text
sync.example.com  -> donut-sync API
s3.example.com    -> MinIO S3 API
minio.example.com -> MinIO Console，可选，只给管理员访问
```

桌面客户端只需要填写同步 API 地址：

```text
https://sync.example.com
```

## 宝塔 / 已有 Nginx 部署方式

如果服务器已经跑了宝塔面板，让宝塔继续接管公网 `80/443`，团队浏览器后端放在它后面：

```text
宝塔 Nginx
  https://sync.example.com -> http://127.0.0.1:12342
  https://s3.example.com   -> http://127.0.0.1:8987

Docker Compose
  donut-sync -> 127.0.0.1:12342
  minio API  -> 127.0.0.1:8987
  minio UI   -> 127.0.0.1:8988，仅本机或管理员可选访问
  postgres   -> 仅 Docker 内网
```

不要把 Postgres 或 MinIO 直接绑定到公网。桌面客户端需要访问 MinIO 时，只通过 Nginx 暴露 S3 API，并配置 HTTPS：

```env
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=https://s3.example.com
```

Cloudflare DNS 第一版建议给 `sync.example.com` 和 `s3.example.com` 使用 DNS only。这样可以避开大 profile 同步和 S3 presigned URL 上传时的代理限制或行为差异。

部署密钥不要放进仓库。一个实用的放法是：

```text
/opt/donut-team/.env
/root/donut-team-credentials.txt
```

宝塔仍然可以展示和重载 Nginx 站点配置；`donut-sync`、Postgres 和 MinIO 的生命周期继续由 Docker Compose 管理。

## 服务器上跑什么

服务器保存团队 profile 的权威数据。服务器不运行浏览器，也不渲染浏览器画面。

```text
donut-sync API
  登录
  用户和团队管理
  Profile 权限
  Profile lock 和 heartbeat
  Audit log
  Presigned upload/download URL
  Sync API

Postgres
  用户
  团队
  Profile metadata
  权限
  Lock
  Audit log

MinIO
  Profile 文件
  Manifest 文件
  Cookie 和 LocalStorage 相关状态
  IndexedDB 和浏览器存储文件
  BotBrowser .enc 模板
  扩展文件
  Tombstone

Caddy 或 nginx
  HTTPS
  反向代理
  可选：限制 MinIO Console 访问
```

## 当前内部已部署环境

当前内部已部署环境是这个 MVP 的服务端后端。真实域名、IP、面板地址、用户名和密码不要写进仓库。

公网入口形态：

```text
https://sync.<team-domain> -> donut-sync API
https://s3.<team-domain>   -> MinIO S3 API
```

2026-05-20 已验证：

```text
/health -> {"status":"ok"}
/readyz -> {"status":"ready","s3":true}
```

这个已部署后端当前支持团队登录、轻量 `/admin` Web Admin 页面、管理员用户管理、BotBrowser 模板存储、团队 profile metadata、profile 权限、profile lock、lock heartbeat、管理员强制 unlock、presigned profile 上传/下载和 audit log。

它不运行浏览器进程，不串流浏览器画面，不托管已签名的 Mac/Windows 安装包，也不会自动生成 BotBrowser `.enc` 模板。每个用户仍然需要匹配的桌面客户端，以及本机 BotBrowser 或 Chromium executable。`/admin` 页面是初始化和兜底工具；正式产品主入口仍然是 Donut Desktop `团队管理`。

## 每个用户电脑上跑什么

BotBrowser 和 Chromium 跑在每个用户自己的 Mac 或 Windows 电脑上：

```text
用户电脑
  Donut Desktop
  BotBrowser 或 Chromium 可执行文件
  有权限 profile 的本地缓存
  有权限 BotBrowser .enc asset 的本地缓存
```

启动流程：

```text
用户登录
Donut 下载有权限的 profile 状态
如果本机缺少引用的 .enc 模板，Donut 自动下载
Donut 在本机启动 BotBrowser
Donut 持续发送 lock heartbeat
浏览器关闭
Donut 上传变化过的 profile 文件
Donut 释放 lock
```

## 服务器配置

小团队内测，大概 3-10 个用户、几十个 profile：

```text
CPU: 2 vCPU
内存: 4 GB RAM
硬盘: 100 GB SSD
网络: 10 Mbps 或更高
系统: Ubuntu 22.04 或 24.04 LTS
```

更舒服的团队内部部署：

```text
CPU: 4 vCPU
内存: 8 GB RAM
硬盘: 200-500 GB SSD
网络: 50 Mbps 或更高
系统: Ubuntu 22.04 或 24.04 LTS
```

因为服务器不跑浏览器，所以 CPU 通常不是瓶颈。更重要的是磁盘和带宽，因为 profile 状态会上传和下载。

## 存储估算

Postgres 一般不会太大。真正占空间的是 MinIO。

粗略 profile 大小：

```text
轻量 profile: 50-200 MB
重度 profile: 500 MB-2 GB
BotBrowser .enc 模板: 取决于模板，通常小于完整 profile 状态
```

例子：

```text
50 个 profile x 平均 300 MB = 大约 15 GB
```

还要给扩展文件、tombstone、增长、备份和偶尔很大的浏览器存储目录留空间。

## 必填环境变量

生产环境示例：

```env
MULTI_USER_ENABLED=true
DATABASE_URL=postgresql://donut:strong-password@postgres:5432/donut
JWT_SECRET=replace-with-a-long-random-secret
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace-with-a-strong-password
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=https://s3.example.com
S3_BUCKET=donut-sync
```

`S3_ENDPOINT` 是 `donut-sync` 在 Docker 内部访问对象存储的私有地址。`S3_PUBLIC_ENDPOINT` 必须能被每个桌面客户端访问，因为服务端会把 presigned URL 返回给客户端。

## Cloudflare 选项

Cloudflare 很有用，但第一版不建议完全 Cloudflare-native。

第一版适合用 Cloudflare 做：

```text
DNS
HTTPS
WAF
可选 Tunnel
可选用 R2 替代 MinIO
```

如果用 Cloudflare R2 替代 MinIO，要注意 R2 presigned URL 使用的是 R2 S3 API endpoint，不是普通自定义域名。`S3_ENDPOINT` 和 `S3_PUBLIC_ENDPOINT` 要按照 R2 的 S3 API endpoint 和凭证来配置。

第一版不建议直接重写成 Workers + D1。当前后端是围绕 Postgres 和 S3-compatible object storage 写的 NestJS 服务。完全迁到 Workers 和 D1 属于后端重构，不只是部署变化。

Cloudflare Containers 后续可以考虑用来跑 `donut-sync` 容器，但 Postgres 和对象存储仍然要明确处理。

## Mac 桌面安装包

Mac 可以用 Tauri 打包：

```text
.app
.dmg
```

本机 Apple Silicon 内部测试构建：

```bash
mkdir -p vendor-private/cloakbrowser/macos-aarch64
# 把 Apple Silicon 版 CloakBrowser .app 或可执行文件放到这个目录。
# 这个目录会被 git ignore，只在 Tauri 打包时复制进安装包。
pnpm build
PROFILE=release TARGET=aarch64-apple-darwin \
  pnpm tauri build --target aarch64-apple-darwin --bundles dmg
```

Tauri 默认输出：

```text
src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Donut_0.22.7_aarch64.dmg
```

当前团队内部测试请使用重新 ad-hoc 签名后的产物：

```text
release-artifacts/Donut_0.22.7_aarch64_internal-test.dmg
```

这个产物只适合 Apple Silicon Mac。它是 ad-hoc 签名，不是 Developer ID 签名，也没有 notarization，所以 Gatekeeper 不会把它当成正常公开发行软件。

内部成员安装步骤：

1. 打开 `.dmg`。
2. 把 `Donut.app` 拖到 `Applications`。
3. 如果 macOS 阻止打开，右键点击 `Donut.app`，选择 `Open`，再确认。
4. 如果仍然被拦截，执行：

```bash
xattr -dr com.apple.quarantine /Applications/Donut.app
open /Applications/Donut.app
```

Intel Mac 需要单独构建 `x86_64-apple-darwin` 版本。可以在装了 Intel target 的 Mac 上执行：

```bash
rustup target add x86_64-apple-darwin
mkdir -p vendor-private/cloakbrowser/macos-x64
# 构建前把 Intel 版 CloakBrowser .app 或可执行文件放到这个目录。
pnpm build
PROFILE=release TARGET=x86_64-apple-darwin \
  pnpm tauri build --target x86_64-apple-darwin --bundles dmg
```

如果想要接近正常软件的安装体验，需要：

```text
Apple Developer 账号
Developer ID Application 证书
codesign
notarization
```

## Windows 桌面安装包

Windows 最好在 Windows 机器或 Windows CI runner 上构建。

常见产物：

```text
.msi
.exe installer
```

在 Windows 机器上本机构建：

```powershell
pnpm install
mkdir vendor-private\cloakbrowser\windows-x64
# 构建前把 CloakBrowser Windows 可执行文件目录放到这里。
pnpm build
$env:PROFILE = "release"
$env:TARGET = "x86_64-pc-windows-msvc"
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis
```

未签名版本可能触发 Microsoft Defender SmartScreen 警告。团队内部分发想更顺滑，需要 Windows code signing 证书。

Windows 需要单独验收：

```text
CloakBrowser 内置 runtime 探测
本地缓存路径
代理参数转换
浏览器关闭和同步行为
进程清理
```

## 内部 CloakBrowser Runtime 打包

CloakBrowser 只进入内部私有桌面安装包。不要把 binary 提交到 git，也不要上传到公开 release。

打包前目录：

```text
vendor-private/cloakbrowser/macos-aarch64/...
vendor-private/cloakbrowser/macos-x64/...
vendor-private/cloakbrowser/windows-x64/...
vendor-private/cloakbrowser/linux-x64/...
```

`pnpm prepare-tauri-binaries` 会在 Tauri build 之前把这个私有目录复制到 `src-tauri/resources/cloakbrowser/`。复制后的 resource 目录也会被 git ignore。运行时，Cloak profile 会优先使用 `cloak_config.executable_path`，没有设置时使用安装包内置 runtime。如果两者都不存在，Shared Profiles 预检会明确提示缺少 CloakBrowser runtime。

### CloakBrowser binary 从哪儿拿

CloakBrowser 在 GitHub 上有公开 release：<https://github.com/CloakHQ/CloakBrowser/releases>。各平台节奏不一致 —— Linux x64 跟着每个 Chromium milestone 走，macOS arm64 一般落后一个大版本，Windows / macOS x64 偶尔放包。挑最近一个**带你需要平台 asset** 的 release：

```bash
# macOS Apple Silicon —— 截至 2026-05 已验证可用的版本
mkdir -p vendor-private/cloakbrowser/macos-aarch64
curl -fL -o /tmp/cloak.tgz \
  https://github.com/CloakHQ/CloakBrowser/releases/download/chromium-v142.0.7444.175/cloakbrowser-darwin-arm64.tar.gz
tar -xzf /tmp/cloak.tgz -C vendor-private/cloakbrowser/macos-aarch64
```

其它平台把 `darwin-arm64` 换成对应的 asset 名（`darwin-x64`、`linux-x64`、`windows-x64`）即可。要拿最新有该平台 asset 的 release，不一定是绝对的最新 release。

如果团队内部自己镜像了 CloakBrowser，也可以直接把解压后的 `Chromium.app` (macOS) / `chrome.exe` 文件夹 (Windows) / `chrome` 可执行文件树 (Linux) 手动放进对应的 `vendor-private/cloakbrowser/<platform>/` 目录。`src-tauri/src/cloakbrowser.rs::find_runtime_in_root` 会自动扫描里面的 `.app` bundle 或可执行文件。

### 已经装好的桌面 app 怎么热补丁加 Cloak runtime（不用重 build）

如果已经发了不带 Cloak 的桌面包，想后续给一台机器单独加上去，直接把 runtime 塞进安装好的 `.app` 包里再重新签名：

```bash
APP_TARGET="/Applications/Donut.app/Contents/Resources/resources/cloakbrowser/macos-aarch64"
mkdir -p "$APP_TARGET"
tar -xzf /tmp/cloak.tgz -C "$APP_TARGET"
xattr -dr com.apple.quarantine "$APP_TARGET/Chromium.app"
codesign --force --deep --sign - "$APP_TARGET/Chromium.app"
codesign --force --deep --sign - /Applications/Donut.app
```

（往签名后的 `.app` bundle 里改文件会让外层签名失效，所以最后要再签一次父 bundle。）Cloak profile 下次启动时就能自动找到这个 runtime，不用重启 app。

## 实际发布路线

推荐顺序：

1. 先用 Docker Compose 把后端部署到自己的服务器。
2. 配好 HTTPS 和域名。
3. 管理员上传真实 BotBrowser `.enc` 模板。
4. Mac 先用 dev build 或未签名安装包做内部测试。
5. 验证 profile lock、关闭后同步、跨电脑复用。
6. 构建 Mac `.dmg`。
7. 在 Windows 上构建并测试 Windows 安装包。
8. 团队流程稳定后再做签名和 notarization。

## 备份

需要备份两个数据源：

```text
Postgres dump
MinIO bucket data
```

在正式用于团队工作前，要把备份恢复到一台新服务器上测试一次。
