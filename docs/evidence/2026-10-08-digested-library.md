# 已精读论文入口验证（2026-10-08）

原“全部论文”把候选与已经生成解读的论文混在一起，不便回看。现将同一路径 `/papers/library` 的桌面、窄屏、页面标题与详情返回文案统一为“已精读论文”。今日阅读的回看入口和阅读记录的空状态链接也同步更新。

页面通过现有管理员列表 HTTP 接口发送 `digest=ready`，数据库先筛选 `paper_digests.status='ready'`，再按解读更新时间排序并截取最多 200 篇。关键词搜索保持同一筛选。没有解读、排队、生成中、失败和 unavailable 状态不进入此列表；个人标记为待读的论文只要已有可阅读解读仍显示。重新处理过程中保留的旧可阅读解读也继续显示，卡片保留任务处理状态，因此这里表示可回看的解读正文，不声称每项后续图表任务均已完成。

候选发现、阅读记录和通用管理列表仍保留原有筛选能力。无需迁移、删除或修改论文数据，页面读取不触发模型调用。

## 实际验收

- 本机已有服务更新并重启，页面显示 4 篇：Beyond Semantic Similarity、AffordCraft、Protocol-Sensitive Evaluation of Log Anomaly Detection、Attention Is All You Need。
- 同一管理员列表不带解读筛选返回最近 200 篇、包含候选；带 `digest=ready` 返回 4 篇，均为 ready。
- 中文搜索“超越语义”返回 1 篇；未解读候选的关键词“Residual Trajectory”在精读列表返回 0 篇。
- 1440×1000 桌面侧栏高亮已精读论文；站内点击该入口和直接刷新均显示正确列表。打开搜索结果后，返回入口为已精读论文，返回仍保留关键词及一条结果。
- 截图：`.data/navigation-validation/digested-library-desktop.jpg`。临时视口覆盖已重置。
- 回执总数 29、最新 ID 29、pending 0，与本轮修改前一致；本轮没有新增付费模型或 MinerU 请求。

## 检查

- 类型检查通过。
- 论文模块与架构测试 51/51 通过，包括排除各未完成状态、保留待读论文、与关键词/个人状态共同过滤、列表读取不创建任务。
- Web 生产构建通过。
- Web 测试 37 通过、13 失败。HTML 和 Single-fetch 的精读筛选回归通过；13 个交互用例受缺少 Chromium 1228 影响，未运行至断言。
- 本机服务冒烟检查通过。
- 全量后端回归 719 项：696 通过、18 失败、5 取消。失败包括本机 Windows SIGTERM 场景超时、缺少 `pg_dump`/`sh`、OpenSSL 找不到配置文件及 PID 命名测试库冲突。精读列表相关测试通过；全量不是全绿，未将环境阻塞当作功能通过。

本轮日志位于忽略 Git 的 `.local/library-typecheck.log`、`library-build.log`、`library-paper-tests.log`、`library-web-tests.log`、`library-full-tests.log`、`library-smoke.log`。原始测试日志可能包含测试库信息，不直接公开。
