# 论文解读 Skill 调研与底座适配

调研日期：2026-10-07。

状态：只读源码调研。已打开候选仓库的实际 SKILL.md、说明和部分脚本；未安装候选 Skill、未运行其脚本、未比较真实论文产出的准确率。本文件区分源码规则、项目说明和适配判断，不能把“规则写得完整”视为“解读已经验证可靠”。

## 1. Skill 在这里意味着什么

Agent Skills 是携带任务说明、可选脚本、参考材料和模板的目录格式。支持它的 Agent 按需读取 SKILL.md，再执行流程或加载材料；它不是另一个模型，也不会仅靠文件存在就执行多轮检索和核查。[标准概览](https://agentskills.io/home)、[格式规范](https://agentskills.io/specification)。

因此需要分清两种接入：

- 把可复用阅读规则、模板和质量标准交给现有后台，后台明确安排各阶段。
- 使用能够读取文件、查看 PDF/图片、检索文献并执行工具的 Agent，按 Skill 动态完成整个工作流。

两者都能使用 Skill 的方法，但后一种需要额外的执行环境。用一次模型调用载入完整 Skill 文本，不能保证其中要求的逐图查看、外部引用核对和复现检查已经发生。

## 2. 候选比较

以下顺序按当前网站的适配程度排序，不是模型效果排名。

| 候选 | 已核查的方法 | 输出与依赖 | 当前适配判断 |
|---|---|---|---|
| [techdou/paper-reading](https://github.com/techdou/paper-reading) | 先建立论文全貌，核对主张与实验，再按需深读方法、公式和复现；区分论文事实、仓库事实与推断 | 快读、标准解读、局部深读等模式；HTML 可选；Python 仅为可选校验/批注工具 | 首选阅读协议，接入已有解析与页面较轻 |
| [sodalone/paper-reading-skill](https://github.com/sodalone/paper-reading-skill) | 先识别论文类型，建立 Claim—Evidence—Verdict 与独立证据定位，再补全长篇阅读报告 | arXiv 专用预处理，Bash、Python、requests、BeautifulSoup、PyMuPDF；Markdown 主报告 | 适合深读参考，完整流水线与现有解析重叠较多 |
| [xirang-husir/paper-innovation-reader-skill](https://github.com/xirang-husir/paper-innovation-reader-skill) | 结合阅读、检索与评审规则，审计贡献、创新、复现、失败边界和可迁移研究想法 | 默认完整中英文两份报告；组合多个上游工作流；依赖运行时的浏览、PDF、视觉工具 | 适合后续“研究价值/想法”扩展，当前日更主流程较重 |

### 2.1 首选：techdou/paper-reading

实际 [SKILL.md](https://github.com/techdou/paper-reading/blob/main/SKILL.md) 提供快读、标准解读、公式/图表局部深读、方法与复现等模式。它先恢复“问题—已有瓶颈—设计动作—机制变化—实验证据—结论边界”，明确将摘要当作待核查主张，要求实际检查用于解读的图表与公式，并记录原文位置。

[证据质量规则](https://github.com/techdou/paper-reading/blob/main/references/evidence-quality.md) 要求性能判断带数据集、指标、比较对象、幅度和条件，检查公平比较、额外训练数据、消融与复现材料。它适合提炼成我们论文模块的阅读协议。

它不自带完整的文献发现服务，也不把正式同行评审、全文翻译当作本 Skill 的范围。可选 [HTML 校验器](https://github.com/techdou/paper-reading/blob/main/scripts/validate_paper_html.py) 检查公式渲染、SVG、Mermaid 和页面契约；它不能证明科学结论与原文一致。

许可已核查为 [Apache-2.0](https://github.com/techdou/paper-reading/blob/main/LICENSE)。[NOTICE](https://github.com/techdou/paper-reading/blob/main/NOTICE.md) 明确说明来自 [Agentchengfeng/paper-reading-skills](https://github.com/Agentchengfeng/paper-reading-skills)。两者应按同源方案理解，不应当作两个独立验证结果；改编时保留来源与许可说明。

### 2.2 精读参考：sodalone/paper-reading-skill

实际 [SKILL.md](https://github.com/sodalone/paper-reading-skill/blob/main/SKILL.md) 比 README 更明确：输入必须能解析出 arXiv ID，当前流水线不支持任意本地 PDF、普通 PDF URL 或 DOI 页面。默认完整 review 模式，正文软目标为 10,000–18,000 个字符；理论、方法、系统、数据集等论文分别采用匹配的证据，避免机械凑图、公式或实验表。

[run_pipeline.sh](https://github.com/sodalone/paper-reading-skill/blob/main/scripts/run_pipeline.sh) 实际执行工作区准备、来源抓取、引用抽取、图片抽取、报告骨架生成与校验。脚本并未调用模型完成完整解读，仍由宿主 Agent 读材料、补写主报告。[依赖文件](https://github.com/sodalone/paper-reading-skill/blob/main/requirements.txt) 包含 requests、beautifulsoup4、pymupdf。

[validate_report.py](https://github.com/sodalone/paper-reading-skill/blob/main/scripts/validate_report.py) 主要检查标题、占位符、Claim ID 定位覆盖、公式/图片计数、引用链接格式与重复段落；未见逐条判断证据是否支持结论的语义校验。不能把“验证器通过”解释为论文解读事实准确。

截至此次查询，仓库根目录未展示 LICENSE，访问 main/LICENSE 返回 404，SKILL.md 也未声明许可。这里只记录“许可未确认”，不将公开可读仓库直接视为已获复制和分发授权。适合作为方法参考，尚不建议整包纳入项目。

### 2.3 后续扩展：paper-innovation-reader-skill

实际 [SKILL.md](https://github.com/xirang-husir/paper-innovation-reader-skill/blob/main/SKILL.md) 要求贡献与作者主张分离、图表证据检查、近期文献验证、代码/数据链接实际访问及创新想法的证据标注。它不是单一短提示词，而是调用或读取 nature-reader、academic-research-suite 等上游规则的组合协议。默认中英文报告均为完整版本，运行时缺少视觉或浏览工具时必须声明对应证据未验证。

它更贴近科研想法挖掘，而当前网站先要可靠地讲清论文。把默认整套流程加入每天三篇的解读，会扩大检索、图像检查、上下文与输出成本，这是基于源码要求作出的适配判断，尚未实测费用和耗时。

[项目许可说明](https://github.com/xirang-husir/paper-innovation-reader-skill#license) 写明原创文件为 MIT，但 vendor 中 academic-research-skills 子集使用 CC BY-NC 4.0。因此整个组合包不能简单当成纯 MIT 依赖。复制具体文件前需要分别核对原许可；本次未成功读取全部第三方许可全文。

## 3. 建议选用的内容

优先采用 techdou 的分层阅读与证据质量协议：让日常解读以“读懂问题、机制、决定性实验、适用边界”为交付范围；精读时再加入图表、公式、实现与相关工作审查。sodalone 的论文类型路由、Claim—Evidence—Verdict 表可以作为补充设计参考；创新审计和研究想法暂留后续。

任何候选都没有在本次调研中证明优于现有解读。决定接入前，应用同一组真实论文评估：核心问题是否解释清楚、关键数字是否带条件、引用是否确实支撑结论、图表是否实际查看、未验证结论是否标注，以及每篇耗时与模型费用。完整 Skill 工作流的收益需要这类对照，而不是靠名称或 README 质量判断。

## 4. 底座新闻解读的实际实现

以下结论来自当前工作区源码检查，不依赖上游 README 的概括。

### 单篇新闻

[`runAnalysis`](../../packages/backend/src/editorial/analyze.ts) 的流程是：

1. 预筛选行业相关性，BLOCK 停止，PASS/UNKNOWN 继续。
2. 具备信源门槛的材料进行两次独立评分，以分数之和和对应门槛决定精选；不是写作模型自己决定精选。
3. 与评分并行提取类别、标签、主体、新闻事实及条件。代码会丢弃未同时出现在原始材料与模型可见材料中的引文。
4. 入选或接近门槛的材料调用内容理解；其他材料走较轻的标题/摘要生成，短中文推文可直接保留。

内容理解使用 [`understand.md`](../../industry/prompts/understand.md)，组合 [`content-understanding.md`](../../industry/prompts/content-understanding.md) 与防幻觉、独立标题、答案前置等共享规则。一次输出内容类型、作者角色、标签、阅读价值、中文标题和中文摘要六个字段。它是编辑任务，不是针对论文公式、实验和复现的精读协议。

[`writing.ts`](../../packages/backend/src/editorial/writing.ts) 组装来源、作者、正文、引用关系和材料质量，正文上限为 60,000 字符；生成后还有主体身份与文案处理。整个分析流程多次调用模型，各次承担不同业务任务；内容理解本身是一次请求。

### 同一事件的新闻综述

[`events/digest.ts`](../../packages/backend/src/events/digest.ts) 从统一 publication 读取符合条件的报道及事实证据，结合此前综述与新增报道，使用 [`story-digest.md`](../../industry/prompts/story-digest.md) 更新事件概览。内容更正、报道撤回等情况下会从当前材料重写，避免旧说法沿用；输入哈希用于判断是否需要更新。提示词要求把条件绑到相应对象，保留影响结论的来源分歧。

### 可继续复用的基础能力

- Markdown 提示词及共享文件引用：[`editorial/prompts.ts`](../../packages/backend/src/editorial/prompts.ts) 支持模板与 include，对实际使用文件做内容哈希版本管理。
- 模型请求及结构化校验：[`providers/llm.ts`](../../packages/backend/src/providers/llm.ts) 的 `chatJson` 发送 system/user，校验 JSON/Zod 输出，通过付费回执保存和复用结果；该调用链没有 Skill 发现、资源读取或工具调用循环。
- 后台任务、预算与公开读取边界：[`architecture.md`](../architecture.md) 规定模型任务在 worker 中执行，页面读取已生成内容，所有付费调用走回执和预算。
- 同案例对照评测：[`story-digest-evaluation.md`](../story-digest-evaluation.md) 已提供现有/候选新闻综述提示词同输入并排评估的方法，可借鉴到论文阅读协议的验收。

这些基础能力与 Skill 并不冲突。Skill 可以维护阅读方法、参考规则与交付约定，后台继续承担任务执行、版本、费用、证据约束和结果发布。

## 5. 当前论文解读的差距

[`modules/papers/backend/digest.ts`](../../modules/papers/backend/digest.ts) 当前为 `paper-digest-v3`：从已解析的正文材料中组织最多 90,000 字符，优先保留实验相关章节；一次 `chatJson` 返回中文标题、简介及五节主张（结论、问题、方法、实验、局限），输出上限 6,000 token，等待 120 秒。

代码校验章节、主张 ID、证据 ID 是否存在于实际发送的材料中，并要求 direct/synthesis 主张有引用。它没有进一步检查该证据在语义上是否支持主张，也没有单独安排图像查看、公式推导、实验表逐项对照或相关工作检索。输入主要是文本证据块；不能因 Skill 要求看图，就声称模型已经实际查看图像。

[`queue.ts`](../../modules/papers/backend/queue.ts) 已把正文解析与解读放进 worker，并处理任务状态及输出错误。此基础可以继续使用。

## 6. 适配建议与验证顺序

以下是设计建议，尚未实施：

1. 先固定 techdou 的一个版本，采用标准解读及证据质量规则，在论文模块中维护阅读协议和参考文件；保留来源及许可说明。Skill 与所用参考文件的内容哈希进入生成版本，避免只换文件名却无法追溯规则。
2. 已有 MinerU 材料和论文元数据继续作为输入。先检查章节覆盖、材料缺失和长度裁剪，再按阅读协议解释问题、方法机制、决定性实验与边界；保留现有五章节交付结构。
3. 在发布前对关键结论、实验数字、基线和条件回读原始证据。代码检查 ID、结构及可确定的格式错误，模型检查语义对应；人工抽检仍负责识别模型共同遗漏的错误。复核不能只阅读第一版摘要而不读原文。
4. 所有模型请求仍由现有 worker 通过 `chatJson` 和回执发出。完整动态 Skill 执行若后续确有必要，再增加受控的材料/图片读取工具及有步数、预算上限的执行循环；暂不引入另一套抓取、解析和发布体系。
5. 首轮用已导入的三篇真实论文做当前版与候选版同输入对照，分别记录材料覆盖、方法解释、实验数字与条件、引用支持和局限判断。确认阅读质量改善后，再扩展图表、公式与复现的按需深读；同时记录调用数、token、耗时和失败情况，不预设成本已经可接受。

建议先验证“标准论文解读 Skill + 已有后台执行与证据体系”。采用 Skill 后的可靠性仍取决于阅读与核验步骤实际执行，以及模型获得了哪些原始材料。
