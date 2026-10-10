# Jina密钥优先与匿名降级验收

用户提供自己取得的免费Jina密钥，授权保存到后端并真实试读；没有密钥或额度耗尽时使用匿名读取。密钥只写入忽略Git的.env，没有写入代码、测试、回执、截图或本文。

## 当前规则

- 优先使用JINA_API_KEY。缺少密钥直接匿名；明确HTTP401认证失效或HTTP402余额不足时，保存拒绝回执，再尝试匿名。相同输入曾明确拒绝的密钥不反复购买失败请求；更换密钥后新的指纹可再尝试。
- HTTP403、429、5xx及连接超时不切换身份。403不能直接当作余额不足；429可能是速率限制，需要等待。pending/unknown也不降级，删除或更换密钥不能绕过同一读取窗口的未决回执。
- 两种模式都通过现有guardedFetch、paidRequest及jina预算，保持5次/分钟、50次/小时、300次/滚动24小时。匿名不是绕过本站熔断的通道。拒绝的一次和之后匿名的一次分别计数。
- 输入身份包括原网址、读取时间窗、输出格式、服务地址和认证模式；认证模式还绑定密钥哈希。请求摘要仅保存模式，不保存密钥。供应商错误回显密钥时先脱敏再保存。
- 同一页当天成功回答复用；列表仍逐次读取。匿名结果不标记估计费用；带密钥的原有费用估计逻辑保持，其数值不是供应商实际账单或免费密钥实际扣款证明。
- [Jina官方限制表](https://jina.ai/en-US/api-dashboard/rate-limit/)明确Reader支持无密钥读取，当前公布20RPM；本机jina限制低于该值。免费key的实际余额、余额错误及恢复仍取决于供应商，不通过耗尽用户真实余额来测试。

## 真实读取与恢复

针对OpenAI官方Sophos新闻，密钥模式读取成功，回执194为received、attempts=1、authMode=key；临时只在测试进程中清空密钥，匿名读取也成功，回执195为received、attempts=1、authMode=anonymous。二者各返回11943字符Markdown，正文含目标新闻内容，未把挑战页面当正文。正式后端仍保留用户密钥。

该新闻此前多次正文提取失败后已变成body_status=unconfirmed。普通恢复只会分析旧材料，因此本次明确将content.extract-body入队。worker复用回执194，保存7089字符的可读正文；body_status=ok，processing_state=analyzed，processing_error=NULL，已在站内详情展示中文导读和原文链接。既有筛选规则判定不入精选（selected=false），没有为验收强行提高评分或改变筛选。

两份读取回执attempts仍各为1，表明恢复正文时没有再次购买读取。用户论文、PDF哈希、当前版本和两条私人笔记对照新闻启动基线均保留。

## 验证

新增回归先在旧代码复现缺密钥停止、401/402不能降级、错误回显敏感字段，以及删密钥不能保护未知回执。修复后模拟服务检验密钥优先、匿名读取、余额拒绝后只降级一次、成功缓存、403/429/500不降级、未知结果与预算保护。

首轮相关35项通过；最终Jina/采集/提取/回执/架构及全部论文模块195/195通过。测试全部使用隔离*_test数据库和本地假服务；最终测试setup强制替换Jina密钥、默认Reader指向本地未开放端口，并清空真实代理，避免开发者配置让测试访问外部。初次全量测试发现此前代理配置影响了高引PDF的MockAgent，此项在隔离后已回归通过。

类型检查、Web构建、真实网站/API/RSS/MCP冒烟通过。Web58项45通过、13因缺少Playwright浏览器失败；内置浏览器另核查恢复后的真实新闻页面。初次全量后端863项838通过、20失败、5取消，包含上述代理隔离问题及Windows SIGTERM、缺少pg_dump/sh、OpenSSL配置与PID复用导致测试库重名等问题；隔离修正后相关195项全部通过，不声明全量通过。具体日志.local/jina-fallback-all-tests.log。

最终确认10个已启用信源均healthy，首轮10条新闻全部analyzed；此次恢复不修改论文材料或笔记，也没有将OpenAI这条低于精选门槛的新闻强行纳入精选。

原始验收在.data/eval/jina-fallback-2026-10-10/：key.json、anonymous.json、state.json、openai-news.png。日志.local/jina-fallback-final-tests.log、jina-fallback-typecheck.log、jina-fallback-build.log、jina-fallback-web-tests.log。真实402额度耗尽切换由本地模拟验证，未耗尽用户免费密钥余额。
