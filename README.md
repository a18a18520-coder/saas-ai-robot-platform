# 企业 AI 机器人平台与微信采集助手

多租户 AI 机器人平台（NestJS / React），以及本地优先的 macOS / Windows 微信窗口采集助手。

**源码公开，非商用免费；任何商用须事先取得个人著作权人的书面授权。** 包括企业内部生产经营、收费 SaaS/API、客户交付和二次开发后的商业使用。授权邮箱：**250979539@qq.com**。详见 [LICENSE](LICENSE) 和 [商业授权说明](COMMERCIAL_LICENSE.md)。

这不是允许自由商用的 OSI 开源许可；公开、下载、Fork、Star 或提交 Issue 不等于取得商用授权。第三方依赖仍适用其原有许可证，本仓库的商用限制不改变第三方组件本身的权利。

## 项目结构

- `platform/backend/`：租户／平台鉴权、角色权限、机器人、渠道、知识库、结构化信息收集与采集设备同步。
- `platform/frontend/`：中文平台管理端和租户端。
- `platform/deploy/server/`：Linux Docker 部署模板。
- `wechat-collector/`：微信窗口选择、会话绑定、滚动／轮巡、OCR、人工核对和租户同步。

入门：[平台开发与部署](platform/README.md) · [采集助手使用说明](wechat-collector/README.md) · [信息收集与字段约束](platform/docs/INFORMATION_COLLECTION.md)。

## 功能边界

采集助手不是腾讯官方插件，不注入微信进程、不读取微信数据库、不发送聊天消息。仅处理使用者明确选定且有权处理的窗口／会话；截图和 OCR 默认保存在本地。开启指定会话同步后，可靠识别的昵称、正文和本人标记可进入对应租户；不确定内容待核对。OCR 不是可信身份认证，也不能保证全量历史、完整识别或跨屏精准去重。

平台信息收集机器人可配置提示词、约束、结构化字段和触发范围，服务端执行字段类型和原文依据校验。渠道必须实际投递消息；配置“所有消息”不会让钉钉标准 @ 机器人获得未投递的群消息。

## 验证

建议 Node.js 22.12+，使用各目录的锁文件安装依赖：

```sh
cd platform/backend
npm ci
npm test -- --runInBand
npm run build
cd ../frontend
npm ci
npm test
npm run build
cd ../../wechat-collector
npm ci
npm run check
npm test
npm run test:platform -- ../platform
npm run test:tenant-sync -- ../platform
```

最后两项使用合成数据，不连接业务库和真实模型。其他数据库／已部署服务测试必须在隔离环境按各脚本说明显式运行，不要对生产环境执行种子或验收脚本。

源码自检：`node scripts/publication-check.cjs`。发布前须处理所有扫描阻断。自检是补充，不是完整安全审计。

## 发布与安全状态

这是从当前开发内容整理的源码快照，不包含旧 Git 历史、私人验收记录、业务配置、数据库、聊天截图／导出、依赖目录或安装包。测试通过不代表已在用户环境部署。微信助手 0.6.0 的真实同步场景、Windows／Intel 真机与干净安装仍需验收；安装包尚未完成正式签名／公证，不在此次源码仓库中分发。

生产使用前必须评审依赖漏洞、真实渠道权限、备份恢复、密钥轮换和数据合规；参阅 [安全策略](SECURITY.md) 与 [生产检查清单](platform/docs/PRODUCTION_CHECKLIST.md)。不得关闭系统安全机制以运行采集助手。

版权署名：**a18a18520-coder**。商业授权联系邮箱：**250979539@qq.com**；商业协议签署前须核验授权人的真实身份与权属。
