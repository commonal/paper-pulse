import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { credential } from "@aihot/backend/config";
import { sql } from "@aihot/backend/db";
import { assertAccepted, completeReceipt, paidRequest, ProviderRejectedError, rejectReceivedResponse } from "@aihot/backend/providers/receipts";
import type { PaperBlock } from "../types.ts";

export class MineruApiError extends Error {
  constructor(message: string) { super(message); this.name = "MineruApiError"; }
}

type MineruOptions = {
  pdf: Buffer;
  sourceId: string;
  sourceUrl: string;
  fetchImpl?: typeof fetch;
};

type MineruResult = { markdown: string; blocks: PaperBlock[]; receiptId: number };

const baseUrl = () => (process.env.MINERU_API_BASE_URL || "https://mineru.net/api").replace(/\/+$/, "");
const timeoutMs = () => Math.max(30_000, Number(process.env.MINERU_TIMEOUT_SECONDS || 600) * 1000);
const pollMs = () => Math.max(0, Number(process.env.MINERU_POLL_INTERVAL_SECONDS || 2) * 1000);
const textDecoder = new TextDecoder("utf-8", { fatal: false });

function safeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result || undefined;
}

function joinedText(value: unknown): string | undefined {
  if (typeof value === "string") return safeText(value);
  if (Array.isArray(value)) return safeText(value.map((item) => String(item).trim()).filter(Boolean).join(" "));
  return undefined;
}

function box(value: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((item) => typeof item === "number" && Number.isFinite(item))) return undefined;
  return value as [number, number, number, number];
}

function itemContent(item: Record<string, unknown>, rawKind: string) {
  const caption = joinedText(item.table_caption ?? item.image_caption ?? item.chart_caption ?? item.caption);
  const tableHtml = rawKind === "table" ? safeText(item.table_body) : undefined;
  const latex = rawKind === "equation" || rawKind === "formula" ? safeText(item.text) : undefined;
  const text = rawKind === "table" ? tableHtml ?? caption
    : rawKind === "image" || rawKind === "figure" || rawKind === "chart" ? safeText(item.content) ?? caption
      : safeText(item.text) ?? safeText(item.content) ?? caption;
  return { caption, tableHtml, latex, text };
}

function normalizedKind(rawKind: string): PaperBlock["kind"] {
  if (rawKind === "title" || rawKind === "heading") return "heading";
  if (rawKind === "equation" || rawKind === "formula") return "formula";
  if (rawKind === "table") return "table";
  if (rawKind === "image" || rawKind === "figure" || rawKind === "chart") return "figure";
  if (rawKind.includes("caption")) return "caption";
  return "text";
}

function findAsset(entries: Record<string, Uint8Array>, value: unknown): string | undefined {
  const raw = safeText(value);
  if (!raw || raw.startsWith("/") || raw.split("/").some((part) => part === ".." || part === "." || !part)) return undefined;
  const normalized = raw.replaceAll("\\", "/");
  const exact = Object.keys(entries).find((name) => name === normalized || name.endsWith(`/${normalized}`));
  if (exact && exact.split("/").includes("images")) return exact;
  const basename = normalized.split("/").at(-1);
  return basename ? Object.keys(entries).find((name) => name.split("/").at(-1) === basename && name.split("/").includes("images")) : undefined;
}

export function normalizeMineruContent(payload: unknown, sourceId: string, entries: Record<string, Uint8Array>): PaperBlock[] {
  const items: Array<{ page: number; index: number; item: Record<string, unknown> }> = [];
  if (!Array.isArray(payload)) return [];
  payload.forEach((value, outerIndex) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const item = value as Record<string, unknown>;
      items.push({ page: (Number(item.page_idx) || 0) + 1, index: outerIndex, item });
    } else if (Array.isArray(value)) {
      value.forEach((child, innerIndex) => {
        if (child && typeof child === "object" && !Array.isArray(child)) items.push({ page: outerIndex + 1, index: innerIndex, item: child as Record<string, unknown> });
      });
    }
  });
  let sectionPath: string[] = [];
  return items.flatMap(({ page, index, item }) => {
    const rawKind = String(item.type || "text").toLowerCase();
    const { caption, tableHtml, latex, text } = itemContent(item, rawKind);
    if (!text) return [];
    const kind = rawKind === "text" && Number(item.text_level) > 0 ? "heading" : normalizedKind(rawKind);
    if (kind === "heading") sectionPath = [text];
    const bbox = box(item.bbox);
    const imagePath = findAsset(entries, item.img_path);
    const identity = JSON.stringify([sourceId, page, index, rawKind, bbox, text]);
    const id = `mineru-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
    return [{ id, kind, text, section_path: [...sectionPath], locator: `mineru:content_list.json#/${index}`, page, ...(bbox ? { bbox } : {}), ...(caption ? { caption } : {}), ...(latex ? { latex } : {}), ...(tableHtml ? { table_html: tableHtml } : {}), ...(imagePath ? { image_path: imagePath } : {}) } satisfies PaperBlock];
  });
}

function apiData(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") throw new MineruApiError("MinerU 返回了无效响应");
  const body = payload as Record<string, unknown>;
  if (body.code !== undefined && body.code !== 0 && body.code !== "0") throw new ProviderRejectedError(`MinerU: ${String(body.msg ?? body.message ?? body.code)}`, null, false);
  if (!body.data || typeof body.data !== "object") throw new MineruApiError("MinerU 返回缺少 data");
  return body.data as Record<string, unknown>;
}

async function json(response: Response): Promise<unknown> {
  if (!response.ok) assertAccepted("mineru", response.status, await response.text());
  try { return await response.json(); } catch { throw new MineruApiError("MinerU 返回了不可解析的 JSON"); }
}

export async function parsePdfWithMineru(options: MineruOptions): Promise<MineruResult> {
  const token = credential("integrations", "MINERU_API_TOKEN");
  if (!token) throw new MineruApiError("MINERU_API_TOKEN 未配置");
  const request = options.fetchImpl ?? fetch;
  const filename = `paper-${options.sourceId}.pdf`;
  const pdfHash = createHash("sha256").update(options.pdf).digest("hex");
  // MinerU is paid or credit-limited. Default to a stopped budget; only an explicit admin limit enables it.
  await sql`INSERT INTO budgets (service, per_minute, per_hour, per_day, note)
    VALUES ('mineru', 0, 0, 0, 'MinerU 论文解析：默认熔断，配置预算后启用') ON CONFLICT (service) DO NOTHING`;
  const headers = { Authorization: `Bearer ${token}` };
  const receipt = await paidRequest({
    service: "mineru", model: process.env.MINERU_MODEL_VERSION || "vlm", purpose: "paper_material",
    subject: `paper:${options.sourceId}`,
    identity: { sourceId: options.sourceId, sourceUrl: options.sourceUrl, pdfHash, modelVersion: process.env.MINERU_MODEL_VERSION || "vlm", language: process.env.MINERU_LANGUAGE || "ch" },
    requestSummary: { sourceId: options.sourceId, pdfHash, pdfBytes: options.pdf.length, modelVersion: process.env.MINERU_MODEL_VERSION || "vlm" },
  }, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs());
    try {
      const uploadResponse = await request(`${baseUrl()}/v4/file-urls/batch`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({
        files: [{ name: filename, data_id: pdfHash.slice(0, 16) }],
        model_version: process.env.MINERU_MODEL_VERSION || "vlm", enable_formula: true, enable_table: true, language: process.env.MINERU_LANGUAGE || "ch",
      }), signal: controller.signal });
      const uploadData = apiData(await json(uploadResponse));
      const batchId = String(uploadData.batch_id ?? "");
      const urls = Array.isArray(uploadData.file_urls) ? uploadData.file_urls : [];
      const uploadUrl = String(urls[0] ?? "");
      if (!batchId || !uploadUrl) throw new MineruApiError("MinerU 未返回上传地址");
      const uploadBody = new Uint8Array(new ArrayBuffer(options.pdf.byteLength));
      uploadBody.set(options.pdf);
      const putResponse = await request(uploadUrl, { method: "PUT", body: uploadBody, signal: controller.signal });
      if (!putResponse.ok) assertAccepted("mineru-upload", putResponse.status, await putResponse.text());
      let archiveUrl = "";
      const deadline = Date.now() + timeoutMs();
      while (Date.now() < deadline) {
        const pollResponse = await request(`${baseUrl()}/v4/extract-results/batch/${encodeURIComponent(batchId)}`, { headers, signal: controller.signal });
        const data = apiData(await json(pollResponse));
        const jobs = Array.isArray(data.extract_result) ? data.extract_result as Array<Record<string, unknown>> : [];
        const job = jobs.find((item) => item.file_name === filename) ?? jobs[0];
        const state = String(job?.state ?? "").toLowerCase();
        if (state === "done" && job?.full_zip_url) { archiveUrl = String(job.full_zip_url); break; }
        if (state === "failed") throw new MineruApiError(`MinerU 解析失败：${String(job.err_msg ?? "未知错误")}`);
        await new Promise((resolve) => setTimeout(resolve, pollMs()));
      }
      if (!archiveUrl) throw new MineruApiError("MinerU 解析超时");
      const archiveResponse = await request(archiveUrl, { signal: controller.signal });
      if (!archiveResponse.ok) assertAccepted("mineru", archiveResponse.status, await archiveResponse.text());
      const archiveBytes = Buffer.from(await archiveResponse.arrayBuffer());
      if (archiveBytes.length > 30 * 1024 * 1024) throw new MineruApiError("MinerU 结果 ZIP 超过 30 MB 上限");
      const archive = unzipSync(new Uint8Array(archiveBytes));
      const contentName = Object.keys(archive).find((name) => name.endsWith("_content_list.json"));
      const markdownName = Object.keys(archive).find((name) => name.split("/").at(-1) === "full.md") ?? Object.keys(archive).find((name) => name.toLowerCase().endsWith(".md"));
      if (!contentName || !markdownName) throw new MineruApiError("MinerU 结果缺少 full.md 或 content_list.json");
      const markdown = textDecoder.decode(archive[markdownName]).trim();
      if (!markdown) throw new MineruApiError("MinerU 返回了空的 full.md");
      const contentList = textDecoder.decode(archive[contentName]);
      JSON.parse(contentList);
      // Store only the text/structure needed to recover this parse. Image binaries are not used by the reader.
      const assets = Object.keys(archive).filter((name) => name.split("/").includes("images"));
      return { response: { markdown, contentList, assets, batchId }, requestId: batchId,
        usage: { pdfBytes: options.pdf.length, archiveBytes: archiveBytes.length } };
    } finally { clearTimeout(timer); }
  });
  try {
    const saved = receipt.response as { markdown?: unknown; contentList?: unknown; assets?: unknown } | null;
    if (typeof saved?.markdown !== "string" || typeof saved.contentList !== "string" || saved.contentList.length > 24 * 1024 * 1024) {
      throw new MineruApiError("MinerU 回执缺少可用正文结果");
    }
    const content = JSON.parse(saved.contentList) as unknown;
    const archive = Object.fromEntries((Array.isArray(saved.assets) ? saved.assets : []).filter((name): name is string => typeof name === "string").map((name) => [name, new Uint8Array()])) as Record<string, Uint8Array>;
    const markdown = saved.markdown;
    const blocks = normalizeMineruContent(content, options.sourceId, archive);
    if (!blocks.length) throw new MineruApiError("MinerU 未返回可用正文块");
    await completeReceipt(sql, receipt.receiptId);
    return { markdown, blocks, receiptId: receipt.receiptId };
  } catch (error) {
    await rejectReceivedResponse(receipt.receiptId, `invalid MinerU result: ${String(error).slice(0, 500)}`);
    if (error instanceof MineruApiError) throw error;
    throw new MineruApiError(error instanceof Error ? error.message.slice(0, 300) : "MinerU 解析失败");
  }
}
