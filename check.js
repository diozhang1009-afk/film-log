const fs=require('fs');
const src=fs.readFileSync('app.js','utf8');
const seedArr=eval('('+src.match(/function seed\(\)\{\s*return (\[[\s\S]*?\]);\n\}/)[1]+')');
const ALIASES=eval('('+src.match(/const ALIASES = (\{[\s\S]*?\});/)[1]+')');
const FUNC_KEYWORDS=eval('('+src.match(/const FUNC_KEYWORDS = (\[[^\]]*\]);/)[1]+')');
const FUNC_RE=eval('('+src.match(/const FUNC_RE = ([^;]*);/)[1]+')');
function stripFuncReal(name){ if(!name) return name; const mm=String(name).match(FUNC_RE); if(!mm) return name; const L=mm[1].trim(),R=mm[2].trim(); if(!L||!R) return (L||R||name); if(FUNC_KEYWORDS.some(k=>R.includes(k))) return L; if(!/[a-zA-Z0-9]/.test(R)&&R.length<=8) return L; return name; }
const canon=n=>(n==null)?n:(ALIASES[(''+n).trim()]||(''+n).trim());
/* 占位名：按最新口径，「xx朋友」类昵称按表格如实计入，不再排除；仅过滤空名 */
function isPhantom(name){ const n=(name==null?'':(''+name).trim()); return !n; }
function realPeople(p){ return (p||[]).filter(x=>!isPhantom(x)).map(x=>canon(stripFuncReal(x))).filter(Boolean); }
let shows=0,zero=0,watched=0,total=0; const uniq=new Set(); const c={}; const byM={}; let blaze=new Set();
for(const f of seedArr){ const ws=f.watches||[]; if(ws.length)watched++; for(const w of ws){ shows++; const p=w.people||[]; if(p.length===0)zero++; const rp=realPeople(p); for(const n of rp){uniq.add(n);c[n]=(c[n]||0)+1;total++;} if(rp.length>8)for(const n of rp)blaze.add(n); if(w.date){const mm=w.date.slice(0,7);byM[mm]=(byM[mm]||0)+1;} } }
const club10=Object.entries(c).filter(([k,v])=>v>=10).sort((a,b)=>b[1]-a[1]);
const club20=Object.entries(c).filter(([k,v])=>v>=20).sort((a,b)=>b[1]-a[1]);
console.log('==== 录入后权威基线 ====');
console.log('影片总数:',seedArr.length,'| 已放映:',watched,'| 0人空场:',zero,'| 总场数:',shows);
console.log('累计人次(归一,含xx朋友):',total,'| 唯一观影者:',uniq.size);
console.log('club10:',club10.length,'| club20:',club20.length,'->',club20.map(x=>x[0]+'('+x[1]+')').join(', '));
console.log('blaze:',blaze.size);
console.log('9月(2026-09)场数:',byM['2026-09']);
const sep=new Set(); for(const f of seedArr)for(const w of (f.watches||[]))if(w.date&&w.date.startsWith('2026-09'))for(const n of realPeople(w.people))sep.add(n);
console.log('9月参与观影者(归一,含xx朋友):',sep.size,'人');
console.log('新片118-123:', seedArr.filter(f=>f.id>=118).map(f=>f.id+':'+(f.watches||[]).reduce((a,w)=>a+realPeople(w.people).length,0)+'人').join(' '));
console.log('火冋火冋 总场:',c['火冋火冋'],'| 子衿 总场:',c['子衿'],'| 一一 总场:',c['一一'],'| 安静电影型17 总场:',c['安静电影型17']);
