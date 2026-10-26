# 多租户 AI 机器人平台

本目录包含当前平台前后端、数据库迁移、测试和部署模板。原创部分遵循 [个人非商用许可](LICENSE)，商用（包括企业内部生产经营）须事先联系 **250979539@qq.com** 获得书面授权。

## 本地开发

需要 Node.js 22.12+、PostgreSQL 16、Redis 7。Dify 是单独部署和授权的外部服务，不随本仓库提供。

1. 在独立开发环境运行 `docker compose up -d postgres redis`。根目录 Compose 的示例数据库密码仅用于本机开发；不要公开端口或用于生产。现有主机有同名容器／端口时先调整配置，不要覆盖旧服务。
2. 复制 `backend/.env.example` 为 `backend/.env`，配置自己的数据库、随机 `JWT_SECRET`、32 字节 Base64 `APP_ENCRYPTION_KEY`、平台管理员邮箱和强密码。可用 `openssl rand -base64 32` 生成密钥；不提交真实 `.env`。源码中的开发回退密码和演示账号不是可用的生产凭据，必须自行设置强密码，不得共用公开示例值。
3. 在 `backend` 运行 `npm ci`、`npm run migration:run`，再运行 `npm run start:dev`。只对本次开发库迁移；不要启用生产数据库的自动同步。默认端口 3001。
4. 在另一个终端的 `frontend` 运行 `npm ci`、`npm run dev`，前端端口 5175，代理后端 3001。

平台登录：`http://localhost:5175/login`；租户登录：`http://localhost:5175/tenant-login`；健康检查：`http://localhost:3001/api/v1/public/health/ready`。租户账号由平台创建；临时密码需要按页面提示修改。不要在生产运行演示数据种子。

## 开发验证与部署

后端：`npm test -- --runInBand`、`npm run build`。前端：`npm test`、`npm run build`。采集助手联调入口见仓库根目录 README。

- [Linux Docker 部署](docs/LINUX_DOCKER_DEPLOYMENT.md)
- [生产检查清单](docs/PRODUCTION_CHECKLIST.md)
- [信息收集与微信同步](docs/INFORMATION_COLLECTION.md)
- [机器人工作流与统计](docs/ROBOT_WORKFLOWS_AND_USAGE.md)

执行数据库／已部署服务集成测试前，阅读脚本顶部要求并使用独立临时库。这些测试可能写入合成数据，不属于只读健康检查。
