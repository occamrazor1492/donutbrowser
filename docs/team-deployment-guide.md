# Team Deployment Guide

Languages: [English](./team-deployment-guide.md) | [中文](./team-deployment-guide.zh.md)

This guide explains what runs on the server, what stays on each user's computer, how to size a self-hosted server, and how to think about Mac and Windows desktop packages.

## Recommended First Deployment

For the first team release, use your own server for all backend services:

```text
Ubuntu VPS
  Docker Compose
    caddy or nginx
    donut-sync
    postgres
    minio
```

Domains:

```text
sync.example.com  -> donut-sync API
s3.example.com    -> MinIO S3 API
minio.example.com -> MinIO Console, optional and admin-only
```

The desktop client only needs the sync API URL:

```text
https://sync.example.com
```

## What Runs On The Server

The server stores the authoritative team state. It does not run browsers and does not render browser screens.

```text
donut-sync API
  Login
  User and team management
  Profile permissions
  Profile locks and heartbeats
  Audit logs
  Presigned upload and download URLs
  Sync API

Postgres
  Users
  Teams
  Profile metadata
  Permissions
  Locks
  Audit logs

MinIO
  Profile files
  Manifest files
  Cookie and LocalStorage related state
  IndexedDB and browser storage files
  BotBrowser .enc templates
  Extensions
  Tombstones

Caddy or nginx
  HTTPS
  Reverse proxy
  Optional access control for the MinIO Console
```

## What Runs On Each Computer

BotBrowser and Chromium run locally on each user's Mac or Windows machine:

```text
User computer
  Donut Desktop
  BotBrowser or Chromium executable
  Local cache of permitted profiles
  Local cache of permitted BotBrowser .enc assets
```

Launch flow:

```text
User logs in
Donut downloads permitted profile state
Donut downloads the referenced .enc template if missing
Donut launches BotBrowser locally
Donut keeps a lock heartbeat alive
Browser closes
Donut uploads changed profile files
Donut releases the lock
```

## Server Size

Small internal team, roughly 3-10 users and dozens of profiles:

```text
CPU: 2 vCPU
Memory: 4 GB RAM
Disk: 100 GB SSD
Network: 10 Mbps or better
OS: Ubuntu 22.04 or 24.04 LTS
```

Comfortable internal deployment:

```text
CPU: 4 vCPU
Memory: 8 GB RAM
Disk: 200-500 GB SSD
Network: 50 Mbps or better
OS: Ubuntu 22.04 or 24.04 LTS
```

CPU is usually not the bottleneck because the server is not running browsers. Disk and bandwidth matter more because profile state is uploaded and downloaded.

## Storage Estimate

Postgres stays relatively small. MinIO consumes most of the disk.

Rough profile sizes:

```text
Light profile: 50-200 MB
Heavy profile: 500 MB-2 GB
BotBrowser .enc template: depends on the template, usually smaller than full profile state
```

Example:

```text
50 profiles x 300 MB average = about 15 GB
```

Add headroom for extensions, tombstones, growth, backups, and occasional large browser storage directories.

## Required Environment

Example production environment:

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

`S3_ENDPOINT` is the private address used by `donut-sync` inside Docker. `S3_PUBLIC_ENDPOINT` must be reachable from every desktop client because presigned URLs are returned to the client.

## Cloudflare Option

Cloudflare is useful, but the safest first release is not fully Cloudflare-native.

Good first use of Cloudflare:

```text
DNS
HTTPS
WAF
Optional Tunnel
Optional R2 instead of MinIO
```

If you use Cloudflare R2 instead of MinIO, keep in mind that R2 presigned URLs use the R2 S3 API endpoint, not a normal custom domain. Set the S3 endpoint values according to the R2 S3 API endpoint and credentials.

Avoid a full Workers + D1 rewrite for the first release. The current backend is a NestJS service built around Postgres and S3-compatible object storage. Moving it fully to Workers and D1 would be a backend rewrite, not just a deployment change.

Cloudflare Containers may be useful later for running the `donut-sync` container, but Postgres and object storage still need to be handled explicitly.

## Mac Desktop Package

Mac can be packaged as a Tauri desktop build:

```text
.app
.dmg
```

For internal testing, an unsigned build can be used, but macOS may warn on first launch. Users may need to right-click and choose Open or allow it in System Settings.

For a normal installation experience, use:

```text
Apple Developer account
Developer ID Application certificate
codesign
notarization
```

## Windows Desktop Package

Windows should be built on a Windows machine or Windows CI runner.

Expected package types:

```text
.msi
.exe installer
```

Unsigned builds may trigger Microsoft Defender SmartScreen warnings. For smoother team distribution, use a Windows code signing certificate.

Windows needs its own acceptance pass for:

```text
BotBrowser or Chromium executable selection
Local cache paths
Proxy argument conversion
Browser close and sync behavior
Process cleanup
```

## Practical Release Path

Recommended order:

1. Deploy the backend on your own server with Docker Compose.
2. Configure HTTPS and domain names.
3. Upload a real BotBrowser `.enc` template as admin.
4. Use a Mac dev build or unsigned package for internal testing.
5. Validate profile locking, close-time sync, and cross-computer reuse.
6. Build a Mac `.dmg`.
7. Build and test a Windows installer on Windows.
8. Add signing and notarization when the team workflow is stable.

## Backups

Back up both data stores:

```text
Postgres dump
MinIO bucket data
```

Backups should be tested by restoring into a fresh server before the system is trusted for real team work.
