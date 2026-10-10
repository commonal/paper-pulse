# 精读执行与质量评测

首版先衡量完整流程能否完成，质量评分作为独立的、未人工校准的意见。运行页 `/papers/evaluation`，管理员接口均私有、不缓存。浏览和刷新只读；启动评分将冻结论文版本、正文、解读、图下解释及哈希，再交 worker。

## 执行口径

- `paper_reading_tasks` 是当前任务状态；新增 `paper_reading_runs` 保存每次启动，`paper_reading_events` 保存状态变化、失败、手动/自动恢复和修订。变更与历史同事务保存。被替代任务保留，不把旧失败抹掉。
- 完整精读从 material/coverage 启动，图表单独升级另计；没有从起始记录的旧任务不能计算首次成功率。旧状态快照不回填或猜测历史。
- 首次无中断完成：complete/ready 且无失败、等待或恢复记录 / 已结算任务。已结算为当前完整完成、失败、材料不可用。等待/处理中/被替代分别计数，并同时展示全部启动完成比例，防止隐藏未完成任务。
- 最终完成率：含恢复的完整完成 / 已结算任务。失败后恢复完成另外计数。正文解读复用与未复用分开，不能把缓存复用当作新模型执行成功。
- 失败按阶段与原因分组，提供原错误、回执、run_id、版本、时间及恢复过程。P50/P95是包含队列与等待的墙钟耗时，不是纯模型延迟。
- 本地假模型测试不进入真实部署数据库统计。历史供应商 attempt 状态另列，不代表整篇成功率。少于20次明确标小样本；20不是发布门槛，也不证明稳定。

## 自动质量评测

一次独立模型请求，完整非参考文献材料；超过18万字符停止，不静默删减。逐条核对全部主张，检查事实、数字及条件、重要覆盖、边界、图表、中文可读性。六维0–4，不能判断/不适用为null，不给总分或自动通过阈值。评分解释、问题和遗漏均可追溯原文片段；引用由宿主取回原句，未知片段、缺失主张及重复维度均拒绝。图表无解释时不得凭空评分。

视觉开启时从该版本PDF裁切已选最多六张图，再送评分模型；只覆盖这些原图。未启用视觉时明确为文字评测。记录评分模型、生成模型、量表版本、原文版本、输入哈希、回执及确定性检查。当前默认与生成共用模型，有相关盲点，不叫独立供应商验证。初期需人工抽查以校准量表，未来比较模型/Skill必须使用同一冻结样本，不能跨论文直接比较平均分。

结果存 `paper_quality_evaluations`，不修改正文解读、原文、图表或笔记。同一快照/量表复用报告；失败和等待可继续同一快照，费用经过原回执和预算。定时恢复只处理明确已提交的评测。任务替代不删除历史评分，不把旧评分展示成新文章的评分。

模型误把真实block_id放入quote_ids时，仅对输入中实际存在的整块展开全部已提供片段，记录referenceRepairs；不猜某句、不接受前缀或未知编号。完整失败回答只有模型、提示、正文、图片、系统及用户输入哈希完全一致并重新通过所有校验时才恢复，不新增模型请求，原始回答保留。评分模型也可能误判；原文正文与表格不一致时需人工抽查，不按高分自动修订或发布。

## 运行

### 核查器校准

局部修订核查使用 `repair-check-v5`：仅接收当前修订和完整原文，不传上一轮blockers或旧稿意见；核查须逐字复制当前文字，拒绝时还须指出该文字内的连续问题片段。`not_stated`查阅的真实上下文独立记录为contextQuotes，不强行成为该主张的直接引用。伪引用及无依据的推断继续拒绝，未通过仍不发布。

当前默认质量量表 `paper-quality-v4` 区分有支持、疑似矛盾、依据不足、原文自身冲突。完整原文引用之外提供从真实HTML解析的table_rows，保留原行列及跨格；数值审计先读取原文，再按模型、数据集、指标及条件比较，记录修改前后各值。宿主校验每个数字实际存在于指定片段，不把较长数字的子串当成正确值；直接主张若判supported，其小数结果或百分比必须被实际读取覆盖，不能拿另一组正确数字代替。版本号v1.1等不当作结果值。仅对无跨格、列标题明确含%的原表，允许将模型额外追加的百分号恢复为真实单元格文字，并记录numericFormatRepairs；不换算、不改数值或判断。原文不存在的91.9等继续失败。

开发校准曾试验v5附加提示，但真实回答出现循环截断和故意错误漏判，故撤回该默认提示，保留试验报告和其冻结profile以便追溯，不将更长提示视为改进证据。

受控样本来源于冻结的BERT/Dropout材料，含保守未报告、正确结果、故意改错、错误声称未报告，以及正文/表格冲突。标签由本轮Agent对照原文建立，尚待人工复核；`calibration`标签由宿主剥离，不传给评分模型，不发布受控文章。报告单列判断命中和失误，不展示这些故意改错样本的六维评分作为真实论文质量。它们是同一数据上的开发校准，缺少独立留出集，不能据此估计总体准确率。

旧报告继续保留原量表；恢复v1–v4使用该版本的冻结提示和消息身份，不偷偷升级口径。相同输入的完整失败回答重新通过校验后可恢复，原始response不修改；语义误判留在报告，不由预期标签替模型改判断。具体历史见[核查器校准](../evidence/2026-10-10-reviewer-calibration.md)。

```powershell
# 显式受控核查，使用完成报告绑定的原文版本，经worker及付费回执执行
node --env-file=.env modules/papers/scripts/calibrate-reviewer.ts --from <BERT冻结评分UUID> --kind bert
node --env-file=.env modules/papers/scripts/calibrate-reviewer.ts --from <Dropout冻结评分UUID> --kind dropout
```

CLI核对当前保存材料与基线的全部真实片段ID、文本、页码和章节，忽略JSONB字段排序，证据变动则拒绝补入其他版本表格。清单保存在 `.data/eval/reviewer-calibration/<量表>/`，默认不覆盖已有文件。

升级迁移0098–0101后重启API和worker。报告可以从页面下载JSON。新增 `modules/papers/scripts/evaluate.ts` 提供无模型读取报告及显式提交评分命令。评分和执行率是两条数据链，不把质量评分成功计入精读成功率。

实际重跑样本与评分记录见对应验收文件；历史状态和未来观测数据必须区分，不能将测试回放包装成真实首次完成率。

```powershell
# 只读部署报告
node --env-file=.env modules/papers/scripts/evaluate.ts --report --out .data/eval/paper-quality/report.json
# 显式提交一篇已有文章的评分
node --env-file=.env modules/papers/scripts/evaluate.ts --quality <论文UUID>
# 冻结1–3篇已解析、已有解读的真实样本；不得覆盖已有批次
node --env-file=.env modules/papers/scripts/evaluate.ts --prepare <逗号分隔的论文UUID> --out .data/eval/reading-benchmark/batch/manifest.json
# 按冻结配置启动各样本，一篇只能启动一次
node --env-file=.env modules/papers/scripts/evaluate.ts --manifest .data/eval/reading-benchmark/batch/manifest.json --start 0
node --env-file=.env modules/papers/scripts/evaluate.ts --manifest .data/eval/reading-benchmark/batch/manifest.json --status --out .data/eval/reading-benchmark/batch/result.json
```

真实批次以样本标识进入请求身份，防止旧正文/图表回执把重跑变成缓存命中；恢复沿用相同标识，保留已有回执和费用边界。第一轮复用既有解析正文，不重新购买MinerU，不代表PDF冷启动执行率。失败时通过原流程恢复或修订，保留首次失败和人工干预记录，不另开run替换结果。验收见[三篇真实评测](../evidence/2026-10-10-reading-evaluation.md)。
