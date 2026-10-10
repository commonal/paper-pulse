export interface Paper {
  active_version_id?:string|null;readable_version_id?:string|null;
  doi?:string|null; metadata?:PaperMetadata; collection?:PaperCollection|null;
  id: string; title: string; authors: string; published: string; topic: string;
  title_zh?: string | null; summary_zh?: string | null; presentation_status?: PaperDigestStatus;
  abstract: string; source_url: string; pdf_url: string; code_url: string;
  arxiv_id?: string | null; version: string; status: "unread" | "reading" | "done"; has_pdf: boolean;
  pdf_sha256: string | null; created_at: string; note_count?: number; parse_status?: PaperParseStatus; digest_status?: PaperDigestStatus;
  reading_status?: ReadingStatus; reading_stage?: ReadingStage;
  reading_error?:string|null;reading_updated_at?:string|null;reading_wait?:ReadingWaitInfo|null;
}
export interface PaperMetadata {
  source?:'manual'|'openalex'|'crossref'|'arxiv'|'pdf'; publication_year?:number|null; date_precision?:'day'|'year'|'unknown';
  identity_status?:'matched'|'record_found'|'user_confirmed'|'unverified'|'user_modified';identity_checks?:string[];identity_checked_at?:string;
  metadata_source_url?:string;
  venue_name?:string; venue_verification?:'source_matched'; ccf_rank?:'A'; ccf_catalog?:string;
  openalex_id?:string; citation_count?:number|null; citation_updated_at?:string;
}
export interface PaperCollection {saved_at:string;pinned:boolean;tags:string[];directions:string[];reason:string}
export interface Note {
  anchor?:NoteAnchor|null;
  id: string; paper_id: string; title: string; markdown: string; html: string;
  page: number | null; version: string; pdf_sha256: string | null;
  revision: number; updated_at: string;
}
export interface NoteContext {versionId:string;readingSignature:string;receiptId:number|null}
export interface NoteAnchor {
  kind:'paper'|'claim'|'figure';versionId:string;readingSignature:string;receiptId:number|null;
  targetId?:string;sectionId?:string;label:string;excerpt:string;evidenceBlockIds:string[];imageSha256?:string;
}
export interface PaperIllustration {
  input_basis?:'text'|'vision';visual_reading?:import('./backend/illustration-plan.ts').VisualReading;
  image_sha256?:string;image_pdf_sha256?:string;
  block_id: string; after_claim_id: string; title: string; explanation: string;
  selection_reason?: string; reading_guide?: string; takeaway?: string; caveat?: string;
  evidence_block_ids?: string[]; bbox?: [number, number, number, number];
}
export interface PaperIllustrationState {
  paper_id: string; status: PaperDigestStatus; input_signature: string; selections: PaperIllustration[];
  model: string; prompt_version: string; receipt_id: number | null; error: string | null; updated_at: string;
}
export interface PaperDetail { paper: Paper; notes: Note[]; material: PaperMaterial | null; digest: PaperDigest | null;
  note_context?:NoteContext|null;
  illustration_mode?:'text'|'vision';
  illustration_upgrade_available?:boolean;
  versions?:import('./versions.ts').PaperVersion[];viewing_version_id?:string|null;is_current_version?:boolean;
  illustrations?: PaperIllustration[]; illustration_status?: PaperDigestStatus; illustration_error?: string | null; reading_task?: PaperReadingTask | null }

export type ReadingStage = "material" | "coverage" | "reading" | "review" | "illustrations" | "complete";
export type ReadingStatus = "queued" | "running" | "waiting" | "failed" | "ready" | "unavailable";
export interface DailyReadingStatus {
  date:string;enabled:boolean;activePlans:number;dailyLimit:number;time:string;timezone:string;nextRunAt:string|null;
  lastRun:{started_at:string;finished_at:string|null;status:'running'|'ok'|'failed'|'skipped'}|null;
  lastSuccessAt:string|null;
  exclusions?:{paperId:string;title:string;reason:string;removedAt:string}[];
  discovery?:{status:'waiting'|'failed'|'complete';nextRetryAt:string|null;readyPlans:number;pendingPlans:number;failedPlans:number;errors:string[]};
  counts:{selected:number;readable:number;completed:number;processing:number;waiting:number;failed:number;notStarted:number;budgetWaiting:number};
  state:'disabled'|'paused'|'scheduled'|'overdue'|'discovering'|'discovery_failed'|'discovery_waiting'|'empty'|'processing'|'waiting'|'incomplete'|'ready';
}
export interface ReadingOptions {
  daily?:boolean;
  evaluationSampleId?:string;
  reviewRepair?:import('./review.ts').ReviewRepair;
  versionId?:string;
  reread?: boolean;
  visualNotes?: { blockId: string; page: number; pdfSha256: string; text: string }[];
  reviewCorrections?: { receiptId: number; changes: { claimId: string; reason: string; claim?: { text: string; evidence_block_ids: string[] }; quotes: { block_id: string; quote: string }[] }[] };
}
export interface PaperReadingTask {
  paper_id: string; run_id: string; status: ReadingStatus; stage: ReadingStage; options: ReadingOptions;
  coverage: (Record<string, unknown>&{visualBodyReview?:import('./backend/visual-body.ts').VisualBodyState}) | null; receipt_id: number | null; error: string | null; updated_at: string;
  wait?:ReadingWaitInfo|null;
}
export interface RequestBudgetSnapshot {
  service:string;windows:{name:'minute'|'hour'|'day';label:string;used:number;limit:number}[];
  blocked:boolean;stopped:boolean;nextAvailableAt:string|null;
}
export interface ReadingWaitInfo {
  kind:'budget'|'model_disabled'|'receipt_unknown'|'receipt_busy'|'interrupted';
  title:string;detail:string;nextRetryAt:string|null;budget?:RequestBudgetSnapshot;
}

export type PaperParseStatus = "queued" | "parsing" | "ready" | "failed" | "unavailable";
export type PaperDigestStatus = "queued" | "generating" | "ready" | "failed" | "unavailable";
export type PaperBlockKind = "heading" | "text" | "formula" | "table" | "figure" | "caption";
export interface PaperBlock {
  id: string;
  kind: PaperBlockKind;
  text: string;
  section_path: string[];
  locator: string;
  page?: number;
  bbox?: [number, number, number, number];
  caption?: string;
  latex?: string;
  table_html?: string;
  image_path?: string;
}
export interface PaperMaterial { paper_id: string; status: PaperParseStatus; parser: string; markdown: string; blocks: PaperBlock[]; error: string | null; receipt_id: number | null; updated_at: string }
export type PaperDigestSupport = "direct" | "synthesis" | "not_stated";
export interface PaperDigestClaim { id: string; text: string; support: PaperDigestSupport; evidence_block_ids: string[] }
export interface PaperDigestSection { id: string; title: string; claims: PaperDigestClaim[] }
export interface PaperDigest {
  paper_id: string; status: PaperDigestStatus; model: string; prompt_version: string;
  sections: PaperDigestSection[]; material_updated_at: string | null; receipt_id: number | null;
  error: string | null; updated_at: string;
}

export interface PaperSourcePreview {
  source_url: string;
  pdf_url: string;
  title: string;
  authors: string;
  published: string;
  abstract: string;
  version: string;
  source_kind: "arxiv"|'crossref'|'pdf'|'existing';
}
