# Linux Docker 服务器部署

本方案为单机正式部署基线。平台前后端、PostgreSQL、Redis 和 HTTPS 网关由 Docker Compose 管理；Dify、模型服务、法务接口使用服务器可达地址独立接入。本机开发服务与本方案项目名、数据卷隔离。

## 1. 准备

- Linux 服务器，安装 Docker Engine 和支持 `up --wait` 的 Compose 插件；安装 Bash、util-linux（flock）、OpenSSL、tar、sha256sum。
- 初始容量建议 4 核、8 GB 内存、50 GB 可用磁盘，仅作为平台起点；Dify、向量库和本地模型需另外估算资源。
- 域名解析到服务器，开放 TCP 80/443。数据库、Redis、后端不公开端口。SSH 限制来源。
- 不使用 root 日常登录；Docker 访问权限等同服务器高权限，仅授予运维。
- 在服务器仓库根目录执行下面命令。不要运行开发用根目录 docker-compose.yml。

```bash
cp deploy/server/.env.example deploy/server/.env
chmod 600 deploy/server/.env
openssl rand -hex 32
```

分别生成并填写 DB_PASS、JWT_SECRET、APP_ENCRYPTION_KEY，不复用同一值。加密密钥用于已有凭据解密，运行后不可随意更换。填写真实 APP_DOMAIN（仅域名）、ACME_EMAIL、管理员邮箱和强密码。不得使用示例域名、开发密码。每次发布使用新的 RELEASE_TAG。

DIFY_BASE_URL 填服务器可达地址；Dify 服务密钥、模型和渠道按平台实际配置填写。容器内 localhost 指当前容器，不能填写开发电脑地址。需要 Ragas 时将 BACKEND_TARGET 改为 ragas 后构建，评测模型仍需在平台配置。

## 2. 构建和启动

```bash
bash ops/server.sh validate
bash ops/server.sh build
bash ops/server.sh deploy
bash ops/server.sh status
bash ops/server.sh preflight
```

部署先检查环境，再启动数据库和 Redis，停止旧后端执行迁移，通过生产预检后启动应用和网关。首次无须手动建表。迁移失败将中止部署，不自动回滚数据库。升级有维护窗口，并非零停机。

访问 `https://你的域名/login` 和 `/tenant-login`。HTTPS 证书由 Caddy 获取，要求 DNS 和入站端口正确。健康接口为 `/api/v1/public/health/ready`。首次上线还应验证管理员登录、租户权限、文件上传、检索、Wiki、工具、评测及钉钉接收/回复。

## 3. 外部业务服务

- **Dify**：独立部署并固定版本，使用对应版本官方部署配置；仓库旧 `deploy/dify` 示例不作为生产配置。备份 Dify 数据库、向量存储、文件及插件数据。平台数据备份不包含 Dify。
- **模型**：配置服务器可访问的服务地址。Ollama 应处于私有网络，禁止直接公开无认证接口。向量模型切换需要重建索引并检查维度兼容。
- **法务工具**：更新 API 地址和正式认证。当前 `X-User-Id` 模拟认证仅允许回环地址，不能直接搬到远程服务；需接入服务端认可的正式鉴权，不能解除限制来上线。
- **钉钉**：配置真实渠道凭据。Stream 模式需要服务器持续出网；HTTP 模式需在钉钉后台配置本平台对应 HTTPS 回调 URL 并完成签名验证。上线逐群验证一次。不要让本地和服务器同时消费同一机器人。
- **租户配置**：Dify 应用、知识库 ID、机器人流程、工具授权和模型服务地址要逐一核对；迁移平台数据库不等于迁移 Dify 数据。

只运行一个后端实例。扩容前需要验证 Stream 消费、定时任务及分布式锁，否则可能重复回复或重复执行业务。

## 4. 备份与恢复

```bash
bash ops/server.sh backup
```

备份期间暂停后端写入，完成后恢复原先运行的后端。备份位置为 `deploy/server/backups/UTC时间/`，包含 PostgreSQL 自定义格式备份、上传文件及 SHA256 校验。部署和备份互斥。备份结束仍应检查后端健康。外部直接写数据库不受此暂停控制，应停用外部写入。

`.env`、APP_ENCRYPTION_KEY、Dify 全部存储需另行加密备份；备份目录必须复制到异机并设置保留策略，服务器本地一份不足以防灾。Redis 为队列及运行状态存储，有持久化卷，但本脚本不提供队列时间点恢复；维护前排空任务，恢复后核对未完成任务，勿盲目重放提交型接口。

恢复必须先在隔离项目/新数据卷演练，禁止覆盖正在运行的数据库：

1. 校验 `sha256sum -c SHA256SUMS`，检查 `tar -tzf uploads.tar.gz`。
2. 使用相同发布镜像和安全保存的环境文件启动一个隔离 PostgreSQL；执行 `pg_restore --exit-on-error --no-owner --no-acl -U 用户 -d 空数据库`，通过标准输入传入 database.dump。
3. 将 uploads.tar.gz 解包到隔离 uploads 卷，目录归属为容器 node 用户（UID 1000）。
4. 使用备份对应的加密密钥，运行迁移预检、启动应用，检查租户、文档及加密凭据能正常读取。
5. 演练环境禁止连接真实钉钉渠道、支付、邮件和写入型工具。通过验收后维护停机切换，保留原卷。

回滚应用可恢复上一个 RELEASE_TAG 的镜像；若迁移不兼容旧版本，应恢复已验证备份并核算备份后业务，不要自动执行 migration:revert。升级前必须备份。

## 5. 日常运维

```bash
bash ops/server.sh logs backend
bash ops/server.sh logs gateway
bash ops/server.sh status
```

所有常驻容器配置异常退出自动重启和日志轮转；健康检查失败只会标记 unhealthy，不会自动重启卡住的进程。需另接外部监控告警，覆盖 HTTPS 可用性、后端就绪、磁盘、数据库、队列积压及钉钉断线。不要使用 `docker compose down -v` 清理生产环境。

正式发布应在 CI 构建目标服务器架构镜像并推送私有仓库，记录镜像 digest 和迁移版本。当前脚本支持服务器原生构建；不要把 ARM 镜像直接复制到 x86 服务器。Compose 中基础镜像采用版本标签，验收后可进一步锁定 digest。

参考：[Compose 启动顺序](https://docs.docker.com/compose/how-tos/startup-order/)、[Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)。

## 本次验证记录（2026-10-08）

已在独立 Linux 容器中完成：Compose 配置解析、前后端镜像构建、空数据库 25 项迁移、生产预检、后端就绪接口 HTTP 200、前端租户登录路由，以及 pg_dump/pg_restore 恢复到另一空库（25 项迁移记录完整）。未使用业务数据库。

尚未验收：真实服务器域名证书、服务器防火墙、Linux 主机上的完整部署/备份脚本演练、Ragas 可选镜像、外部业务集成。镜像构建发现生产依赖 10 项安全告警（含 1 critical、4 high），需审查修复后再进行正式上线验收。本方案不代表已部署到服务器。
