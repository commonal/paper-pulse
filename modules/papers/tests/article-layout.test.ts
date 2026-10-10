import test from "node:test";
import assert from "node:assert/strict";
import { illustrationAnchors, illustrationCandidates, validateIllustrationPlan, validateIllustrationReview } from "../backend/illustration-plan.ts";
import { citationNumbers } from "../web/digest-layout.ts";
import { pdfRegion, completeFigureRegion } from "../web/pdf-region.ts";
import type { Paper, PaperBlock, PaperDigest, PaperMaterial } from "../types.ts";

const date = "2026-10-07T00:00:00.000Z";
const paper = { has_pdf: true, pdf_sha256: "current" } as Paper;
const figure: PaperBlock = { id: "f2", kind: "figure", text: "Pipeline", caption: "Figure 2: Pipeline.", section_path: ["Method"], page: 4, bbox: [180, 100, 820, 400], locator: "fixture:figure" };
const table: PaperBlock = { ...figure, id: "t1", kind: "table", caption: "Table 1: Evaluation.", page: 6 };
const table2: PaperBlock = { ...table, id: "t2", caption: "Table 2: Ablations.", page: 8 };
const appendix: PaperBlock = { ...table, id: "t9", caption: "Table 9: Appendix.", page: 27 };
const blocks = [figure, table, table2, appendix];
const claim = (id: string, refs: string[]) => ({ id, text: `${id}的原文解读`, support: "direct" as const, evidence_block_ids: refs });
const digest: PaperDigest = { paper_id: "test", status: "ready", model: "test", prompt_version: "test", receipt_id: 1, error: null,
  updated_at: date, material_updated_at: date, sections: [
    { id: "summary", title: "一句话结论", claims: [claim("s1", ["t1", "missing"])] },
    { id: "method", title: "核心方法", claims: [claim("m1", ["f2"]), claim("m2", ["f2"])] },
    { id: "experiments", title: "实验", claims: [claim("e1", ["t1"]), claim("e2", ["t1", "t9"]), claim("e3", ["t2"])] },
  ] };
const material: PaperMaterial = { paper_id: "test", status: "ready", parser: "mineru_api", markdown: "test", blocks, updated_at: date, error: null, receipt_id: 1 };

test("引用序号跨段落稳定复用，缺失出处和未陈述主张不产生可点击序号", () => {
  const sections = [...digest.sections, { id: "limits", title: "边界", claims: [{ ...claim("l1", ["unknown"]), support: "not_stated" as const }] }];
  const numbers = citationNumbers(sections, blocks);
  assert.deepEqual([...numbers], [["t1", 1], ["f2", 2], ["t9", 3], ["t2", 4]]);
});

test("初选可用附录中的更好证据，多张不同图表可支持同一段落，但不能重复图表或虚构出处", () => {
  const selection = { block_id: "t9", after_claim_id: "e2", title: "附录资源表", selection_reason: "这里的实验条件更完整。",
    reading_guide: "先阅读指标定义和条件。", takeaway: "此表列出了实验结果。", caveat: "条件不同不能混合比较。", evidence_block_ids: ["t9"] };
  const plan = { selections: [selection], reason: "按内容价值挑选，而非编号顺序。" };
  validateIllustrationPlan(plan, illustrationCandidates(paper, material, digest), digest, blocks);
  const second={...selection,block_id:'t1',evidence_block_ids:['t1']};
  assert.doesNotThrow(()=>validateIllustrationPlan({...plan,selections:[selection,second]},blocks,digest,blocks));
  assert.throws(() => validateIllustrationPlan({ ...plan, selections: [selection, selection] }, blocks, digest, blocks), /重复/);
  assert.throws(() => validateIllustrationPlan({ ...plan, selections: [{ ...selection, block_id: "missing" }] }, blocks, digest, blocks), /定位/);
  const review = { publishable: true, blockers: [], checks: [{ block_id: "t9", verdict: "supported" as const, reason: "原文可核对", quotes: [{ block_id: "t9", quote: "Pipeline" }] }], final: plan };
  assert.equal(validateIllustrationReview(review, plan, blocks, digest, blocks)[0]!.reading_guide, selection.reading_guide);
  assert.throws(() => validateIllustrationReview({ ...review, checks: [{ ...review.checks[0]!, quotes: [{ block_id: "t9", quote: "made up" }] }] }, plan, blocks, digest, blocks), /原文/);
  const caption = { ...review, checks: [{ ...review.checks[0]!, quotes: [{ block_id: "t9", quote: "Table 9: Appendix." }] }] };
  assert.equal(validateIllustrationReview(caption, plan, blocks, digest, blocks).length, 1);
  assert.throws(() => validateIllustrationReview({ ...review, checks: [{ ...review.checks[0]!, quotes: [{ block_id: "t9", quote: "<i></i>" }] }] }, plan, blocks, digest, blocks), /原文/);
});

test("未解析、过期正文、没有PDF或未知坐标格式时不展示误导性的图表", () => {
  assert.deepEqual(illustrationCandidates({ ...paper, has_pdf: false }, material, digest), []);
  assert.deepEqual(illustrationCandidates(paper, { ...material, parser: "arxiv-html-lite" }, digest), []);
  assert.deepEqual(illustrationCandidates(paper, material, { ...digest, material_updated_at: "2026-10-06T00:00:00Z" }), []);
  const invalid = { ...material, blocks: blocks.map(block => ({ ...block, bbox: [0, 0, 0, 20] as [number, number, number, number] })) };
  assert.deepEqual(illustrationCandidates(paper, invalid, digest), []);
});

test("同页同高度的无图注左面板与有图注右面板合并，不合并有自身图注的相邻图", () => {
  const right = { ...figure, bbox: [510, 330, 800, 440] as [number, number, number, number], locator: "mineru:content_list.json#/1" };
  const raw: { type: string; page_idx?: number; bbox?: number[]; image_caption?: string[] }[] = [{ type: "chart", page_idx: 3, bbox: [210, 332, 490, 440], image_caption: [] }, { type: "chart" }];
  assert.deepEqual(illustrationCandidates(paper, { ...material, blocks: [right] }, digest, raw)[0]!.bbox, [210, 330, 800, 440]);
  raw[0]!.image_caption = ["Another figure"];
  assert.deepEqual(illustrationCandidates(paper, { ...material, blocks: [right] }, digest, raw)[0]!.bbox, right.bbox);
});

test("有子面板标注的多行总览图完整合并，不修改正文中的原始证据块", () => {
  const parent = { ...figure, bbox: [666, 696, 808, 787] as [number, number, number, number], locator: "mineru:content_list.json#/4", page: 1 };
  const raw = [
    { type: "image", page_idx: 0, bbox: [189, 555, 287, 659], image_caption: ["(a) Photograph"] },
    { type: "image", page_idx: 0, bbox: [537, 556, 805, 679], image_caption: ["(c) Adapt"] },
    { type: "image", page_idx: 0, bbox: [189, 696, 470, 800], image_caption: ["(d) Operate"] },
    { type: "chart", page_idx: 0, bbox: [472, 698, 656, 787], chart_caption: ["(e) Accepted"] },
  ];
  const result = illustrationCandidates(paper, { ...material, blocks: [parent] }, digest, raw);
  assert.deepEqual(result[0]!.bbox, [189, 555, 808, 800]);
  assert.deepEqual(parent.bbox, [666, 696, 808, 787]);
});

test("成本或限制图表可插入已有局限段落，避免因固定章节规则误拒合理位置", () => {
  const section={id:"limitations",title:"局限",claims:[claim("l1",["t9"])]};
  const plan={reason:"成本是实用性的重要限制",selections:[{block_id:"t9",after_claim_id:"l1",title:"成本表",
    selection_reason:"说明部署代价",reading_guide:"阅读成本列",takeaway:"成本需要考虑",caveat:"只限该实验条件",evidence_block_ids:["t9"]}]};
  validateIllustrationPlan(plan,blocks,{...digest,sections:[...digest.sections,section]},blocks);
  assert.throws(()=>validateIllustrationPlan({...plan,selections:[{...plan.selections[0]!,after_claim_id:"s1"}]},blocks,digest,blocks),/段落/);
});

test("动机图可放在已有研究问题段落，可选位置明确排除摘要与未知主张", () => {
  const expanded={...digest,sections:[...digest.sections,{id:'problem',title:'研究问题',claims:[claim('p1',['f2'])]}]};
  const plan={reason:'解释研究动机',selections:[{block_id:'f2',after_claim_id:'p1',title:'动机图',
    selection_reason:'解释为何提出方法',reading_guide:'比较两组实验',takeaway:'作者观察到差异',caveat:'限于所测条件',evidence_block_ids:['f2']}]};
  assert.deepEqual(illustrationAnchors(expanded).map(c=>c.id),['m1','m2','e1','e2','e3','p1']);
  assert.doesNotThrow(()=>validateIllustrationPlan(plan,blocks,expanded,blocks));
  for(const id of ['s1','unknown'])assert.throws(()=>validateIllustrationPlan({...plan,selections:[{...plan.selections[0]!,after_claim_id:id}]},blocks,expanded,blocks),/段落/);
});

test("PDF裁剪使用页面归一化坐标和实际尺寸，并拒绝空框与非法坐标", () => {
  assert.deepEqual(pdfRegion([250, 100, 750, 500], 1000, 2000), { left: 250, top: 200, width: 500, height: 800 });
  assert.deepEqual(pdfRegion([0, 0, 1000, 1000], 1000, 2000), { left: 0, top: 0, width: 1000, height: 2000 });
  for (const box of [undefined, [0, 0, 0, 20], [0, 0, 1001, 20], [NaN, 0, 10, 20], [-1, 0, 10, 20]]) assert.equal(pdfRegion(box, 1000, 2000), null);
  assert.equal(pdfRegion([0, 0, 10, 20], Infinity, 2000), null);
});

test("图片裁剪补齐相交文字与原生图像框，不扩展到相邻图或整页背景", () => {
  const region={left:300,top:100,width:300,height:300};
  const result=completeFigureRegion(region,[{left:270,top:105,width:140,height:20},{left:100,top:550,width:700,height:25}],
    [{left:305,top:110,width:310,height:340},{left:0,top:0,width:1000,height:1500},{left:700,top:100,width:200,height:200}],1000,1500);
  assert.deepEqual(result,{left:270,top:100,width:345,height:350});
  assert.deepEqual(completeFigureRegion(region,[],[],1000,1500),region);
});
