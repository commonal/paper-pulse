// Jina Reader: use the configured key first, anonymous reading when absent or clearly depleted.
// Both modes use the egress guard, receipts and the same request budget (any zero stops the service).
import { credential } from "../config.ts";
import { sql } from '../db.ts';
import {sha256} from '../lib/ids.ts';
import { guardedFetch } from "../lib/http-fetch.ts";
import { assertAccepted, paidRequest,logicalKeyFor,ProviderRejectedError,ReceiptUnknownError,ReceiptBusyError } from "./receipts.ts";

/** Jina's answer starts with header lines (Title, URL Source, Published Time); the page follows this line. */
const CONTENT = "\nMarkdown Content:\n";

/**
 * Reads a page through Jina: `raw` is the whole answer, `markdown` the page after its header lines.
 * The receipt key is the target URL plus the day, so a same-day retry of an article's body or detail
 * reuses it. A listing is read afresh on every fetch (`perRead`): with the day key every later fetch saw
 * the morning's page. Each such read has a receipt of its own, so after one whose outcome is unknown the
 * next fetch pays for a new read instead of waiting on it.
 */
export async function jinaRead(
  targetUrl: string,
  opts: { purpose: string; subject: string; format?: "markdown" | "html"; cacheToleranceSeconds?: number; perRead?: boolean },
): Promise<{ markdown: string; raw: string; receiptId: number }> {
  const key = credential("collectors", "JINA_API_KEY");
  const base = (credential("collectors", "JINA_BASE_URL") ?? "https://r.jina.ai").replace(/\/$/, "");
  // A listing whose freshness matters (xAI news) caps how old Jina's cached rendering may be.
  const tolerance: Record<string, string> = Number.isInteger(opts.cacheToleranceSeconds) && opts.cacheToleranceSeconds! >= 0 ? { "x-cache-tolerance": String(opts.cacheToleranceSeconds) } : {};
  const now = new Date().toISOString();
  const day = opts.perRead ? now : now.slice(0, 10);
  const requestFor=(authenticated:boolean)=>({service:'jina',model:null,purpose:opts.purpose,subject:opts.subject,
    identity:{url:targetUrl,day,format:opts.format??'markdown',base,authMode:authenticated?'key':'anonymous',...(authenticated?{keyFingerprint:sha256(key!)}:{})},
    requestSummary:{url:targetUrl,readWindow:day,authMode:authenticated?'key':'anonymous'}});
  // Removing/changing a key must not turn an in-flight or unknown result into a different anonymous purchase.
  const [unsettled]=await sql<{id:number;status:string}[]>`SELECT id,status FROM receipts WHERE service='jina' AND purpose=${opts.purpose}
    AND request->>'url'=${targetUrl} AND coalesce(request->>'readWindow',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD'))=${day}
    AND status IN ('pending','unknown') ORDER BY id LIMIT 1`;
  if(unsettled?.status==='unknown')throw new ReceiptUnknownError(unsettled.id,'Jina reading outcome unknown; waiting for receipt recovery');
  if(unsettled)throw new ReceiptBusyError('Jina reading is already in flight');
  const read=(authenticated:boolean)=>paidRequest(
    requestFor(authenticated),
    async () => {
      const res = await guardedFetch(`${base}/${targetUrl}`, {
        headers: { ...(authenticated?{authorization:`Bearer ${key}`}:{ }), "x-return-format": opts.format ?? "markdown", accept: "text/plain", ...tolerance },
        timeoutMs: 60_000,
        maxBytes: 6 * 1024 * 1024,
      });
      const text = res.text();
      if(authenticated&&(res.status===401||res.status===402))throw new ProviderRejectedError(`jina key unavailable HTTP ${res.status}`,res.status,false);
      // A provider error can echo the credential: never put that credential into persisted error text.
      assertAccepted("jina", res.status, key?text.replaceAll(key,'<REDACTED>'):text);
      // Billed in tokens; estimated at about ¥0.36 per million. Without the usage header nothing is guessed.
      const tokens = Number(res.headers.get("x-usage-tokens")) || null;
      const cost = authenticated&&tokens ? { amount: (tokens / 1e6) * 0.36, currency: "CNY", basis: "estimated" as const } : null;
      return { response: { text: text.slice(0, 2_000_000), status: res.status }, requestId: res.headers.get("x-request-id"), usage: { bytes: res.body.length, tokens,authMode:authenticated?'key':'anonymous' }, cost };
    },
  );
  let receipt;
  if(key){
    const [refusal]=await sql`SELECT error FROM receipts WHERE logical_key=${logicalKeyFor(requestFor(true))} AND status='failed'`;
    if(/^jina key unavailable HTTP (401|402)$/.test(refusal?.error??''))receipt=await read(false);
    else try{receipt=await read(true);}catch(error){
      if(!(error instanceof ProviderRejectedError)||!/^jina key unavailable HTTP (401|402)$/.test(error.message))throw error;
      receipt=await read(false);
    }
  }else receipt=await read(false);
  const raw = String((receipt.response as { text?: string })?.text ?? "");
  const at = raw.indexOf(CONTENT);
  return { markdown: (at < 0 ? raw : raw.slice(at + CONTENT.length)).trim(), raw, receiptId: receipt.receiptId };
}
