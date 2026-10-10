# 论文解读修复验收（2026-10-07）

真实网站：http://127.0.0.1:5321/ 。API、worker 和最终构建的 Web 均已重新启动，论文发现与 OpenAlex 更新恢复开启，模型与 MinerU 保持用户已授权的真实调用。

## 已确认的原因与修复

- DeepSeek Flash 默认思考消耗输出额度。原回执 #3/#4 的正文为空、结束原因为 `length`，输出分别为 3,600/7,600 token 且全部用于思考。现在显式关闭思考，推理额外额度为 0，正文输出上限 6,000 token。
- 原 45 秒等待上限造成 #5 超时。论文解读改为 120 秒；未知结果继续由回执系统保护，不重复支付。
- 原提示词未明确 JSON 字段结构。现在提供五个固定章节和完整结构，校验章节、主张、证据 ID，每节允许 1–8 条主张。实验节可以分别覆盖数据集、基线、指标、结果及限制。
- 请求次数预算耗尽此前显示失败。现在解析/解读进入等待状态，每五分钟在额度与回执允许时恢复；无效输出终止本次任务，不自动反复付费。LLM 预算为每分钟 4、每小时 12、滚动每天 12 次；MinerU 为 1/6/8 次。
- 解读与完成回执在同一事务提交；完整但被旧结构限制拒绝的回答，只有正文版本、论文、提示词版本及证据全部匹配才可重新验证并复用。
- 278 篇未入选候选的虚假排队状态已改为尚未处理，未删除论文、PDF、笔记或回执。新候选同样不自动解析，每日选中最多三篇才入队。
- 页面展示真实等待/失败原因。新闻页筛选、导航、canonical 指向 `/news/featured`。手机长列表启用整页过渡时，WebKit 返回反复失败并出现进程崩溃；去掉新闻卡片整页过渡后，同一位置恢复断言及完整浏览器回归通过。

## 真实论文结果

| 论文 | 解读回执 | 状态 |
| --- | --- | --- |
| Attention Is All You Need | #8 | 五节解读 ready，回执 completed；实际正文输出 1,640 token |
| Beyond Semantic Similarity: Performance and Costs of Agentic Retrieval for Complex Tasks | #10 | ready / completed |
| Protocol-Sensitive Evaluation of Log Anomaly Detection: Component Costs and Target-Access Sensitivity on HDFS and BGL | #11 | ready / completed；复用已保存回答，实验节五条 |
| AffordCraft: Scalable Construction of Task-Ready Simulation Assets from Single Images | #12 | ready / completed；复用已保存回答，实验节七条 |

后两篇没有新增模型请求。用真实 Chromium 打开今日三篇，逐篇检查五节解读，点击证据，核对 PDF 页码并等待 canvas 渲染完成，三篇均通过。此验收确认结构、证据引用存在性和页面回跳；不将自动结构校验等同于全文人工学术审稿。

## 检查与限制

- 完整 `npm run typecheck`：通过。
- 论文模块测试：15/15，通过；模型和 MinerU 使用本地假服务、隔离测试数据库。
- 生产 Web 构建：通过。
- 全部 Web 测试：49/49，通过。Chromium 使用本机已安装的 Playwright chromium-1234；默认 chromium-1228 下载被网络证书错误阻断。WebKit 使用官方备用下载服务安装的项目内 webkit-2311。测试断言未跳过。
- 最终真实网站冒烟：31/31，通过，包括论文首页、新闻页、公开 API、RSS、MCP。
- 整仓后端/模块测试：694 项，674 通过、15 失败、5 超时取消，未宣称整仓全绿。12 个备份测试缺少 `pg_dump`；出站协议测试的 OpenSSL 缺少配置；两个测试文件启动时发生隔离数据库名称冲突；5 个关闭测试依赖 Windows 无法按 POSIX 方式投递的 SIGTERM。

本地原始记录位于忽略目录 `.local/`：`papers-final.log`、`typecheck-final.log`、`build-repair.log`、`web-browser-final.log`、`backend-repair.log`、`smoke-final.log`、`verify-reading.ts` 和 `paper-reading-repaired.png`。整仓日志可能包含测试连接信息，不发布原始日志。
