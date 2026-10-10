# PaperPulse 运行与配置

仓库不包含本机数据和凭据。先验证单人本地流程，再考虑公开部署。

## 初始化

安装Node.js 24.11+、npm和Docker Desktop，启动Docker后执行：

```powershell
npm ci
npm run local:setup
npm run build -w @aihot/web
npm run local:start
```

默认Web/API/PostgreSQL端口为5320/4321/5545，浏览器访问http://127.0.0.1:5320。修改端口时同步修改.env中的SITE_URL和API_BASE_URL。数据库容器为paper-pulse-db，卷为paper-pulse-pgdata；停止服务不删除数据。不要提交.env、.local、.data或数据库导出文件。

## 模型与解析

在生成的后端.env填写自己的配置：

```dotenv
LLM_BASE_URL=https://your-provider.example/v1
LLM_API_KEY=your-model-api-key
LLM_MODEL=your-model-name
MODEL_CALLS_ENABLED=true
MINERU_API_TOKEN=your-mineru-token
MINERU_CALLS_ENABLED=true
```

这些都是占位符。模型须支持结构化输出，推理额外参数按实际供应商配置；支持图像输入时才加LLM_VISION=true。

后台`/admin/settings`按服务设置每分钟、每小时和滚动24小时请求上限，任一为零即停用。模型为llm，PDF解析为mineru，网页补取为jina；单位是请求次数，不是金额。初始MinerU额度为零，须明确配置后使用；论文也可先保存而不精读。

配置后确认全部后台业务队列空闲，再重启。先完成一篇真实论文的“导入 → 解析 → 精读 → 核查 → 回跳原文”，页面GET不调用模型。

## 自动论文发现

- PAPER_DISCOVERY_ENABLED=true：每天北京时间06:00开始，后台每五分钟恢复当天漏跑及到期等待。
- `/papers/settings`配置方向、细分主题、优先级和排除词。
- 默认每日最多三篇；含附录超过30页或超过20MB会跳过并补位，不删除原论文。
- PAPER_OPENALEX_ENABLED=true：高引候选更新。OPENALEX_API_KEY可选；带密钥查询需配置openalex预算，论文仅在显式选择后精读。

后台须持续运行；06:00是开始时间，不保证全部精读同时完成。

## AI新闻

1. 在`/admin/sources`登记和试抓信源，配置频率、分级与参与方式。只启用使用者选定的来源；industry/sources.json是示范目录，不保证每个源一直可用。
2. 开启COLLECT_ENABLED=true，确保模型容量覆盖新闻与论文共用请求。
3. 首次回灌由`config._aihot.initialBackfillLimit`限制，不是后续每日配额。现有类别、URL和关键词规则可排除噪声。
4. RSS正文或直接抓取不足时使用Jina；JINA_API_KEY可选，缺密钥或明确401/402时匿名读取。403、429、5xx和未知结果不切换身份；仍使用jina预算及回执。
5. 需要代理时配置自己的EGRESS_PROXY_URL，仓库不提供代理服务。

新闻默认仅显示摘要与原文链接。日报默认北京时间08:00，有合格新事件才生成，历史回灌不冒充今日新闻。暂停来源不撤下已有文章，撤下单条内容在后台操作。

## 测试与公开部署

`.env.test`指向可建库、名称以_test或_ci结尾的隔离数据库。完整测试还需相应系统工具和Playwright浏览器。

公开部署前关闭DEV_AUTH_ROLE等开发身份，配置NODE_ENV=production、独立管理员密码、会话与图像签名密钥和HTTPS，并核对私人数据访问边界。条款及隐私页由站点使用者确认后发布。Docker和升级见[部署说明](../deploy.md)，不能直接把本机开发模式暴露到公网。
