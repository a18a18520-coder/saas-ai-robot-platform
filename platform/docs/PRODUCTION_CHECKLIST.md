# 生产上线与恢复检查清单

## 发布前

1. 使用 `backend/.env.example` 创建生产环境变量，设置 `NODE_ENV=production` 和 `DB_SYNC=false`。
2. 使用独立随机值配置 `JWT_SECRET` 与 `APP_ENCRYPTION_KEY`，两者不得写入 Git。
3. `CORS_ORIGINS` 只列出正式控制台 origin，多个值用英文逗号分隔，不得使用 `*`。
4. 如 API 位于反向代理后，将 `TRUST_PROXY_HOPS` 设为可信代理的实际跳数；直连服务保持 `0`，禁止无条件信任客户端伪造的 `X-Forwarded-For`。
5. 在单实例发布步骤中执行 `npm run migration:run`；应用实例不得并发自动改表。
6. 配置生产专用的 `PLATFORM_SUPER_ADMIN_EMAIL` 和强密码 `PLATFORM_SUPER_ADMIN_PASSWORD`；需要 MFA 时同时配置 `PLATFORM_TOTP_SECRET`。
7. 如需初始套餐或演示数据，必须在迁移完成后再执行 seed；seed 不会自动建表。生产环境不得执行 `seed:demo`。
8. 执行 `npm run preflight`，确认环境、HTTPS、数据库连通性和迁移状态通过。
9. 执行后端 `npm test -- --runInBand` 及前端 `npm test`、`npm run test:e2e`。
10. 从平台端和租户端分别验证“退出登录”，退出后刷新受保护页应返回登录页；浏览器持久存储中不应出现 Access Token。
11. 验证新建租户的一次性临时密码不会写入日志、通知或审计；平台操作员保存凭据后应关闭弹窗，并通过安全渠道交付给租户管理员。
12. 部署后监控 `/api/v1/public/health/live` 和 `/api/v1/public/health/ready`；只有 ready 成功才接收流量。
13. 启用 Web 聊天时配置前端 `VITE_API_BASE` 与 `VITE_WIDGET_BASE` 的 HTTPS 公网地址，并将组件自身的 origin 加入后端 `CORS_ORIGINS`；反向代理不得对 `chat-widget.html` 设置禁止跨站嵌入的响应头。
14. 启用钉钉时确认企业内部应用已发布、机器人能力选择 Stream 模式、主动消息权限已开通，并允许后端访问钉钉 OAuth、Stream 与机器人消息 API。

## 密钥轮换

1. 保留旧密钥为 `APP_ENCRYPTION_KEY_PREVIOUS`，将新密钥设为 `APP_ENCRYPTION_KEY`。
2. 先备份数据库，然后执行 `npm run secret:rotate`。命令在一个事务中重新加密工具、渠道、Dify 和平台设置凭据。
3. 重启并验证渠道/Dify 连接，再移除 `APP_ENCRYPTION_KEY_PREVIOUS`。
4. 如轮换失败，恢复备份且保留旧密钥；不得先删除旧密钥。

## 备份与恢复演练

1. 定时设置数据库环境变量和 `BACKUP_DIR`，执行 `ops/backup-postgres.sh`。脚本生成 PostgreSQL custom dump、SHA-256 校验文件，并验证 dump 目录可读。
2. 备份需异地加密保存，严禁放入仓库或应用主机唯一磁盘。
3. 至少每季度选择一份备份，设置 `BACKUP_FILE`后执行 `ops/verify-restore.sh`。脚本只在自动生成的 `restore_verify_*` 隔离库中恢复，验证后自动删除。
4. 记录演练日期、备份编号、恢复时长、表数和操作人；恢复失败视为发布阻断项。

## 日志与故障处理

- 全局日志会遮罩 password、secret、token、API key、Authorization 和密文；仍禁止业务代码主动记录请求体或完整第三方响应。
- 健康检查不返回连接串或异常原文。就绪检查失败时先查数据库与迁移，不得绕过检查强行接流量。
