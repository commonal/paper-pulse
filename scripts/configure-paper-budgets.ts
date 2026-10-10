import {sql,closeDb} from '@aihot/backend/db';

// Explicit operator action; never run as a migration or during page reads.
try{
  if(!process.argv.includes('--apply'))throw new Error('显式使用 --apply 设置模型保护上限为 4/分钟、24/小时、60/滚动24小时。');
  const result=await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext('budget:llm'))`;
    const before=await tx`SELECT service,per_minute,per_hour,per_day FROM budgets WHERE service='llm'`;
    const [after]=await tx`INSERT INTO budgets(service,per_minute,per_hour,per_day,note)
      VALUES('llm',4,24,60,'论文日更与手动验证共享：异常请求熔断，不作为正常日更配额')
      ON CONFLICT(service) DO UPDATE SET per_minute=4,per_hour=24,per_day=60,note=EXCLUDED.note RETURNING service,per_minute,per_hour,per_day`;
    return {before,after};
  });
  console.log(JSON.stringify(result));
}finally{await closeDb();}
