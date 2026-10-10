# AIHOT 作为 PaperPulse 底座的结构评估

检查日期：2026-10-06。

检查对象：[KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT)，提交 `ede7c7bf6fbf2fe3d1282732423f16d1fc7dbf08`。

范围：本评估的结构结论基于进程入口、页面数据获取、模块接口、任务注册、部分采集与内容流程、数据库迁移和部署配置。随后完成原版依赖安装、类型检查、构建、服务启动和 30 项整站冒烟检查，记录见 [原版运行验收](../evidence/aihot-original-baseline-2026-10-06.md)；用户配置模型后，再完成单来源三条内容的 [真实处理验收](../evidence/aihot-real-content-2026-10-06.md)。未全面审查代码质量，也未验收全天候采集、推荐质量或完整论文处理。

## 判断

**优先建议使用 AIHOT 作为新项目底座，保留它的技术栈和基础设施，将论文能力实现为独立模块。**

相比另建一套网站框架，这条路线可以复用页面外壳、信息流与专题组件、来源管理、后台管理、持久任务队列、模型调用回执和部署配置。能减少多少实际工时尚未测量；论文数据接入、PDF 与笔记关联、导读证据组织仍需实现。

## 1. 已核对的结构

| 位置 | 源码职责 | 对 PaperPulse 的意义 |
| --- | --- | --- |
| `apps/web/` | React Router SSR；页面 loader 通过 HTTP 获取 API 数据 | 复用网站外壳、路由、响应式布局与公开页面渲染 |
| `apps/api/` | Fastify API，注册核心路由和模块 HTTP 路由 | 新论文 API 不需要再起一套主后端 |
| `apps/worker/` | 注册核心任务、模块队列与定时任务 | 论文解析、导读可以使用已有任务基础设施 |
| `packages/backend/` | 来源、入库、新闻整理、事件、公开读取、模型与回执等 | 基础能力可以复用，但新闻业务不能全部套给论文 |
| `packages/contracts/` | 跨进程类型与模块地址声明 | 为论文新增明确的数据契约 |
| `site/`、`industry/` | 品牌文案、模型配置、分类、来源、提示词等 | 品牌与研究方向无需散落到引擎代码中 |
| `modules/` | 扩展位置，当前模块清单为空 | 可以添加论文模块，但仓库未带已实现的论文模块或完整模块样例 |

源码核对点：

- [模块页面与 API 地址声明](https://github.com/KKKKhazix/AIHOT/blob/ede7c7bf6fbf2fe3d1282732423f16d1fc7dbf08/packages/contracts/src/modules.ts)：页面、后台页面、API 路径均有声明接口。
- [后端模块接口](https://github.com/KKKKhazix/AIHOT/blob/ede7c7bf6fbf2fe3d1282732423f16d1fc7dbf08/packages/backend/src/modules.ts)：HTTP、任务队列、定时任务与事件回调等接入点。
- [模块队列执行](https://github.com/KKKKhazix/AIHOT/blob/ede7c7bf6fbf2fe3d1282732423f16d1fc7dbf08/packages/backend/src/jobs/queue.ts)：`enqueueOn` 与 `workModuleQueues` 实际接入 pg-boss。
- [网页路由注册](https://github.com/KKKKhazix/AIHOT/blob/ede7c7bf6fbf2fe3d1282732423f16d1fc7dbf08/apps/web/app/routes.ts)：模块页面追加到路由表；首页仍由引擎的 home 路由负责，调整首页需要明确改动。
- [迁移执行器](https://github.com/KKKKhazix/AIHOT/blob/ede7c7bf6fbf2fe3d1282732423f16d1fc7dbf08/scripts/migrate.ts)：同时读取引擎和模块迁移，按完整文件名排序，并检查同名冲突。
- [首页 loader](https://github.com/KKKKhazix/AIHOT/blob/ede7c7bf6fbf2fe3d1282732423f16d1fc7dbf08/apps/web/app/routes/home.tsx)：读取 `/api/site/timeline`，页面不是独立于数据契约的静态模板。

## 2. 能省下什么，仍需做什么

| 范围 | 建议处理 |
| --- | --- |
| 网站外壳、信息流、专题、筛选 | 复用布局与组件；调整论文卡片字段、点击目标、首页数据读取 |
| 来源管理与 RSS/Atom 读取 | 复用通用请求、格式解析等；新增论文标识、作者列表、版本与资源映射 |
| 后台、模型配置、调用回执、预算 | 优先沿用；新增导读任务必须验证缓存键能区分论文版本与生成配置 |
| API、队列、数据库迁移、Docker | 保持原有技术栈，避免为换语言与数据库重写这些部分 |
| PDF 阅读、持久化笔记、代码关联 | 在论文模块中新增，按需提取 Research Pulse 中适用的组件 |
| 全文导读与引用回跳 | 新增按章节组织证据的处理流程，不能直接使用新闻摘要逻辑 |

## 3. 不能直接照搬的行为

### 新闻正文有截取上限

`editorial/writing.ts` 中 `MAX_BODY_CHARS = 60_000`，超出时从正文开头截取；评分输入也使用该限制。这适用于它当前的新闻流程，不能证明论文后半段实验被覆盖。论文导读需要独立的章节读取与覆盖状态。

依据：[writing.ts](https://github.com/KKKKhazix/AIHOT/blob/ede7c7bf6fbf2fe3d1282732423f16d1fc7dbf08/packages/backend/src/editorial/writing.ts)、[analyze.ts](https://github.com/KKKKhazix/AIHOT/blob/ede7c7bf6fbf2fe3d1282732423f16d1fc7dbf08/packages/backend/src/editorial/analyze.ts)。

### 文章、事件与论文是不同的对象

当前核心 schema 以文章、分析和公开投影组织内容，未提供论文 ID/DOI、PDF 页码证据、论文代码资源和个人论文笔记的专门结构。不能仅把文章标题改成论文标题就完成产品。建议新增论文与版本、资源、笔记、导读对象，新闻报道与论文之间显式关联。

依据：[核心 schema](https://github.com/KKKKhazix/AIHOT/blob/ede7c7bf6fbf2fe3d1282732423f16d1fc7dbf08/database/migrations/0001_core.sql)、[资料输入](https://github.com/KKKKhazix/AIHOT/blob/ede7c7bf6fbf2fe3d1282732423f16d1fc7dbf08/packages/backend/src/content/materials.ts)。

### 新闻时间和热度规则不等于论文精选规则

资料发现时超过 48 小时会按历史内容处理，首次导入也有回填规则。论文可以长期值得阅读，需区分发表时间、入库时间和人工精选时间。新闻按事件归组与多来源讨论计算热度，不应直接替代论文专题或科研价值判断。

依据：[时间归档规则](https://github.com/KKKKhazix/AIHOT/blob/ede7c7bf6fbf2fe3d1282732423f16d1fc7dbf08/packages/backend/src/content/materials.ts)、[事件热度](https://github.com/KKKKhazix/AIHOT/blob/ede7c7bf6fbf2fe3d1282732423f16d1fc7dbf08/packages/backend/src/events/hot.ts)。论文模块可有自己的时间线，不必修改新闻时间线的语义。

### 收藏并非服务端笔记管理

当前读者收藏、已读由浏览器本地状态实现。可以复用交互，但它不提供服务端持久化的论文笔记或跨设备同步。个人笔记应独立保存；公开只读页面与私人编辑接口需分别处理，先考虑复用单管理员权限。

依据：[local-state.ts](https://github.com/KKKKhazix/AIHOT/blob/ede7c7bf6fbf2fe3d1282732423f16d1fc7dbf08/apps/web/app/lib/local-state.ts)。

## 4. 建议改造方式

1. 从 AIHOT 的固定提交建立 `paper-pulse` 独立项目，保留许可证与来源说明，使用自己的品牌。
2. 先验证上游构建与基本运行，再新增 `modules/papers/`：自己的表、API、页面、类型、队列与测试。
3. 首页以论文为主，复用原有网站外壳与信息流组件；少量新闻进入辅助区域。原有新闻处理能力保留，先不做大规模引擎裁剪。
4. PDF、笔记和代码资源挂在论文详情下。优先实现可持久化的手动整理，再加论文来源与 AI 导读。
5. 解析器如需 Python，可由任务进程调用离线脚本，或使用已有解析服务接口；输入输出采用明确契约，不预先增加 FastAPI 主服务。

主体技术栈：TypeScript、React Router SSR、Fastify、PostgreSQL、pg-boss、Tailwind CSS。版本与部署依赖以该固定提交和后续运行检查为准。不把 SQLite / SQLAlchemy 与此方案同时引入。

## 5. 采用前的最小验证

- 依赖安装、类型检查、网页构建与本地运行能够通过。
- 在独立测试数据库中验证采集、入库、内容展示和队列任务，不连接旧项目数据库。
- 用一个最小论文模块验证页面/API/迁移/队列接入，确认需要修改哪些核心接口。
- 开发阶段关闭自动采集与模型调用；付费调用的验证按需要单独触发。

原版基础运行检查与真实内容小样本处理现已完成；论文扩展模块接入与规模化运行仍待验证。建议优先采用，不宣称论文扩展已经实现或可以零成本完成。
