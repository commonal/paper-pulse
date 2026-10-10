# CCF A 高引与经典论文阅读验收

日期：2026-10-08，北京时间。站点：`http://127.0.0.1:5321/papers/impact`。

## 实现范围

- 原外链参考页接入站内论文、正文解析、覆盖检查、Skill精读、独立原文核查、关键图表解释；读列表和详情不触发付费。
- 复用已有关注方向，增加关键词、发表时间、来源、待精读/已有解读筛选及24篇分页，详情返回保留条件；经典精读同时进入已精读库。
- 检索不再限制近十年，使用1900年至当日、引用排序前100条/启用方向，再按计划及CCF白名单筛选。引用排序不代表经典认证或全量覆盖，不凭感觉新增引用阈值。
- 新增五个在线迁移只补摘要、PDF地址和站内关联；没有删除已有数据，也没有增加每日三篇自动配额或模型/MinerU预算。经典论文仅显式选择后处理。

## 真实问题与修复

本机开始时高引库为空。网页显式“更新高引论文”先真实暴露旧参数 `sort=-cited_by_count` 的 HTTP400；改为 `cited_by_count:desc` 后，四个启用方向的检索完成，记录33次计划匹配、32个唯一work。更严格的期刊名核查排除JAIR和AAAI eBooks等名称误匹配后，列表展示30篇。缓存读取重新核查规则；旧元数据保留，不修改历史论文。

此批最早到1976年，包括2014年的Dropout、2009年的迁移学习综述及2002年的检索累积增益评测等。结果仍有OpenAlex来源/日期和版本的识别限制；venue匹配不能证明Full/Regular论文身份。本文只验证选定样本，不替所有候选背书。

OpenAlex开放PDF字段及精确范围查询按[官方查询说明](https://help.openalex.org/api/searching/)核查；真实匿名调用HTTP200。带密钥的查询新增回执/预算约束，测试证明预算0不发送、成功保存后同输入重放不重发；本机未配置密钥。

## Dropout完整精读

选择[JMLR官方论文](https://jmlr.org/papers/volume15/srivastava14a/srivastava14a.pdf)：Dropout: A Simple Way to Prevent Neural Networks from Overfitting（2014）。OpenAlex work `W2095705004`，当次引用数33902，是OpenAlex匹配计数，不是其他数据库的总引用数。

网页组合“Dropout + 发表5年以上 + JMLR”返回一篇，点击“开始精读”创建站内论文 `a70bb7c2-ed9c-407e-8ef1-2916a6d12b44`。JMLR旧镜像同路径转换至官方PDF，由worker自动保存；PDF SHA256：`9c196ccbe6c6a595a1adba6cd030d35f7c2e548bbf5e7f1278b0109d8dd9ebaa`。

|项目|真实结果|
|---|---|
|任务编号|`be3e031c-47e3-4e86-9d3f-0b06a726f98e`|
|完成时间|2026-10-08 15:39:44 北京时间|
|整体状态|ready / complete，无错误|
|正文|MinerU，305个块，Markdown84639字符|
|覆盖|262个非参考文献块、94686字符，正文与附录保留，未截断|
|中文解读|五节，45个原文引用编号|
|图表|三张：训练/测试权重缩放机制图、MNIST表2、数据规模与收益图|
|请求|MinerU1次（回执46）、模型4次（47–50），全部completed、各1次attempt|

正文与参考文献处理范围见 `.local/impact-classic-progress.json`，各阶段原始材料及核查结果在 `.data/eval/paper-reading/<论文ID>/<任务编号>/`。供应商未返回实际货币成本，不能从请求次数推导账单金额。

人工抽查原文第2页：p表示保留概率，第3页测试时权重乘p。正文正确，模型简介误写“以概率p随机丢弃”；已改为1−p，理由、逐字原文、原值和正确值记在回执48的 `paperPresentationCorrection`，原供应商回答保留。抽查MNIST正文的1.60%、1.35%、1.25%、1.06%、0.95%和DBM预训练0.79%均存在；不同架构/预训练及数据集条件在文章说明，不将其当作同一控制实验的单一提升率。此抽查不等于所有语义自动正确。

15:48:32精确重放已存精读与审校，校订保留，五个回执的总attempt5→5，无新增请求。证据 `.local/dropout-replay.json`、`.local/dropout-summary-correction.json`、`.local/dropout-spot-check.json`。

## 页面与边界验收

- 真实界面筛选到Dropout，进入精读，完成后按“已有解读”仍得到一篇，中文标题/简介、引用量、JMLR来源及阅读链接显示正确。
- 从详情返回保留关键词、时间、来源及已有解读筛选；已精读库也能找到同一篇，没有创建第二个论文副本。
- 手机390×844检查，内容宽375、scrollWidth375，无横向溢出；结束恢复默认视口。
- 没有开放PDF时可上传20 MB以内PDF至同一篇后入队；已有PDF的未完成论文可直接继续精读。已完成或处理中的任务不因重复点击被替换。
- 非arXiv开放全文沿用guardedFetch，逐跳防私网、限时限量，只接受PDF；官方来源页只选同origin PDF，不跟外站推荐链接。测试全部使用MockAgent，禁止真实外网。

本机截图（图片不提交）：`.data/navigation-validation/classic-reading-ready.png`、`classic-reading-mobile.png`、`classic-dropout-article.png`。

## 回归结果

|检查|结果|
|---|---|
|typecheck|exit0，`.local/impact-typecheck.log`|
|Web build|exit0，`.local/impact-build.log`|
|论文模块、架构、迁移|最终86/86通过，`.local/impact-module-tests.log`|
|最终高引全文/API/回执专项|4/4通过，`.local/impact-reading-tests.log`|
|Web SSR、缓存及组合筛选|16/16通过，`.local/impact-cache-tests.log`|
|站点smoke|31项通过、exit0，`.local/impact-smoke.log`|

全量后端762项，741通过、16失败、5取消，未宣称全量通过。此轮较早启动时含一个新增测试的错误大小写断言（`MinerU`与`MINERU_API_TOKEN`），已修正，最终专项及模块全过；其余失败为Windows SIGTERM收尾超时、缺少pg_dump/sh、OpenSSL配置不存在，以及两个文件开始前测试数据库PID重名。两个重名文件（queue-recovery、source-dates）隔离复跑9/9通过，`.local/impact-isolated-tests.log`。全量日志 `.local/impact-full-tests.log` 已脱敏。

全部Web55项，42通过、13浏览器用例因缺少Chromium1228在启动前失败，`.local/impact-web-tests.log`；真实应用浏览器另行完成上述验收，不能等同于全部浏览器回归通过。未为本功能安装系统工具或改变公共测试框架。
