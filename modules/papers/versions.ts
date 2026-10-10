import type {Paper,PaperMaterial,PaperDigest,PaperIllustrationState,PaperReadingTask} from './types.ts';
export interface VersionSnapshot {
  paper:Paper;material:PaperMaterial|null;digest:PaperDigest|null;
  presentation:{title_zh:string;summary_zh:string;status:string;source_signature:string}|null;
  illustrations:PaperIllustrationState|null;task:PaperReadingTask|null;
}
export interface PaperVersion {
  id:string;label:string;kind:'preprint'|'published'|'uploaded';source_url:string;pdf_url:string;pdf_sha256:string|null;
  has_pdf:boolean;is_current:boolean;has_reading:boolean;created_at:string;
}
