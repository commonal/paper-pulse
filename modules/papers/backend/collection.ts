import {z} from 'zod';
import {sql,type Db} from '@aihot/backend/db';
import {collectionInput} from '../collection.ts';
import type {Paper,PaperCollection,PaperMetadata} from '../types.ts';
import {enqueuePaperMaterial} from './queue.ts';
import {paperById} from './store.ts';
import {matchCcfAVenue} from './ccf-venues.ts';
import type {ImpactCandidate} from '../impact.ts';

export async function saveCollection(id:string,input:z.infer<typeof collectionInput>,db:Db){
  const [paper]=await db`SELECT id FROM papers WHERE id=${id} FOR UPDATE`;
  if(!paper)throw Object.assign(new Error('论文不存在'),{statusCode:400});
  await db`INSERT INTO paper_collection(paper_id,pinned,tags,directions,reason)
    VALUES(${id},${input.pinned??false},${[...new Set(input.tags??[])]},${[...new Set(input.directions??[])]},${input.reason??''})
    ON CONFLICT(paper_id) DO UPDATE SET pinned=CASE WHEN ${input.pinned!==undefined} THEN EXCLUDED.pinned ELSE paper_collection.pinned END,
      tags=CASE WHEN ${input.tags!==undefined} THEN EXCLUDED.tags ELSE paper_collection.tags END,
      directions=CASE WHEN ${input.directions!==undefined} THEN EXCLUDED.directions ELSE paper_collection.directions END,
      reason=CASE WHEN ${input.reason!==undefined} THEN EXCLUDED.reason ELSE paper_collection.reason END`;
  if(input.read){
    const [state]=await db`SELECT d.status AS digest_status,t.status AS reading_status FROM papers p
      LEFT JOIN paper_digests d ON d.paper_id=p.id LEFT JOIN paper_reading_tasks t ON t.paper_id=p.id WHERE p.id=${id}`;
    if(input.versionId){const [p]=await db`SELECT active_version_id FROM papers WHERE id=${id}`;
      if(p.active_version_id!==input.versionId)throw Object.assign(new Error('当前原文已改变，请刷新后再启动精读'),{code:'conflict'});}
    if(state?.digest_status!=='ready'&&!['queued','running','waiting'].includes(state?.reading_status))await enqueuePaperMaterial(id,db,input.versionId);
  }
}
export async function collectPaper(id:string,input:unknown){
  const parsed=collectionInput.parse(input);
  await sql.begin(tx=>saveCollection(id,parsed,tx));
  return paperById(id);
}
export async function removeCollection(id:string){await sql`DELETE FROM paper_collection WHERE paper_id=${id}`;}
export async function withPaperMetadata<T extends Paper>(papers:T[]):Promise<T[]>{
  if(!papers.length)return papers;
  const rows=await sql<{id:string;doi:string|null;active_version_id:string|null;metadata:PaperMetadata;collection:PaperCollection|null;impact:ImpactCandidate|null}[]>`
    SELECT p.id,p.doi,p.active_version_id,p.metadata,to_jsonb(c)-'paper_id' AS collection,to_jsonb(i) AS impact FROM papers p LEFT JOIN paper_collection c ON c.paper_id=p.id
    LEFT JOIN LATERAL (SELECT * FROM paper_impact_candidates WHERE paper_id=p.id ORDER BY fetched_at DESC LIMIT 1) i ON true
    WHERE p.id IN ${sql(papers.map(p=>p.id))}`;
  const byId=new Map(rows.map(({impact,...row})=>[row.id,impact&&matchCcfAVenue(impact.venue_name)?{...row,doi:row.doi||impact.doi,
    metadata:{...row.metadata,source:'openalex' as const,openalex_id:impact.openalex_id,publication_year:impact.publication_year,
      date_precision:'year' as const,venue_name:impact.venue_name,venue_verification:'source_matched' as const,ccf_rank:'A' as const,
      ccf_catalog:'CCF 2022（2024 名称更新）',citation_count:impact.citation_count,citation_updated_at:impact.fetched_at}}:row]));
  return papers.map(p=>({...p,...byId.get(p.id)}));
}
