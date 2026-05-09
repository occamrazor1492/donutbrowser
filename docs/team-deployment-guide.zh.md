# 团队版部署指南

语言：[English](./team-deployment-guide.md) | [中文](./team-deployment-guide.zh.md)

这份文档说明哪些东西跑在服务器上，哪些东西留在每个用户电脑上，自托管服务器需要什么配置，以及 Mac/Windows 安装包应该怎么规划。

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

内部测试可以先用未签名版本，但 macOS 首次打开可能会警告。用户可能需要右键选择 Open，或者在 System Settings 里允许打开。

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

未签名版本可能触发 Microsoft Defender SmartScreen 警告。团队内部分发想更顺滑，需要 Windows code signing 证书。

Windows 需要单独验收：

```text
BotBrowser 或 Chromium 可执行文件选择
本地缓存路径
代理参数转换
浏览器关闭和同步行为
进程清理
```

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
