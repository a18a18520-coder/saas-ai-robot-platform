# 第三方组件与来源

本仓库的非商用限制仅适用于作者有权许可的原创部分，不重新许可或限制第三方组件本身。第三方商标仍归原权利人。

- SaaS 平台使用 NestJS、React、Vite、TypeORM、PostgreSQL 客户端、BullMQ、渠道 SDK 等依赖，版本由各 `package-lock.json` 锁定。
- 微信助手使用 Electron、Tesseract.js、OCR 数据包与原生构建工具，详见 [采集助手第三方说明](wechat-collector/THIRD_PARTY_NOTICES.md)。未包含 ChatScreenExporter 源码／素材。
- Dify、PostgreSQL、Redis、Caddy、Nginx 和容器基础镜像是外部服务／软件，其版本对应许可证需单独遵守。本仓库不包含 Dify 源码或其运行数据库；平台商用授权不等于获得这些外部软件的额外权利。
- `DEPENDENCY_LICENSES.json` 仅为锁文件许可证元数据清单，可能存在遗漏或错误，不能替代实际包内的 LICENSE/NOTICE。`REVIEW_REQUIRED` 项必须人工确认；即使声明为 MIT 等，也须在二进制／容器分发时保留所要求的通知。

源码发布不包含 `node_modules`、下载的工具链、OCR 二进制资源或安装包。构建安装包时应保留 Electron/Chromium、OCR 及原生运行库的完整声明，按照组件许可证履行分发要求。

锁文件缺失的五项许可已于整理时对照对应版本的已安装包核实：busboy 1.6.0、passport-strategy 1.0.0、streamsearch 1.1.0 的 LICENSE，exit 0.1.2 的 LICENSE-MIT，以及 pause 0.0.1 的 Readme.md License 章节均为 MIT。清单为这五项补充了来源说明；版本变化后须重新核对。
