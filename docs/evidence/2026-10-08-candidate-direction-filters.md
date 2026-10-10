# 候选论文分类筛选验证

日期：2026-10-08。范围：候选列表分类、搜索、精读状态、去重、分页及详情返回。本次未改 worker 或付费流程。

## 实现与边界

- 复用设置页已确定的八个研究方向，并提供全部与其他方向。按标题/摘要的广泛预设规则生成多个浏览标签，支持常见英文复数；不是模型语义分类。
- 来源资格仍按已启用计划的保存规则核查，浏览标签不启用计划、不改检索条件。跨计划同篇去重，保留全部来源与命中理由。
- 关键词可搜索中英标题、作者、摘要、已有中文简介和方向；与待精读/已有解读状态组合。分类数量先受关键词与状态过滤，再计算各方向，重叠数量不可求和。
- 移除先截200条的限制，按实际候选窗口过滤、去重后每页24篇。URL 保存方向、关键词、状态和页码，详情返回继续使用原条件。
- 无迁移、数据删除、新增模型调用、队列任务或预算修改。尚未生成中文展示的候选继续显示原文标题/摘要。

## 真实本机验收

站点 `http://127.0.0.1:5321/papers/candidates`。2026-10-08 15:01 北京时间，最近7天共437篇唯一候选：

|方向|数量|
|---|---:|
|RAG 与信息检索|118|
|多模态大模型|159|
|大模型推荐|15|
|Agent 与工具使用|52|
|训练与对齐|48|
|推理与评测|132|
|高效训练与推理|21|
|代码与软件工程|7|
|其他方向|114|

读真实 API 的全部、第二页、RAG，以及“大模型推荐 + GrIS + 已有解读”，组合结果为已完成的 GrIS。第一、第二页各24篇，48个 ID 无重复。检验前后 live 请求尝试47→47，关注计划未改变。快照 `.local/candidate-live-verification.json`，脚本 `.dev/verify-candidate-filters.ts`（均为本机材料）。

真实浏览器点击方向、输入 GrIS、选择已有解读、提交，显示1篇结果；进入 GrIS 后点击“候选论文”返回，URL和筛选保留。清除筛选后显示437篇，下一页范围25–48，返回首页1–24；两页卡片链接没有重叠。桌面1440×1000与手机390×844检查完成，手机实际内容宽375、scrollWidth375，无横向溢出；临时视口结束后恢复。

本机截图（不提交图片）：

- `.data/navigation-validation/candidate-directions-desktop.png`
- `.data/navigation-validation/candidate-filter-combined.png`
- `.data/navigation-validation/candidate-directions-mobile.png`

## 自动验证

|检查|结果|本机日志|
|---|---|---|
|npm run typecheck|通过；最后一次沙箱内因 spawn EPERM 阻止，正常权限复跑 exit 0|`.local/candidate-final-typecheck.log`|
|Web build|exit 0|`.local/candidate-build.log`|
|论文模块、架构及迁移回归|81/81通过|`.local/candidate-module-tests.log`|
|最终候选分类/API专项|4/4通过|`.local/candidate-tests.log`|
|Web SSR及缓存回归|15/15通过|`.local/candidate-web-tests.log`|
|真实站点 smoke|31项通过，exit 0|`.local/candidate-smoke.log`|

新增测试覆盖跨来源去重、多方向、未启用的浏览分类、短词边界及英文复数，超过200篇后的过滤与分页，搜索/状态/数量组合，实际 PostgreSQL 与 Fastify 管理员接口鉴权和参数校验，以及 SSR/single-fetch 私有缓存、URL持久化。测试只用本地假服务，断言读取候选不增加付费回执、不修改关注计划。

全量后端运行755项，731通过、22失败、2取消，未宣称全量通过。失败涉及 Windows SIGTERM 收尾测试超时、缺少 pg_dump/sh、OpenSSL 配置路径，以及6个测试文件在开始断言前遇到历史 PID 派生数据库重名。后者使用新的唯一 `_test` 数据库隔离复跑，6文件共17项全部通过（`.local/candidate-isolated-tests.log`）；未修改公共测试框架。全量日志 `.local/candidate-full-tests.log` 已脱敏数据库凭据。

全部 Web 测试54项，41通过、13失败；失败浏览器用例未启动，原因是本机缺少测试要求的 Chromium1228。日志 `.local/candidate-all-web-tests.log`。候选页面真实浏览器流程与响应式布局已另行验证，不将其等同于全部浏览器回归通过。
