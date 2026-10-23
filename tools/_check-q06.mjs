import { dryRun } from '../core/dryrun/dry-run.mjs';
const mod=await import('../tests/real-exam/q06.mjs');
const res=await dryRun({slots:mod.default.slots,entry:'q06',meta:{mode:'NUMERIC'}});
const r=res.report;
console.log('verdict',r.verdict,'frames',r.execution.frameCount);
for(const c of r.checks??[]){ if(c.status!=='pass') console.log(c.id,c.status,JSON.stringify(c.offenders??[]).slice(0,600)); }
