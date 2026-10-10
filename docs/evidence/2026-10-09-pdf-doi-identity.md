# PDF 身份识别与 DOI 核验

## 已实现

导入页支持 DOI、DOI链接、arXiv链接和 PDF。上传文字版 PDF 后在限时、限内存的 Node worker thread 中读取首页，提取标题、作者区线索及标识符。只查询固定 Crossref/arXiv 元数据接口，不抓取任意用户链接。Crossref免费元数据通过官方 `/works/{doi}` 和 `query.bibliographic` 获取；模型不参与身份猜测。

匹配需要首页标题规范化一致，并有作者姓氏对照；多个匹配和无充分佐证时保留本地 PDF 身份，让使用者核对候选。首页“References”之后的标识符排除；正文无关 DOI 不会被自动选为本篇，PDF 内部 Title 也须与首页标题一致才能采用。这里证明身份线索对照，不证明正文完整、正式版本或单篇 CCF Full/Regular 身份。

DOI单独查询只表示登记记录存在，明确未核验所持 PDF。日期不补造月日，目前没有确定完整日时保守显示年份。核验结果存服务端，确认时检查预览编号、候选键和 PDF 哈希；修改 DOI 或更换文件需重新核验。手动修改标题、作者或来源会标注为手动修改，不沿用原自动匹配结论。

相同 PDF、DOI、arXiv标识和来源复用既有论文。重复导入已收录论文保留个人标签、原因、方向、置顶和笔记；管理收录接口仍允许使用者显式修改个人信息。已有不同 PDF 不覆盖原文与解读，待原文版本阶段支持关联。

相同文件仅表示文件已收录，不提升旧书目信息的核验状态或刷新外部核验时间。旧arXiv专用GET预览接口已由统一POST导入预览替代，其内部元数据读取方法继续用于新流程。

## OCR 与付费边界

扫描首页文字不足且既有 MinerU 开关/凭据已配置时，上传操作将 OCR 任务交给 `papers.identity` 队列，页面仅轮询已保存状态。OCR请求沿用 MinerU 预算和回执。完整解析材料保留到预览，确认导入后可复用于精读正文阶段，后续覆盖检查、Skill精读、核查、选图流程保持。

额度等待或中断任务每五分钟恢复；结果未知/正在发送的回执不启动另一笔请求，失败材料需显式重试。预览GET和一般页面读取不触发元数据查询、MinerU或模型。DOI信息尚无全文时仅保存，需补原文后精读。

预览及原文、材料仅管理员可读，写入沿用CSRF。确认后清除预览重复PDF字节，正式论文原文保留。未确认的预览保留，以便恢复OCR；目前未增加自动清理期限。迁移0092单条CREATE TABLE，已成功应用，旧数据不回填、不删除。

## 真实验证（2026-10-08 晚至10-09）

- 使用 [ACL 官方 BERT 页面](https://aclanthology.org/N19-1423/) 与其原文PDF，核验 DOI `10.18653/v1/N19-1423`。Crossref标题检索还返回Spectrum-BERT等其他作品，系统排除其自动匹配，选中标题和作者都对应的BERT。
- 文字PDF预览 `ba75f5fa-5325-4ca5-86ca-270374b3a7ef`，PDF SHA256 `987545ffb087f1ece898142c403a516baeabeb70ce19089397fac6f7db12c3d4`。
- 在真实网页选择“仅保存”，站内论文 `54729fb3-de38-46b4-a094-aa9bdc0fa63f`，有完整原文、identity_status=matched，阅读任务数0，没有启动精读。
- Dropout相同PDF自动识别为既有 `a70bb7c2-ed9c-407e-8ef1-2916a6d12b44`，复用已有解读，无新供应商调用。
- 按PDF技能将BERT首页渲染成单页图像PDF，仅作为扫描识别测试，确认没有可提取文本，视觉核对清晰完整。预览 `eb3636b6-07fd-4438-aecf-cdbb1de5d6eb` 由真实worker解析，14个块，完成后仍自动对照到正确BERT记录。测试样本没有作为完整论文保存，也没有开始其精读。
- OCR回执51，service=mineru，status=completed。该流程仅增加1次MinerU请求；没有LLM精读请求。原有8篇ready解读的正文校验值与回执编号全部保留。
- 浏览器一次上传核查的自动审批等待超时；重新读取页面后确认上传与匹配已成功，后续保存和扫描验证完成，未绕过浏览器安全控制。

## 自动检查

- 类型检查、Web构建通过。
- 模块/架构/迁移回归95/95通过；最终身份+收录专项9/9通过。覆盖错误身份、参考文献 DOI、伪造PDF元数据、文件更换、候选键伪造、重复导入个人信息保护、匿名/CSRF边界、OCR预算等待、未知回执与材料复用。
- 完整后端回归778项：759通过、14失败、5取消。涉及既有Windows SIGTERM超时、pg_dump/sh缺失、OpenSSL配置环境，以及召回池测试启动前数据库名重复。召回池单独重跑1/1通过。本次相关检查通过，不将全量检查报告为通过。
- 完整Web回归55项：42通过，13项因为缺少Chromium1228无法启动。SSR/cache另行通过；真实浏览器验证了上传、自动填充、选择仅保存和OCR完成。

主要实现：`modules/papers/backend/identity.ts`、`pdf-identity-worker.ts`、`modules/papers/identity.ts`、`web/new.tsx`。依据 [Crossref官方接口说明](https://github.com/Crossref/rest-api-doc) 和 [PDF.js Node示例](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs)，复用现有依赖与MinerU，不改变每日三篇和任何供应商预算。
