import {z} from 'zod';
import {DIRECTIONS} from './directions.ts';
export const collectionInput=z.object({pinned:z.boolean().optional(),tags:z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  directions:z.array(z.enum(DIRECTIONS.map(d=>d.id) as [string,...string[]])).max(8).optional(),reason:z.string().trim().max(1000).optional(),read:z.boolean().default(false),versionId:z.uuid().optional()});
