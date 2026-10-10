# 官方RSS新闻流程启动验收

用户确认六类AI内容全部保留、暂不配置排除规则，首批选择现有10个官方/研究机构RSS，并授权按此配置真实运行。没有启用其余八个媒体/个人RSS、X或公众号。

## 本机配置

- 首批来源：OpenAI、Google DeepMind、Google Research、Hugging Face、Microsoft Research、NVIDIA、AWS Machine Learning、GitHub AI & ML、Mistral、BAIR。配置来自industry/sources.json前十项，经现有previewSource试抓后保存；全部T1、editorial，全文展示与全文RSS保持关闭。
- COLLECT_ENABLED=true，MODEL_CALLS_ENABLED沿用已启用状态。新闻各步骤沿用default模型，不新增模型密钥、不改评分门槛或六类分类。
- 每源首次回灌最多一条，按真实发布时间排序。之后继续采用底座48小时边界、去重和增量抓取，首次一条不是永久每日只收一条。初始间隔九个120分钟、BAIR180分钟；既有每日自适应调频仍生效。
- 本机llm共用请求熔断从4/24/100调整为12次/分钟、120次/小时、500次/滚动24小时，并保留操作审计；这是论文与新闻共用请求次数，不是金额。MinerU额度没有改。
- 直连Google Research、Hugging Face、Mistral发生UND_ERR_CONNECT_TIMEOUT。核实本机系统已启用127.0.0.1:7890代理，经现有guardedFetch及代理DNS/公共地址检查后10源试抓均成功。因此本项目EGRESS_PROXY_URL复用该本地HTTP代理，不修改系统代理、安全检查或TLS校验。实际运行依赖此代理继续在线。
- worker已注册sources.schedule每分钟检查到期信源、content.sweep每五分钟恢复、reports.compose每半小时检查刊期。默认日报北京时间08:00；没有合格事件不会强行生成日报，首轮历史导入不冒充今天的新事件或热点。

## 真实记录

启动前sources和articles均为空。首轮10源试抓与正式fetch均成功，每源一条，共10条。最终九条分析完成，六条精选；OpenAI一条原文补取受限仍待处理。最终数量以.data/eval/news-start-2026-10-10/state.json为准。浏览器真实核实新闻精选出现GitHub密钥检测模型、EmbeddingGemma 2、Mistral Large 4、Agent Lightning、Google专利研究及K-Search等中文标题、摘要、分类、评分和推荐理由；展示不是样例数据。

网络配置更新中，旧worker在14:20:26–28启动了Google Research、Hugging Face、Mistral免费RSS读取，新worker14:20:34启动。原作业留下active/running。核对时间与sourceId后，通过pg-boss fail释放仅这三项并重新入队，fetch_runs保留明确的重启中断失败记录，后续真实fetch全部ok。不把中断记录删掉或伪造成成功，没有释放或重发付费未知回执。后续部署应先暂停/排空采集或完整确认免费与付费业务队列，再重启。

OpenAI RSS可读，但本轮Sophos原文页面直接读取403，Readability无法取得正文，且JINA_API_KEY尚未配置，原任务保留`extract: JINA_API_KEY is not configured`及重试时间。其他完整RSS材料可正常分析。Jina是补取受限/动态页正文的额外配置，不是现有模型密钥；没有声称该篇正文已读取或整个10篇分析无失败。需要完整补取该类正文时，由用户配置Jina凭据及非零jina请求额度后恢复，不能伪造原文或绕过付费回执。

## 验证与范围

本次主要是本机运行配置与已有新闻能力启用，没有新增生产接口、表迁移或改筛选算法。真实RSS试抓、正式采集、模型回执、中文发布及网页检查完成，网站/API/RSS/MCP冒烟检查全部通过。既有论文ID、非空PDF哈希、当前版本和两条私人笔记对照基线均保留。没有因本次配置重跑全量测试，不冒用此前测试结果当作新闻全量质量评测。

运行材料保留在.data/eval/news-start-2026-10-10/：previews.json、state.json、preservation-before.json、interrupted-free-fetches.json及页面截图。密钥和.env不进入文档或Git。
