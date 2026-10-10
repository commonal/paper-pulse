# 部署

## 用 Docker（推荐）

需要一台装了 Docker（带 Compose）的机器。云服务器建议至少 2 核、4 GB 内存，构建镜像时要用到。

```bash
git clone https://github.com/KKKKhazix/AIHOT.git myhot
cd myhot
node scripts/init-env.ts --llm-key <你的模型 API Key>
```

`init-env.ts` 会生成 `.env`，填好随机密钥和管理员密码，并把密码打印一次。机器上没有 Node 的话，把 `.env.example` 复制成 `.env`，自己填 `ADMIN_PASSWORD`（至少 12 位）、`SESSION_SECRET`、`IMG_PROXY_SIGN_SECRET`、`POSTGRES_PASSWORD`（各用 `openssl rand -hex 32` 生成）和 `LLM_API_KEY`。

启动前检查 `.env` 的 `SITE_URL`：本机试用保留 `http://localhost:3000`；部署到服务器时改成读者实际访问的地址。例如通过服务器 IP 访问时（把示例 IP 换成自己的）：

```dotenv
SITE_URL=http://192.0.2.10:3000
```

RSS、分享链接、站点地图和 Agent Markdown 中的绝对链接都使用这个值，不会随浏览器访问的地址自动改变。使用域名和 HTTPS 时按下方「配域名和 HTTPS」设置。

配置完成后启动：

```bash
docker compose up -d --build
```

启动后打开 `http://服务器地址:3000`，后台在 `/admin`，用管理员密码登录。第一次启动会导入示范信源，一两分钟后开始出现内容；第一次导入的一百多条资料大约半小时处理完（每条都要预筛、评分、结构化、写标题摘要，再归组）。

`docker compose` 会起五个容器：`db`（PostgreSQL 17）、`setup`（每次启动先跑数据库迁移和种子数据，然后退出）、`api`、`worker`（抓取、模型处理、定时任务）、`web`（网页）。`web` 只接收网站地址、API 地址等网页配置，通过 HTTP 读取 API；数据库、模型和管理员密钥，以及数据卷，只交给后端容器。

### 在中国大陆的服务器上

- 构建时 npm 走国内镜像：`docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com`，然后 `docker compose up -d`。
- 拉取 Docker 镜像慢，先给 Docker 配置镜像加速。
- 海外信源抓不到时，在 `.env` 里设置 `EGRESS_PROXY_URL`：抓信源和图片时走这个代理，调用模型接口不走。
- 对外提供网站服务需要先完成 ICP 备案，备案号填在 `site/site.ts` 的 `icp`。

### 配域名和 HTTPS

先把域名解析到服务器，然后在 `.env` 里设置：

```bash
SITE_URL=https://example.com
SITE_DOMAIN=example.com
PORT=127.0.0.1:3000        # 3000 端口只给本机的 Caddy 用，不直接对外
TRUST_PROXY=true           # 访客地址从 Caddy 转来的请求头里读
```

再用带 HTTPS 的方式启动，Caddy 会自动申请和续期证书：

```bash
docker compose --profile https up -d --build
```

已经有 Nginx 的话，不用 Caddy，把站点反向代理到 `http://127.0.0.1:3000`，带上 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`，并在 `.env` 里设 `TRUST_PROXY=true`。`SITE_URL` 一定要写成读者实际访问的地址：生成的链接、RSS、分享图和 MCP 都用它。

MCP 默认接受 `SITE_URL` 的主机以及 `localhost`、`127.0.0.1`、`[::1]`。额外主机用 `MCP_ALLOWED_HOSTS` 配置，以逗号分隔，例如 `extra.example:8443,[2001:db8::1]`。主机名不区分大小写，IPv6 必须加方括号；可带 0–65535 的十进制端口，匹配时忽略端口。包含路径、用户信息或非法端口的配置不会生效。`127.1` 等别名需要明确列入；此配置只影响 Host 校验，不扩大浏览器 Origin 许可。

前面有 Nginx、CDN 这类缓存时，要遵循应用返回的缓存期限（`Cache-Control`）：公开网页、导航数据、API、RSS、条目 Markdown、报告分享图、站点地图，以及接入说明 `/api/v1/agent` 和 `/openapi-v1.json`（五分钟到期后也要重新验证），都不要另加更长的缓存期，不要在到期后离线返回旧内容，也不要在转发旧响应时重新起算它的寿命；不要让代理和 CDN 叠加缓存动态内容。框架不代管自建站的 CDN，也不替它清缓存。

### 更新

2026-10-10 原文阅读改为连续滚动并支持引用段落黄色定位。仅前端组件与样式变更，无迁移、模型或解析配置改动；构建Web并重启Web加载。旧PDF和解读直接可用，坐标缺失或页码不可靠时明确定位范围。验收见[连续阅读与高亮](evidence/2026-10-10-pdf-scroll-highlight.md)。

2026-10-09 自动图表上限调整为六张，不设最少数量；文本与视觉发布版本均升级为v4。无迁移或新环境变量，重启API/worker加载规则。已有文章不自动付费更新，显式优化图表时重新选取；六张解释与核查所需输出上限同步增加，预算配置保持。真实BERT结果与检查见[六张图表验收](evidence/2026-10-09-six-figures.md)。

2026-10-09 BERT图表结构修复无需迁移或更改模型配置。构建后等待进行中的请求收尾，再重启API/worker加载新校验；失败在图表阶段的论文可点击“继续处理”。完整、相同输入的看图回答可恢复并继续独立核查，旧正文保持可读。真实结果见[修复记录](evidence/2026-10-09-bert-visual-recovery.md)。

先按下方 [备份](#备份) 一节备份。构建完成后停止旧服务，再运行迁移和新版服务：

```bash
git pull
docker compose build
docker compose stop api worker web
docker compose run --rm setup && docker compose up -d
```

迁移成功后再启动服务；迁移失败时先查看错误，不要继续启动。使用 HTTPS 配置的站点继续保留 `--profile https`。旧的 API 和 worker 要在迁移前停下：迁移可能删表删列，旧代码还在跑会出错；正常关闭 worker 会等进行中的付费调用收尾（最长三分多钟）。非 Docker 部署也按“备份、构建、停止 API/worker/web、迁移（`scripts/migrate.ts`）、种子数据（`scripts/seed.ts`）、启动”的顺序更新。

新迁移遇到长期占锁会报出文件名和等待超时，先处理占锁事务，再重跑 setup，不要跳过迁移或改写迁移账本。并发索引创建中断可能留下无效索引：核实报错中的对象后，用 `DROP INDEX CONCURRENTLY <索引名>` 清理该失败索引再重跑；有效但定义不同的同名索引须先核对差异。这些保护不改变上述 Docker 更新顺序，跨旧版本升级仍可能执行历史上的破坏性迁移。

下面按时间从新到旧列出每次更新要注意的事。

#### 社区修复、时间规则与读取优化（2026 年 10 月 4 日）

公开接口版本仍是 4.0.0。没有必填的新环境变量；新增一个选填的 `LLM_REASONING_TOKENS`，见下面 `site/models.ts` 一条。

**开关只认 `true`**：`.env` 里所有 `*_ENABLED` 开关（`COLLECT_ENABLED`、`MODEL_CALLS_ENABLED`、`FEISHU_*_ENABLED`、`INDEXNOW_SUBMIT_ENABLED` 等）只有写成小写的 `true` 才打开。以前写 `1` 或 `TRUE` 也算打开，现在都当作关闭；升级前检查 `.env`，改成 `true`。

**迁移**：新增六个迁移，按上面的步骤等 setup 跑完即可。它们都不删数据，不重写文章或已有向量，也不调用模型；迁移按完整文件名记账，编号相同的不同文件各自执行。

- `0055_publication_selected_published_idx.sql`、`0056_analyses_composite_id_idx.sql`、`0056_publications_pool_category_timeline_idx.sql`、`0057_publications_pool_channel_timeline_idx.sql`：并发建立查询索引，不阻塞正常读写。
- `0056_publication_release_selection_stats.sql`、`0057_analyze_publication_release_selection.sql`：为公开列表创建并收集查询统计。

这次连同这些索引一起减少了公开读取与事件召回的数据库开销，接口内容、搜索权重和事件候选范围不变。

**自己改过这些文件的站，合并时对照新文件**：

- `site/site.ts` 多了几项：
  - `EDITION_TIMES`、`EDITION_WHEN`：日报、周报、月报的出刊时间，原来写死在代码里；排程、日报的时间窗口、缺期告警和提到时间的文案都读它。`public/` 里的文件用占位 `{{dailyTime}}`、`{{weeklyTime}}`、`{{monthlyTime}}`。
  - `ITEM_COPY`：推荐理由叫什么，网页和分享图上显示不显示评分。
  - `REPORTS.descriptions`、`entry`、`metricUnits`、`shareUnit`：报告页面的描述和版面上的说法。
  - `ABOUT`、`CARDS` 里提到出刊时间和推荐理由的文案改成引用上面几项。
  - `DEPLOYMENT.directImageHosts` 改名为 `directFetchHosts`，采集和图片共用这份直连名单。
  - `SITE.feedbackLead`、`SITE.feedbackEmailHint`：反馈页标题下的一句话和邮箱框提示，原来写死在代码里。
  - `ABOUT.lead` 里 `{sources}` 两边不再写空格，页面会自动加。
- `site/models.ts`：推理模型的额度改成明确配置。默认模型设 `LLM_REASONING_TOKENS`，具名模型写 `reasoningTokens`。原来只有名字以 `-think` 结尾的具名模型会多给 4000，这个做法去掉了；自己加过这类模型的，补上 `reasoningTokens: 4000` 才保持原来的额度。推理模型把额度用光时，报错会写明 `finish_reason=length` 和该改哪一项。
- `industry/prompts/story-digest.md`：事件概览换了写法，第一句讲清核心变化和目前的结论，再补必要背景，分成短段，不按日期复述下方的时间线，不评论报道本身，也不再写死行业。已有综述不会被批量重写，随新报道逐步换成新写法；想让某几个事件立即重写，见 [综述评测](story-digest-evaluation.md) 的最后一节（`rewriteStoryDigest`，每个事件一次模型调用）。
- 自己维护的 Compose 文件可以删去 `LOCAL_ROUTER_URL`：分享图预热现在直接复用后端渲染器，不再请求固定的本机端口，没有代码再读这一项，自带的 `docker-compose.yml` 已经去掉。分享图地址、格式和缓存约定不变。

**采集与发布时间**：

- **首次导入之后不再收信源的存档**：以前新信源首次导入后，第二次抓取会把订阅里剩下的旧条目全部当历史内容收进来，逐条付费分析（示范源一次就有上千条）。现在之后的抓取只收发布时间在信源第一次导入前 48 小时以内或之后的条目；没有日期的照收，X 账号不受影响，见 [信源](sources.md#规则旧文不刷屏) 的“旧文不刷屏”。升级前已经收进来的旧条目按原文时间归档，不进“今天”和日报，分析也早已跑完，不用处理。
- **没有可信发布时间的新资料先不公开**：先不进公开列表、精选、报告、热点和推送，从原信源或原文页读到日期后再判断新旧。日期未知时，文章页、结构化数据和 Agent Markdown 标“收录时间”，RSS 不写 `pubDate`；OpenAPI 注明事件时间线和日报快讯的 `publishedAt` 这时是收录时间。
- **JSON 接口里不带时区的时间**（如 `2026-09-30 17:43:58`）按信源的 `publishedAtUtcOffset` 读，默认 `+08:00`。以前按服务器时区读，Docker 里是 UTC，所以已有这类信源的新条目时间会提前 8 小时，变成正确值。
- **文章页日期使用同一来源时区**：详情页补日期与正文提取先用 `detail.publishedAtUtcOffset`，未设则继承信源的 `publishedAtUtcOffset`，再默认 `+08:00`。只作用于之后的采集和补日期，不批量重写已有发布时间。
- **详情补全**：失败或超出本轮次数限制的日期、标题、摘要会在后续采集中补齐，已确认的正文保持原样；信源请求成功却漏掉日期、标题或正文时也会补全，并记进信源健康。Jina 详情规则要与实际返回格式匹配；固定采集起点、Intercom 日期章节及视频描述的配置见 [信源](sources.md)。
- **视频播放页不当正文**：对所有信源生效，YouTube、Vimeo 播放页不再作为文章正文抓取，YouTube 视频页也不再被当成图片。RSS 的视频描述只作摘要，订阅直接提供的真实文字保留。升级不会批量删除或重新分析已有正文；旧视频记录混入播放器导航的，先逐条核实，可在后台“内容诊断”的详情页设为仅摘要，停止展示错误正文。
- **RSS**：确认摘要就是全文的文字订阅可以设 `summaryIsBody`（Atom 的 `summary` 也算）。没有网页的播客单集，原文链接改为音频或视频文件，不再去抓网页。
- **预览和正式采集用同一组过滤**：后台“预览抓取”也套用地址前缀、分类、噪声词、地址改写和 `publishedAfter`，预览里看到的条目就是正式采集会存下的。
- **关掉采集后不再取信源图标**：`COLLECT_ENABLED` 不是 `true` 时，每天 04:40 取信源图标的任务也停下，不再访问信源网站。
- **已核实的历史日期可以纠正**：运维脚本先调用 `admin/content.ts` 的 `previewPublicationDateCorrection`，再按预览给出的版本和校验值调用 `correctPublicationDate`，并记录操作者与理由。只接受新旧日期都早于七天窗口的明确更正；保留材料修订、选稿与归组，不重跑模型。材料或日期已变化，或这次纠正会改变其他公开决定时，会拒绝操作并要求重新核对；没有批量回填，也没有新增公开接口。

**公开出口**：

- **按类别筛选按 `PUBLIC_CATEGORIES` 走**：API、RSS 和 MCP 的 `category` 取所有在公开接口里算作这一类的类别。不合并分类的站（默认就是），按 `tip` 查不再带出观点；没有 `tip` 类别的行业也能通过类型检查。
- **往期报告仍需重新验证**：日期、周和月份确定的是哪一期，不代表内容永久不变。报告保留出刊时写下的标题和摘要，来源名和引用时间跟随当前公开资料；已撤回的引用及依赖它的导读、封面不再分发。保留报告副本的客户端在 `Cache-Control` 到期后带 `If-None-Match` 重新请求。
- **自行配置过 Nginx 或 CDN 缓存的站点要检查规则**：按 [配域名和 HTTPS](#配域名和-https) 末尾的要求核对，并在更新时清理这些路径已有的代理和 CDN 缓存，包括接入说明 `/api/v1/agent` 和 `/openapi-v1.json`。
- **站点地图重建失败时不再无限沿用旧文件**：进程、磁盘副本和 HTTP 响应共用原来的五分钟期限，过期且无法重建时返回 `503` 和 `Retry-After`。MCP 继续使用 `no-store`；API 和 Agent 内容到期后重新验证。

**工具与修复**：

- **综述评测**：`scripts/eval-story-digests.ts` 从库里导出真实事件，在同一批事件上把现有提示词和候选提示词并排跑，见 [综述评测](story-digest-evaluation.md)。三个评测脚本共用 `scripts/eval-tools.ts`；`eval-selection.ts` 的 `--n`、`--concurrency` 和模型名写错时直接报错。
- **迁移不阻塞读写**：新迁移每个文件只放一条允许在线执行的语句，不整表回填或重写，建索引用 `CREATE INDEX CONCURRENTLY IF NOT EXISTS`；CI 用 `scripts/check-migrations.ts` 检查。统计维护只针对明确的表和列，规则见 [架构](architecture.md#数据库迁移)。
- MCP 请求有大小上限，错误日志去掉凭据。
- 桌面侧栏放大后显示细滚动条。
- 测试按每一步实际的提示词认请求、从 `industry/selection.ts` 读门槛，换行业改写提示词和门槛后不再误报；架构测试不再受路径分隔符影响。

#### 站点文件搬进 `site/`（2026 年 10 月 4 日）

公开接口没有变化，版本仍是 4.0.0。

- **站点自己的文件从 `industry/` 搬到了 `site/`**：`site.ts`、`models.ts`、`brand/`、`pages/`、`public/`、`changelog.json`。`industry/` 只留行业知识：`taxonomy.ts`、`topics.json`、`sources.json`、`prompts/`、`selection.ts`。自己改过这些文件的，合并时把改动挪到 `site/` 下的同名文件。
- **`site.ts` 多了几项**，都可以不填：`SITE.github`、`SITE.llmsIntro`、`SITE.rootIcons`，`POLICY.terms.license`、`POLICY.terms.headers`，`ABOUT.termsAnchor`（二维码卡片可以写 `alias`），以及 `ACCESS`、`ADMIN`、`DEPLOYMENT`、`FEED_COPY`、`PUBLIC_CATEGORIES`，说明见 [把它改成你的行业](customize.md)。`PUBLIC_CATEGORIES` 取代了 4.0.0 时的 `publicAs`：原来在类别上写 `publicAs: "tip"` 的，改在 `PUBLIC_CATEGORIES.merge` 里写（键是这个类别的 key，值是 `"tip"`）。
- **`DEPLOYMENT.requiredSecrets`** 是生产 API 启动时额外检查的凭据清单，默认空；基本会话、图片签名和管理员登录校验仍然生效。只有你的部署要求某个可选集成必须配置时才填写。
- **只属于你这个站的功能可以做成模块**：放进 `modules/<名字>/`，在 `site/modules/` 的清单里启用，见 [架构](architecture.md) 的“模块”。框架本身不带模块。
- **Agent 接入页默认打开 MCP**，页面列出 MCP、RSS 和 API 三种接入方式。Agent Markdown 接口仍在 `/api/v1/agent`，可从页面下方“Agent 使用说明”进入。
- **图片代理可以设流量上限**：`IMGPROXY_UPSTREAM_MB_PER_MINUTE`、`IMGPROXY_UPSTREAM_GB_PER_DAY`（或 `site.ts` 的 `DEPLOYMENT.imageUpstreamBudget`），默认不设。
- **修复**：同样的数据每次给出同样的字节（排序遇到并列时补上唯一的次序，API 和 RSS 的 ETag 不再无故变化）；网页转给 api 的请求不再带上逐跳头，`Connection: close` 不再让下一个 POST 失败；`llms.txt` 的接入方式按实际数，不再写成四种。

#### 升级到公开接口 4.0.0（2026 年 10 月 3 日）

- **模型榜、Codex 重置监控和主题页的大事记不再是框架的一部分**，只留在 AIHOT 上。页面（`/leaderboard`、`/codex-reset`）、接口（`/api/v1/codex-resets`、`/api/v1/codex-resets/recent`、`/api/v1/agent/codex-resets`）和 MCP 工具 `<前缀>_get_codex_resets` 都去掉了，MCP 和 `/openapi-v1.json` 的版本号升到 4.0.0。迁移 `0053` 删掉它们的表（`lb_*`、`monitor_*`、`fx_rates`）和设置，定时任务及其执行队列在 worker 启动时自动撤掉，后台运行记录继续保留；要留这些数据的，升级前先备份。公司主题页的标志改成公司名的首字母。
- **行业包有几处变化**，自己改过 `industry/` 的站，合并时对照新文件补上：
  - `site.ts` 多了 `topicsTitle`、`feedbackExample`、`keywords`、`since`、`interfaceVersion`、`POLICY`（使用规则和隐私说明两页的名字与简介、X 帖子算不算全文）、`ABOUT.description`、`ABOUT.sourcesFallback`、`AGENT`、`REPORTS`、`ALERTS`、`SOURCE_DEFAULTS`、`COMMUNITY_FEEDS`、`CARDS`；作者块的两张二维码卡片加了 `kind`，`ABOUT.copyright` 改成反馈页链接前后的两段。
  - 新增 `models.ts`：具名的模型和每一步默认用哪个，原来写在代码里。
  - 网页左上角的标志从 `apps/web/app/components/Logo.tsx` 搬到 `industry/brand/Logo.tsx`（后来搬到 `site/` 下，见上方）。
  - 新增 `public/`：`robots.txt`、`manifest.webmanifest` 原来在代码里生成，OpenAPI 说明原来在 `reference/`，现在都是这里的文件。原来填了 `contactEmail` 就会生成的 `/.well-known/security.txt`，现在要自己放一份 `public/.well-known/security.txt`（后来搬到 `site/` 下，见上方）。
  - 删掉了 `features.ts`、`chronicle.ts` 和 `chronicles/`；`topics.json` 里的 `orgNames`、`leaderboardProvider`、`chronicleTerms` 不再使用，可以删掉。
  - `taxonomy.ts` 的类别可以写 `feedLabel`（分类 RSS 标题里的名字，示例站用“AI 模型”这样的说法）；`ENTITIES` 加了几家公司。当时类别上还可以写 `publicAs`，让它在公开接口里并进另一类；这个字段后来删掉了，改成 `site/site.ts` 的 `PUBLIC_CATEGORIES.merge`（见上方），再写 `publicAs` 通不过类型检查。
- **推送接口的限流可以设置**：`/api/ingest/items` 每个客户端每分钟最多推几次由 `INGEST_RATE_LIMIT` 决定，`docker compose` 默认 10，和以前一样；不用 Docker 时默认不限，前面没有代理限流的话在 `.env` 里设上。
- **不再使用的环境变量**：`ARTIFICIAL_ANALYSIS_API_KEY`、`MONITOR_MODEL`，可以从 `.env` 删掉。

#### 升级到公开接口 3.0.0（2026 年 10 月 3 日）

- **安全阀默认关**：`COLLECT_ENABLED`、`MODEL_CALLS_ENABLED` 只有写成 `true` 才打开，没写就是关。用 `scripts/init-env.ts` 生成的 `.env` 已经有这两行；自己写的 `.env` 没有的话要补上，否则升级后不再采集、不再调用模型。
- **周报月报接口换了形状**：`/api/v1/weeklies`、`/api/v1/monthlies` 的列表和每一期都带 `periodStart`、`periodEnd`，正文改成 `sections[]`（每栏 `label`、`summary`、`items`），不再有 `title`、`themes`，列表的 `limit` 最多 60。读这两个接口的程序要跟着改；MCP 和 `/openapi-v1.json` 的版本号随之升到 3.0.0。
- **精选的机器出口每条新闻一条**：API 的 `mode=selected`、同步接口和精选 RSS 里，同一条新闻只留代表报道，其他报道以 `remove` 出现在同步的变更里（`mode=all` 里还在）。升级前已经入选的旧报道不会被重新整理，等这条新闻再有报道发布时才归并。
- **精选要等去重确认**：分数够了的资料，要等归组确认它不是精选里已有新闻的重复、带来了新信息，才进精选；确认之前只在“全部动态”。归组用的模型回答不合格式时会停在那里，后台“运行”页能看到。
- **一手只看分级**：`T1` 就是一手，`first_party` 不再单独设置；以前单独标成一手的 `T1_5`、`T2` 信源不再算一手，要算就改成 `T1`。
- **行业包多了几项**：`taxonomy.ts` 新增 `RELEASE`、`PLAIN_TERMS`，评论类的类别标 `commentary: true`，`ENTITIES` 可以写 `otherNames`，`CATEGORY_BY_ITEM_TYPE` 不再使用。已经换成别的行业的站，合并时对照 [把它改成你的行业](customize.md) 补上。
- **主题只读 `industry/topics.json`**：迁移会删掉数据库里的 `topics` 表。只改过数据库、没改文件的主题，升级前先写进文件。公司主题只看 `entityId`，`related` 不再使用。
- **日报不再调用模型**：日报按规则编排，周报月报从日报汇编，模型只写总述和栏目导读；已经出过的各期不重写。
- **提示词有改动**：`industry/prompts/` 里的 `structure.md`、`group-*.md`、`story-digest.md`、`report-period.md` 换成了新的写法，`report-daily-lead.md` 删掉了，新加了 `report-period-sections.md`。改过这些提示词的，对照着把自己的改动搬过去。
- **删掉的脚本**：`scripts/delete-sources.ts`、`scripts/regroup-events.ts`、`scripts/enqueue-analysis.ts`。不要的信源在后台暂停；单篇的重新评估、重新归组在后台“内容诊断”里打开这一篇操作。
- **管理员会话绑定登录方式**（迁移 `0041`）：从还没有会话绑定的版本升级后，未绑定的旧会话需要重新登录。此前已试用会话绑定迁移的数据库可直接升级，已有列和绑定会被保留，无需手动修改迁移记录。之后的规则见下方“管理员会话与配置变更”。
- **3.x 的 `/agent` 默认打开 Agent Markdown**，MCP 的接入说明在 `/agent?tab=mcp`；当前接入页见上方“站点文件搬进 `site/`”。
- **飞书内容群只推 `T1`、`T1_5` 信源的精选。**

### 备份

在 `.env` 里配置 `DB_BACKUP_STORE_*`（任何 S3 兼容的对象存储），每天 04:10 自动备份到那里。`DB_BACKUP_STORE_SECRET_ID`、`DB_BACKUP_STORE_SECRET_KEY`、`DB_BACKUP_STORE_BUCKET`、`DB_BACKUP_STORE_REGION` 四项都要填；不填 `DB_BACKUP_STORE_DOMAIN` 时按腾讯云 COS 拼地址（`<桶名>.cos.<地域>.myqcloud.com`），用其他 S3 兼容存储时，把这个存储桶的访问域名（含桶名，例如 AWS S3 的 `<桶名>.s3.<地域>.amazonaws.com`）填进 `DB_BACKUP_STORE_DOMAIN`。

一次完整备份包含同一时间戳的数据库 `.dump` 和文件包 `.tar.gz`，文件名取自数据库名：Docker 里数据库叫 `aihot`，所以是 `aihot-<时间>.dump` 和 `aihot-files-<时间>.tar.gz`。文件包保留 `uploads/` 以及仍存本地的 `feedback-screenshots/`，不包含图片缓存或本地备份目录。已经转发到飞书的图片只保留数据库中的外部引用，文件包不保存飞书上的图片。

恢复时同时取回这一对文件：使用与数据库版本兼容的 `pg_restore` 将 `.dump` 恢复到空数据库，再把文件包解压到数据目录根目录（Docker 中为 `/data`，非 Docker 使用 `AIHOT_DATA_DIR`，默认 `.data`），保留包内的子目录结构，并确保运行进程可读取这些文件。只恢复数据库不能找回仍由 `local:` 引用的反馈截图；旧备份中没有包含的文件也无法凭数据库引用恢复。

下面的手动导出只包含数据库，不包含上述附件目录：

```bash
docker compose exec -T db pg_dump -U aihot aihot | gzip > myhot-$(date +%F).sql.gz
```

数据都在三个 Docker 卷里：`db`（数据库）、`data`（上传的图片、图片缓存、本地备份）、`caddy`（证书）。`docker compose down` 不会删除它们；`docker compose down -v` 会。

### 看日志

```bash
docker compose logs -f --tail 100 api worker web
```

后台的“运行”页能看到每个定时任务最近的结果，“信源”页能看到每个信源的抓取状况。

### 管理员会话与配置变更

会话绑定登录方式、登录时的管理员凭据或飞书身份。修改管理员密码、飞书管理员名单或会话密钥后，应重启所有 API 进程，使它们加载相同的新配置；只编辑配置文件不代表正在运行的进程已生效，混用旧代码或旧配置的进程不能提供统一撤权。

有效配置改变后，密码会话不再接受旧密码的授权，飞书会话按登录时实际取得的 union ID 或邮箱检查当前名单（两者任一仍获授权即可）。停用飞书登录应用或更换应用 ID 会使飞书会话失效；只轮换同一应用的 secret 不会使仍获授权的飞书会话退出。轮换或移除 `SESSION_SECRET` 会使两种会话都失效。

鉴权时确认失效的会话会被删除，恢复旧配置也不会让它复活。系统不记录全局凭据变更历史：某次配置变化若从未被进程加载，或在恢复前从未被会话检查观察到，不能据此追溯撤销会话。

## 花多少钱

- **模型**：每条新资料先预筛一次；过了预筛的再评两次分、做一次结构化、写一次标题摘要，然后归组（有相近的报道时才调用），另外还有事件综述、周报月报的总述和精选的全文翻译。日报按规则编排，不调用模型。我们用示范信源在本地试跑，第一次导入的 152 条资料一共用了大约 930 次模型调用。之后每天用多少，取决于你的信源每天更新多少条。后台“模型与评测”页能看到每一步的调用次数和输入输出 token 数。
- **付费采集**（X、公众号、Jina）：按请求计费，默认不启用，填了 key 才会用。
- 所有付费服务都有每分钟、每小时、每天的调用上限（后台“设置 → 付费请求上限”），超过就暂停，不会一夜之间刷爆账单。填 0 表示立即停用这个服务。

## 不用 Docker

需要 Node.js 24.11 以上和 PostgreSQL 16 或 17，系统用 Linux 或 macOS；Windows 上请在 WSL2 里运行，或者用上面的 Docker 方式。

```bash
npm ci
node scripts/init-env.ts --llm-key <你的模型 API Key>
createdb myhot
```

在 `.env` 里加上：

```bash
DATABASE_URL=postgres://你的用户名@127.0.0.1:5432/myhot
API_BASE_URL=http://127.0.0.1:3001
```

然后：

```bash
node --env-file=.env scripts/migrate.ts
node --env-file=.env scripts/seed.ts
npm run build -w @aihot/web

NODE_ENV=production node --env-file=.env apps/api/src/main.ts          # 接口，3001 端口
NODE_ENV=production node --env-file=.env apps/worker/src/main.ts       # 后台任务
cd apps/web && NODE_ENV=production node --env-file=../../.env server.ts   # 网页，3000 端口
```

三个进程都要带 `NODE_ENV=production`。api 和 worker 不带它就按开发环境运行：启动时不检查生产密钥和管理员密码，`DEV_AUTH_ROLE` 免登录也会生效。

三个进程要一直运行，生产环境用 systemd 或 pm2 守护（守护配置里同样设 `NODE_ENV=production`）。停止 worker 时至少给它 210 秒（systemd 的 `TimeoutStopSec`、pm2 的 `kill_timeout`），让进行中的付费调用收尾；被提前杀掉的调用结果不明，要等至少半小时自动放行后才会重试。

开发时用带热更新的方式：`npm run dev:api`、`npm run dev:worker`、`npm run dev:web`。开发时想免登录进后台，在 `.env` 里设 `DEV_AUTH_ROLE=admin`（生产环境会拒绝启动）。

### PaperPulse 解读更新（2026-10-07）

更新后重启 API、worker 并重新构建 Web。DeepSeek Flash 的结构化论文解读应配置 `LLM_EXTRA_JSON={"thinking":{"type":"disabled"}}` 和 `LLM_REASONING_TOKENS=0`；其他供应商按其参数配置。请求次数预算按滚动 24 小时计算，额度不足时论文保持等待状态，worker 每五分钟尝试恢复，未知回执仍按原回执策略等待放行。

此次没有删除论文、PDF、笔记或付费回执。此前被错误标成排队的未入选候选，在本地修复中改为尚未处理；新候选默认同样不进入解析队列。完整但被结构校验拒绝的模型回答，重试时先检查相同正文版本与证据引用，通过后复用原回执；无效或截断回答不会被当作成功发布。

双语展示更新新增模块迁移 `0078_paper_presentations.sql`，只创建展示内容表，无数据删除。先迁移数据库，再重新构建 Web 并重启 API/worker。历史 `paper-digest-v3` 文章与展示数据仍可读取；当前生成和缺少展示的论文均走下方默认 Skill 阅读流程。已有完整文章不批量重读，也不在发布迁移中调用模型。

### 单篇 Skill 精读试验（2026-10-07，已由默认阅读流程替代）

初次试验没有新增数据库迁移或删除数据。固定 Skill 核心文件放在 `modules/papers/skills/paper-reading/`；当时通过 `scripts/eval-paper-reading.ts` 显式入队，现默认论文队列也执行同一流程。部署更新后，先等待进行中的付费请求收尾并重启 worker，再入队，避免旧进程使用旧校验规则。精读与核查通常两次模型请求，预算仍经过原回执控制；自动图表正常另需两次。

MinerU 归一化现在识别 `type=text` 且 `text_level>0` 的标题。新解析直接生效；旧材料不会全库自动重算。此次只从 AffordCraft 已保存的解析回执重新归一化，证据 ID 全部保持一致，没有再次请求 MinerU。其他旧材料需先核对解析回执及 ID，再显式更新，不能将一次试验当作批量迁移。

审校要求原文连续摘录，并检查每项主张的引用。人工更正必须绑定相同提示与输入的完整回执；校订记录及最终核查记录保存在回执 `request.paperReadingReview`，供应商原始 `response` 不改。论文版本、PDF 或正文更新时间改变时，事务拒绝发布旧输入结果。图像核查目前由操作人员完成并提交记录，尚未接通自动视觉模型。实测见 [试验记录](evidence/2026-10-07-paper-skill-pilot.md)。

### 文章布局与原图展示（2026-10-07）

更新后重建 Web 并重启 API/Web；worker 重启后使用回执模块的统一完成接口追加审计信息，论文模块不再直接写回执表。没有新增数据库迁移、模型调用、解析任务或数据删除。

引用缩为小序号，原图从已有本地 PDF 按 `content_list.json` 的坐标裁剪，由客户端共享一个 PDF 文档和 worker 并按图表接近视口时绘制。缺 PDF、缺可靠坐标或正文版本不一致时保留文字。初期的按章节和编号顺序选图已被下方自动选图流程替换，历史文章布局可保存后升级，不在浏览时另行调用模型。

### 自动选图与图下解释（2026-10-07）

先执行迁移 `0079_paper_illustrations.sql`（一条建表语句），再重建 Web 并重启 API、worker、Web。新增 `papers.illustrations` worker 队列，论文解读 ready 后自动入队；旧论文可通过页面文末按钮或 `POST /api/admin/papers/:id/illustrations` 显式补齐。接口只负责入队，要求管理员和 CSRF，不在读页面时调用模型。

每篇有可靠候选的论文，正常用两次现有模型请求完成选图/解释和独立原文核查，费用走原 `llm` 回执与预算。每日论文计划及预算数字没有自动增加，部署者需考虑新增的两次请求及滚动24小时口径。无可靠候选不请求模型。相同论文/PDF/正文/解读内容且已完成本版本时不重新入队；收到且有效的审校回答可以按相同请求哈希重新校验，不重复购买。

`paper_illustrations` 保存输入签名、布局、状态与审校回执。生成和核查失败时，同一输入的旧布局保留；输入变化后旧图表不显示。预算与未知结果保持 queued，已有恢复调度继续处理真实等待任务，内容错误留待显式检查后重试。新增表没有删除已有论文、PDF、笔记或回执。本机在切换旧规则前，将两篇已有文章布局回填入新表，保留页面；这不包含在发布迁移中，不批量调用模型。

当前模型阶段只接收图注、表格和相关正文，不是自动视觉模型。多面板裁剪可从已付费原始解析中合并同页相邻、没有独立图号的子图，不修改原证据块。图内颜色、曲线形态和未提供的标记不能凭文字猜测。真实试验与限制见 [自动图表记录](evidence/2026-10-07-auto-illustrations.md)。

两篇追加验证修复了成本表不能放在局限段落的问题，现允许方法、实验和局限段落的有效锚点。完整初选因宿主位置规则误拒时，可以按相同提示/输入哈希重新校验已保存回答，不重复购买。客户端的图像裁剪另外补齐与原裁剪框相交的水平原生文字，以及中心位于裁剪区内的完整 PDF 图像对象；整页背景和区域外对象不加入。表格不做这种扩展。本次无需新迁移或删除数据，重建 Web 并重启 API/Web/worker 即可；结果见 [追加验证](evidence/2026-10-07-two-paper-illustration-validation.md)。

### 默认日更阅读流程（2026-10-07）

先等付费请求收尾并停止 worker，执行新增迁移 `0080_paper_reading_tasks.sql`，构建 Web，再重启 API/worker/Web。迁移只创建阅读任务表，不删除论文、PDF、笔记、历史解读或回执。旧单次解读、独立展示补齐和仅手动试验入口已被默认 Skill 队列替代；历史已发布内容继续读取，不自动全量重新付费。旧进程必须更新，否则无法写入阶段信息。

新入选及手动处理的论文执行解析、覆盖检查、Skill 精读、原文核查、图表解释；需要图表时正常四次模型请求，无可靠图表时两次。正文与展示核查通过后一起发布，图表独立发布；后续图表失败时文章仍可读，但整体任务明确显示尚未完成。原文核查通过片段编号取回真实摘录，并记录引用补齐；供应商原回答不改。

任务保存 `run_id`、阶段、状态、恢复选项、覆盖信息和回执。额度不足、模型服务关闭或请求结果未知时等待；每五分钟检查回执和额度。无有效队列任务的陈旧 running 状态在十分钟后转为等待；内容校验失败不自动购买新回答。重试复用同输入的完整回答。读页面只读取已保存内容。

部署时检查旧 `papers.*` 待办：没有阶段记录的实际队列任务在首次执行时建立记录；旧手动任务包含视觉记录或人工校订选项时，先通过 `scripts/eval-paper-reading.ts` 显式重新入队保留选项。没有队列任务的旧 queued/generating 状态需要核对后从页面显式继续，不能凭旧状态批量猜测并付费。本机更新前旧待办状态为零。

每日三篇有图论文正常共十二次模型请求，滚动24小时预算十二次没有重试或相邻批次的余量，会正常等待。本次真实验证临时放行有限调用，结束恢复原预算；没有提高长期预算。实际费用供应商回执未返回金额，应到供应商账单核对。验证和限制见 [默认流程验证](evidence/2026-10-07-default-reading-workflow.md)。

### 统一网站入口（2026-10-08）

更新 API 和 Web 后重建 Web 并重启本机服务。无需数据库迁移，也不删除已有数据或改变模型预算。桌面侧栏和窄屏底栏的配置由论文模块提供；原新闻地址继续可用。新增 `/papers/library` 和 `/papers/history` 为私有工作区页面，前端只通过现有管理员 HTTP 接口读取；打开列表与详情不触发模型请求。阅读记录默认显示手动标记为阅读中或已读的论文，可以切换状态并搜索。停留超过 30 秒的记录依旧只用于本地统计，不自动改写论文状态。验收见 [统一导航验证](evidence/2026-10-08-unified-navigation.md)。

同日调整：原“全部论文”入口改为“已精读论文”，保留 `/papers/library` 地址，通过管理员列表接口的 `digest=ready` 在数据库过滤后排序和截取最多 200 篇。列表按解读更新时间排列，搜索始终保留该筛选；个人的待读/阅读中/已读状态不决定是否显示。解读正文已可读但后续图表更新仍在进行的论文继续可读，卡片保留处理状态。新增完成的解读会在下次打开或刷新时出现在列表，不重新购买历史内容。更新需同时部署 API 与 Web，无需新迁移。

### 今日更新状态（2026-10-08）

同时更新 API 和 Web，构建 Web 后重启服务，浏览器刷新以加载新脚本。无需新增迁移或删除数据，也不改变每日配额、定时任务的时间、模型/MinerU 开关和请求预算。

现有私人 `GET /api/admin/papers/today` 增加 `daily`：北京时间日期、已注册自动任务、启用方向数、配额、下次计划、最近运行/成功时间及当天处理计数。页面和手动刷新只读取已保存记录，不入队或调用模型。自动任务启用时，可见页面每30秒刷新；论文处理中沿用每4秒刷新。检索是否成功和解读是否完成分别展示；完整任务完成且文章可读才计入完整完成，图表仍在处理的文章可以先读。

预算等待只根据已保存的明确预算错误计数，其他等待显示通用恢复提示。成功检索但无入选、未到06:00、到时仍未更新、检索失败等空状态独立呈现。下次计划不保证准点完成，注册记录也不是在线心跳，后台必须持续运行。验收见 [今日更新状态验证](evidence/2026-10-08-daily-update-status.md)。

### 关注方向与检索设置（2026-10-08）

等待进行中的付费请求收尾后停止 worker，执行模块新增迁移 `0081_paper_plan_preferences.sql`、`0082_paper_queue_primary_plan.sql`、`0083_papers_arxiv_categories.sql`，构建 Web，再同时更新并重启 API、worker、Web。三个文件各含一条新增 nullable 列的在线语句，不删除数据、不批量回填、不调用外部服务。浏览器刷新以加载新脚本。

设置页包含八个个人方向与独立热点计划。已有三个个人计划和热点的启用状态、分类及关键词保留，旧 preferences 为 NULL 时按原自定义条件读取；新增五个方向默认关闭。用户点击“使用推荐规则”后，才改为预设主题及默认标题匹配。新安装默认启用原三个方向和热点，并采用预设规则。每日配额、定时任务时间、模型/MinerU 开关与预算不自动增加。

检索关键词改为标题或标题/摘要范围内的词组边界匹配，不再使用原 all-field 检索及任意子串命中；如 `RAG` 不再命中 `fragility`。关键词数组保留不等于检索结果完全相同。排除词始终核查标题和摘要。预设主题映射为固定分类和布尔关键词规则；自定义、补充词和范围仍由用户调整。新规则作用于后续 arXiv 与 OpenAlex 查询，当前本地候选在预览及每日入选时重新核查。今日已入选论文保留，不额外购买解读；OpenAlex 历史高引结果保留到现有缓存期限，后续周检索才更新，设置页预览只覆盖本地论文元数据。

每日选入记录新增主推荐方向，用于近七天个人方向轮换；旧记录该列为 NULL，不猜测历史归属。多方向命中的论文只占一个名额，并保留全部命中方向。原 arXiv 分类新增列从后续采集开始写入，旧候选使用已保存匹配分类。预览限定最近收录的最多500篇元数据，最多展示20篇，不采集、入队、解析或调用模型。验证与查询边界见 [关注与检索设置验证](evidence/2026-10-08-direction-preferences.md)。

### 日更容量与等待原因（2026-10-08）

无数据库迁移或数据删除。重新构建 Web，并更新 API、worker、Web。用户批准的本机模型保护上限为4/分钟、24/小时、60/滚动24小时，可显式执行 `node --env-file=.env scripts/configure-paper-budgets.ts --apply` 设置；其他部署不自动提高额度。此命令只修改 `llm` 预算，MinerU、服务开关、每日入选配额和定时检索时间不变。

等待信息从已持久化的阶段/错误及当前回执尝试数派生，页面读取不入队或付费。预算使用全部 live 请求尝试，按分钟、小时和滚动24小时分别计算；跨窗口阻塞取最晚可用时间，并向后估计五分钟恢复周期。零上限、模型未启用、结果未知不承诺按时间自动继续。列表不输出原始内部错误，详情保留阶段与状态更新时间；预计恢复时间不保证容量不被其他请求占用。

现有解析、精读和图表队列分别保留最多2、3、2次队列重试。内容/覆盖错误明确停止，未知结果不盲目重复发送，完整初稿及核查回执按原输入复用。正常停止的精读回答允许仅修正末尾容器结束符，供应商原始 response 不改，接受后的修复记录保存为 `request.paperReadingJsonRepair`。真正长度截断、字符串中断、内部语法错误或缺少章节、证据/原文核查失败仍不发布。图表审校后台理由上限由500字调整为2000字；读者图下注释的限制不变。不同图表可以锚定同一研究问题/方法/实验/局限段落，页面逐张显示并核查；同一图表重复选取仍拒绝。新图表提示版本 `paper-illustrations-v3` 提供明确的可选段落ID，允许研究动机图在研究问题中就近插入；旧已发布图表继续可读，不批量重新购买。只有新生成或显式重试使用新提示。

Windows 的本机启动脚本使用 Stop-Process，重启需避开恢复调度时间并确认没有执行中的模型请求。停止进程遗留的 pending 回执不是成功回答；按现有未知回执规则处理，不清空请求记录或伪造未计费。需要显式恢复时，必须保存审计原因和真实的计费确认状态；未知计费记为 null。验证见 [日更容量与真实精读记录](evidence/2026-10-08-reading-capacity-and-recovery.md)。

### 候选论文分类筛选（2026-10-08）

同时更新 API 和 Web，重新构建 Web 并重启这两个服务，浏览器刷新加载新脚本。无需数据库迁移、数据删除或 worker 重启；不修改关注计划、检索时间、每日入选配额、模型/MinerU 开关及预算。

已有私有 `GET /api/admin/papers/candidates` 接受 `direction`、`q`、`reading`、`page`，返回去重后的 `candidates` 及方向计数、筛选条件、总数、每页数量与实际候选天数。每张卡片的来源改为 `matches` 数组，包含全部检索计划和命中理由，API 与 Web 应一起部署。候选资格仍按启用计划及其已保存规则重新核查；浏览分类独立使用八个预设方向的广泛标题/摘要规则，不受方向是否启用或 arXiv 分类约束，并识别常见英文复数。未命中预设的论文归入其他方向。这是规则匹配标签，不是模型确认的主题结论。

移除原查询的前200条截取，在配置的最近1–14天范围内先合并同篇多来源，再组合关键词/精读状态过滤、统计分类和分页，每页24篇。分类数量响应关键词与精读状态；多方向可以重叠，数量不能直接相加。页面及翻页只经管理员 HTTP 读取，打开详情后返回保留条件，不采集、入队或调用模型。验证见 [候选分类筛选记录](evidence/2026-10-08-candidate-direction-filters.md)。

### CCF A 高引与经典论文阅读（2026-10-08）

确认没有执行中的付费请求后停止旧 worker，运行模块新增迁移 `0084_impact_abstract.sql` 至 `0088_impact_paper_validate.sql`，构建 Web，同时更新并启动 API、worker、Web。五个迁移分别增加摘要、开放 PDF 地址、站内论文 UUID、NOT VALID 外键及独立验证约束；没有历史数据回填或数据删除。删除站内论文时对应高引关联置空，元数据保留。本次不改变关注方向、每日三篇配额、模型/MinerU预算、每周一07:00更新计划或服务开关。

已有管理员高引列表接受方向、关键词、精读状态、年份区间（全部/发表5年以上/近5年）、来源及页码；返回24篇候选、总数、分类和来源数量及已关联的论文状态。未导入候选继续使用35天发现缓存，已导入论文保留在高引列表供后续查找。分类按检索命中计划，不自动开启未启用方向。首页、列表、翻页和状态刷新只读数据；客户端开始精读及手动更新均为需要管理员身份/CSRF的显式 POST。

新增 `papers.impact-refresh` 队列用于手动更新元数据，沿用 `PAPER_OPENALEX_ENABLED=true` 门槛。OpenAlex 查询采用实际验证的 `sort=cited_by_count:desc`，检索区间从1900年到当天；每个启用方向读取引用排序前100条，再核对关键词及 CCF venue，是方向检索子集，不能宣称完整经典论文目录。期刊名称必须精确匹配，避免 Artificial Intelligence 被 JAIR 等其他期刊名称的子串误命中；缓存读取也重新核查白名单，不删除旧论文。配置 `OPENALEX_API_KEY` 时使用 `openalex` 回执和预算，首次默认为0；通过管理员付费请求上限明确设置后方可检索。同日完全相同的查询复用回执，不清空或伪造调用记录。无密钥的匿名查询本机验证可用，不保证长期服务政策不变。

选定高引论文后，在同一事务中合并已有来源/arXiv身份、保存关联和阅读任务，再入现有正文队列；重复点击保持活动任务编号，已有解读直接读取。优先使用 OpenAlex 的开放 PDF及明确 arXiv地址；JMLR、PMLR、ACL Anthology和NeurIPS官方来源页可提取同来源 PDF，JMLR旧镜像地址转官方同路径。全部非arXiv全文获取在worker中使用现有SSRF防护（`guardedFetch`）、逐跳地址检查和20 MB PDF上限；拒绝把HTML登录页当PDF。没有全文时返回上传提示，不留下伪处理中记录；获取失败保留错误，可上传同篇原文后重试。未配置/启用MinerU的非arXiv论文明确显示正文不可用，不根据摘要生成完整精读。上传仅补齐缺失PDF，不覆盖已有原文或历史解读。

本次Dropout简介人工抽查纠正了保留/丢弃概率表述，原值、正确值、原文证据和原因保存在核查回执的 `paperPresentationCorrection`，供应商response不改。精确重放只在原摘要、原文摘录和回执输入一致时接受校订，不新增调用；不匹配时保留旧页面并失败，不自动猜测修正其他论文。验证见 [高引经典阅读验证](evidence/2026-10-08-classic-paper-reading.md)。

### 我的论文与统一元信息（2026-10-08）

新增模块迁移0089–0091：DOI、元信息和个人收录表。先确认没有正在发送的付费请求，再停止服务，运行迁移、类型检查、Web构建，重启API/worker/Web。迁移不删除或回填论文、PDF和解读，不把全部候选自动变成个人收藏。已有手动记录缺少来源审计时，先核对导入历史再单独采用个人收录；其他旧论文可从详情加入。

`POST /api/admin/papers` 默认仅保存到我的论文。调用方须传 `collection.read=true` 才启动精读；旧自动入队行为已从该导入接口移除。每日自动检索和已有阅读队列保持原机制。新收录接口和移除接口沿用管理员/CSRF边界；读取不触发模型或全文请求。

同一标识或相同PDF返回已有论文，不覆盖原文或完整解读。不同PDF版本和相互冲突的历史记录需核对后处理。个人移除仅删除收录标记及其标签、原因、方向、置顶信息，论文数据保留；重新加入可恢复访问，个人收录信息需重新填写。移除不取消已启动任务。元信息栏的CCF来源名称匹配不代表单篇类型已核验；DOI手动输入亦未外部核验。

### PDF身份识别与DOI核验（2026-10-09）

应用模块迁移0092，构建Web后重启API/worker/Web。新增身份预览表及`papers.identity` OCR队列，默认沿用已有MINERU_CALLS_ENABLED、凭据和预算；不开启额外开关，不改日更三篇。文字版PDF首页用已有PDF.js在限时/限内存线程提取；显式上传触发身份查询，页面GET只读。

文字身份查询使用固定Crossref/arXiv公共元数据接口。扫描识别由worker请求MinerU，经过预算和回执；额度等待与中断每5分钟恢复，未知回执不另开请求。确认导入后复用完整OCR解析材料，清除预览重复PDF字节，正式原文保留。未确认预览暂无自动清理期限，管理员可读，不作为公开出口。

身份对照不是正文覆盖、版本核验或单篇CCF类型核验。缺失日期不补造月日；来源只有可确定年份时显示年份。不同PDF命中已有论文时拒绝覆盖，后续原文版本功能再关联。重复导入不会清空已有个人收录信息。验证见docs/evidence/2026-10-09-pdf-doi-identity.md。
arXiv 专用 GET /api/admin/papers/resolve 已由 POST /api/admin/papers/import-preview（input 字段）替代；已移除旧入口，内部 arXiv 元数据读取仍由统一流程复用。

### 同篇原文与解读版本（2026-10-09）

先确认没有执行中的付费请求，再停止旧服务，应用模块迁移0093–0096、构建Web并更新API/worker/Web。迁移分别建立原文版本表、当前版本关联列、NOT VALID外键和独立约束验证；不删除已有论文、PDF、解读或笔记。历史数据采用需单独运行的`.dev/migrate-paper-versions.ts`保存当前材料快照；本机已采用467篇。回填不在发布迁移中执行，部署者应先备份并保留验收基线；读取页面不会回填或启动任务。新增论文、显式读写和发现流程会建立缺失的版本记录。

当前`papers`及材料、展示、解读、图表、任务表继续供现有流水线使用；切换时在一个事务中保存当前快照并恢复目标版本。PDF字节和SHA256独立保存，快照不包含重复二进制。个人收录、代码链接和阅读状态保留在论文层，笔记按PDF哈希及原版本定位。库页面可跳转旧版已完成文章。任务启动与写入同时检查当前版本和run_id，旧页面提交过期版本返回409；有未结束任务、队列作业或pending/unknown回执时禁止切换，不取消或清空请求。

新增管理员POST版本添加/切换，沿用身份和CSRF校验；详情、PDF及笔记Markdown的GET接受version参数并校验论文归属，维持private/no-store。添加另一份PDF需要本人确认同篇归属，已核验不同DOI/arXiv标识会拒绝；仅保存、仅切换和历史浏览不调用模型。明确点击切换并精读才交给已有worker和预算回执执行。自动arXiv新版本仅登记，不使当前材料与文章失效；元数据来源固定到获取到的vN，不把latest当作已核验版本。

验证记录见[原文版本管理](evidence/2026-10-09-paper-original-versions.md)。当前没有正文版本差异对比或历史任务单独运行功能；后续增加需继续确保引用绑定原文件。

### 核查失败定位与局部修订（2026-10-09）

没有数据库迁移或数据删除。构建Web、更新API/worker/Web前先确认没有执行中的付费请求及活动论文作业。新失败报告保存于现有阅读任务coverage.reviewFailure，绑定原文版本、正文内容/时间、书目信息、Skill版本及核查回执。历史版本只能查看；管理员POST /api/admin/papers/:id/review-repair需要CSRF、当前版本、报告回执及输入签名，只接受失败项的修订建议。任务入队在同一事务保存输入，重复点击或过期报告返回409；页面GET只读。

正常局部修订需要一次修订请求和一次独立核查请求，不重新调用MinerU或整篇初稿。修订复用的条件包括正文签名、失败主张及修订建议完全匹配；原始供应商response和原有审计不覆盖。独立核查分别返回文字accepted和boundary_consistent，两个都为true才接受，之后仍执行全篇主张ID、证据及原文摘录校验。核查再次失败会留下新问题，旧文章保留；预算等待沿用现有五分钟恢复调度，恢复复用已保存回答。正文变更明确失败，不做无意义队列重试，需要重新精读。

旧任务不会在页面访问时自动回填。需要采用旧失败记录时，可参考.dev/prepare-review-repair.ts：从原run_id对应文件读取初稿/核查结果，并逐一对照回执、Skill版本和当前正文输入；不匹配则停止。本机采用的记录为54，保留所有原始回答。

图表初选提示及已发布v3图表保持原有复用方式，新图表核查提示使用paper-illustrations-v3/quote-ids-v1，以原文片段编号取回摘录，仍检查图表归属、引用、插入位置和连续原句；不会批量重买已有图表。完整升级及真实验证见[核查修订验收](evidence/2026-10-09-review-repair.md)。

### PDF原图视觉解读（2026-10-09）

没有数据库迁移或数据删除。后台新增显式运行依赖pdfjs-dist 6.4.299、@napi-rs/canvas 1.0.10，安装/更新依赖并构建Web，确认无活动付费请求及论文作业后更新API/worker/Web。Node.js 24继续直接执行TypeScript。PDF.js标准字体、CMap和WASM均从已安装包读取，不要求浏览器截图、Python或外部PDF服务。

只对供应商明确支持图片的部署设置LLM_VISION=true；此标记是能力声明，不会让文字模型获得视觉能力。本机使用官方DeepSeek Flash，经[供应商视觉文档](https://api-docs.deepseek.com/guides/vision/)核对并真实调用确认，密钥不变。测试仅用本地假服务；新增视觉测试显式声明能力并核对收到的PNG及哈希。

当前PDF字节须与保存SHA一致。只渲染已选且有可靠MinerU页码/定位的最多六张图，补齐相交的原生文字和图像对象；渲染线程限45秒、PDF限20MB/500页、页面像素限1600万、单张PNG限5MB。定位不可靠、图像不可读或渲染失败停止视觉任务并保留旧解释，不以文本悄悄替代。当前仅接受本地原文PDF，不让模型抓取未授权外部图片地址。

第一轮看原图和图注，第二轮用同一原图与正文独立核查；视觉观察和text_context分开。引用ID、初选图表集合、视觉一致性、PDF/材料/解读版本和任务run_id均检查。模型调用继续经过回执和预算，PNG字节不写回执request，元信息、图片SHA与检查保存在审计中；输入身份哈希覆盖实际图片消息。图片缓存位于.data/eval/paper-visual/<PDF SHA>/<图片SHA>.png，不公开静态发布。图表selections新增视觉字段，旧数据没有该字段时标为文本依据；旧格式仍真实存在，不修改历史回执。

新增视觉提示paper-illustrations-vision-v2，旧文本v3及视觉v1继续可读，显式升级成功后替换当前解释；没有批量重买或迁移回填。原文版本历史快照保留相应图表字段。预算等待复用完整的同输入回答，未知结果不重发。真实验收见[视觉图表记录](evidence/2026-10-09-visual-illustrations.md)。

### 图文矛盾局部修订（2026-10-09）

视觉流程发布版本升级为paper-illustrations-vision-v3，像素初读保持原有v2输入身份，以复用真实存在的完整回答。当前图像核查回答必须逐条提供body_checks，涵盖正文全部主张；consistent/conflict绑定真实已渲染图，缺少视觉依据或图像不可读标not_assessable。已完成v2结果继续显示，显式升级或新精读才进入v3，不自动付费回填。

明确正文矛盾触发paper_visual_body_repair和paper_visual_body_review两次带原图请求。只能修改被定位的主张，简介可忠实同步，标题与其他段落不重写；独立复核必须确认修订事实及support边界、真实摘录ID、全部正文不再有明确图像矛盾，以及图下解释与原图一致。源文件本身的未解决图文冲突不通过修改解读伪造消解，任务停止。一次局部修订未通过即停止，保留失败定位，原有继续入口重新执行经过回执核对的任务。

通过后在同一事务内更新正文、简介、图表及新解读签名，并检查run_id、PDF、材料、原正文回执及简介没有被替换。诊断保存在现有任务coverage.visualBodyReview，审计保存在付费回执，原始回答不改写；没有新增表、迁移、开关或预算绕过。无矛盾不增加常规模型请求，有矛盾正常增加两次；预算等待保留原内容并复用同输入的已完成阶段。查看页面只读。测试明确声明视觉能力，避免本机LLM_VISION设置改变文本假模型用例。验收见[图文闭环记录](evidence/2026-10-09-visual-body-closure.md)。

### AI解读侧笔记（2026-10-09）

先执行迁移0097_paper_note_anchor.sql，再构建Web、更新API/worker/Web。迁移仅给paper_notes加一个可空anchor JSONB字段，不改写旧笔记，没有回填或删除；旧页码笔记和notes.md接口保留。后台笔记逻辑集中在modules/papers/backend/notes.ts，前端只经私有管理员HTTP接口读写。没有新增模型服务、队列、预算或环境开关。

新增笔记关联绑定所选原文版本和服务器生成的解读签名，原句、图表说明、证据及图片SHA均从服务端当前/历史材料取得，拒绝伪造或过期关联。历史版本笔记写到该原文，不写当前PDF。重放同一客户端UUID只取回已有笔记，编辑使用revision比较并保持关联不可移动；用户须明确处理跨页冲突，不自动覆盖别人保存的内容。

草稿只备份到当前标签页sessionStorage，不上传其他服务；刷新和站内返回可恢复，关闭标签页会清除草稿。离开前需确认已保存。保存失败/结果未知/冲突均保留输入；浏览器或存储不可用时显示提示。预览仅渲染后端已消毒的Markdown，外部图片与脚本不执行。当前仍是单人管理员工作空间，没有多人笔记归属或公开分享接口。未接PDF划线和导出界面。真实验收见[解读侧笔记](evidence/2026-10-09-reading-notes.md)。

### 精读执行与质量评测（2026-10-10）

执行模块迁移0098–0101，分别创建完整精读run历史、阶段事件、冻结质量报告及CONCURRENTLY索引。无删除、数据回填、环境开关或预算调整。先确认无pending付费请求及活动论文/质量作业，再更新API/worker/Web。原有任务历史不完整时只展示快照；升级后开始的任务才计算首次完成率。

新增管理员页面/papers/evaluation和私有报告读取/下载接口；明确POST才启动或继续质量评测。papers.quality队列沿用已有模型、视觉声明、回执和预算；每五分钟只恢复已提交且等待或中断的评分。快照绑定原文版本、文章回执、图表及输入哈希，不替换当前文章或笔记。生成模型与评分共用模型时页面明确提示；没有人工校准的六维分数不作为自动发布阈值。

评分返回真实块编号而非片段编号时按整块展开输入中全部真实片段，并保存referenceRepairs；未知编号仍失败。相同模型、提示、正文、图片及消息哈希的完整失败回答可重新校验后复用，保留供应商原回答，回执附paperQualityRecovery审计。该恢复不修改精读文章、不新增请求。

真实Dropout回答含14条短观察而被旧12条上限拒绝；取消观察条数的结构硬上限，每条内容、长度、图数量和独立视觉核查仍保留。BERT局部修订核查新增assessed_text，须逐字匹配当前修订，阻止核查已删除的旧文字；提示版本repair-check-v4，只影响后续显式修订，不重新购买已有文章。已保存失败回答仅按原输入与新校验精确回放，原始回答不改写。设计及验收见[精读评测](paperpulse/reading-evaluation.md)和[真实记录](evidence/2026-10-10-reading-evaluation.md)。

### 核查器校准（2026-10-10）

本次无迁移、环境变量或数据删除。先确认无pending付费请求及活动论文作业，再构建Web并更新API/worker/Web。修订核查升级repair-check-v5，去除传入旧blockers，要求当前问题原句；未报告事项的真实查阅片段独立审计，不冒充直接引用。BERT沿用原run恢复，不重置首次失败，之后继续正常选图和视觉核查。

质量量表默认paper-quality-v4，新增source_conflict、真实表格行列及逐项原文数字读取；恢复旧报告继续使用原提示版本。试验v5提示在真实控制样本上退化，故不作为默认，保留对应失败报告和profile。严格数字校验只允许有明确百分比表头且无跨格的真实表格恢复模型额外追加的%，记录格式修正和完整原回答；supported直接主张的小数/百分比须由核查读取覆盖。伪数字、未知引用及未支持的结果数字仍不放行。受控校准经现有papers.quality worker、回执与预算执行，预期标签不进入模型输入，不修改论文或笔记。详细设计及命令见[精读评测](paperpulse/reading-evaluation.md)。

本机按使用者此前优先保证精读质量的要求，将llm滚动日上限由60调至66供本轮验证，4次/分钟、24次/小时保持；记录在.data/eval/reviewer-calibration/budget-change.json。此项只在本机显式执行，不由升级、浏览或迁移自动调整；通用预算脚本默认仍60。真实回执、失败路径、样本范围及保留检查见[校准证据](evidence/2026-10-10-reviewer-calibration.md)。

### 每日检索限流与当天恢复（2026-10-10）

先确认无执行中的付费请求和论文作业，按停止服务、迁移、启动的顺序应用模块迁移0102、0103；两条迁移分别新增按日/方向保存的检索进度和arXiv共享请求冷却表，不删除论文、版本、笔记或旧失败运行。构建Web并更新API/worker，worker将注册每天06:00的日更和每五分钟的当天恢复任务；两者均受PAPER_DISCOVERY_ENABLED控制，不新增环境变量或自动修改付费预算。

各方向分别保存最近候选和前期趋势进度，429对整个arXiv元数据入口冷却，自动发现与手动预览串行、至少3.1秒间隔。短暂失败按15/30/60/120分钟恢复，尊重更晚的Retry-After，每窗口最多五次；永久错误保留失败。补跑仅处理当天06:00后的漏跑与到期方向，不重跑已完成窗口、不回补以前日期。首次升级当天已有旧成功记录时不额外检索；今日失败则可由恢复任务接续。检索完成、部分等待与真正精读完成分别展示，详见[验收记录](evidence/2026-10-10-discovery-recovery.md)。

### 自动日更PDF预检与补位（2026-10-10）

确认无执行中的付费请求后应用模块迁移0104、0105，构建Web并更新API/worker。两表保存按文件哈希的页数检查与当日超长退出记录，不删除已有论文、原文、笔记或历史运行。新的自动日更任务在付费解析前检查PDF，包括附录最多30页；超过上限退出当日队列并补位，手动任务仍可主动精读。20MB以上PDF遵循现有解析上限自动跳过，并在原任务留原因。首页展示规则和可展开记录。旧任务不会被升级脚本自动删除或重跑，已存在的超长当日分配需要先核查PDF并显式执行补位。

MinerU未知回执继续遵守原有30分钟一次性自动放行及计费未知审计，不能通过清空回执或冒充未计费解除阻塞。本机此次用户授权质量优先，将llm滚动日上限66改为100，分钟4、小时24不变；此项是有审计的本机操作，不是迁移默认值。真实三篇完整完成、图表格式修复及全量测试限制见[验收记录](evidence/2026-10-10-daily-length-and-mineru-recovery.md)。

### 官方RSS新闻启用（2026-10-10）

本机按用户选择启用10个官方/研究机构RSS，六类AI内容全部保留，排除规则留空，首次每源只导入一条。COLLECT_ENABLED=true，复用已有default模型；新闻和论文共用llm，当前本机请求熔断12/分钟、120/小时、500/滚动24小时，修改有审计，不作为新部署默认预算。没有启用其他八个示范源、X或公众号；全文展示保持关闭。

三个源直连超时，通过本机现有HTTP代理后试抓成功，本项目配置EGRESS_PROXY_URL=http://127.0.0.1:7890；更换机器需配置自己的可用代理或使用已核实可直连的网络。重启前应确认所有业务队列空闲，包括免费sources.fetch与content.extract-body，而不只检查论文与付费请求。受限网页若需Jina补取正文，还需用户配置JINA_API_KEY及非零jina预算；没有此凭据的来源不能声称正文已完整取得。每日新闻时间仍为08:00，历史回灌不冒充新热点。真实运行与未完成项见[新闻启动验收](evidence/2026-10-10-news-start.md)。

### Jina认证与匿名读取（2026-10-10）

更新后端并在全部业务队列空闲时重启worker/API，无数据库迁移。JINA_API_KEY仅在后端.env或collectors凭据组配置；有密钥优先，缺密钥或明确401/402时匿名读取。403、429、5xx及超时/未知回执不切换身份；两种模式仍共用jina回执与5/50/300的本机请求上限，任何零上限停用服务。供应商匿名模式有自己的限制，不以切换模式绕过限流。

成功缓存绑定实际读取窗口、认证模式及密钥指纹；拒绝、匿名成功和未知结果分别留记录。旧任务若已降级为正文未确认，应显式恢复正文提取阶段，再分析新原文，不能只重跑旧摘要。真实OpenAI新闻已body_status=ok、中文分析完成，原有筛选决定仍保留。测试setup隔离真实Jina凭据及采集代理，回归只连接本地假服务。详见[读取及恢复验收](evidence/2026-10-10-jina-key-anonymous-fallback.md)。
