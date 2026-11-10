/* =========================================================
   film-log 每周自动同步（Node ≥18，零依赖）
   用法: node tools/auto_sync.js [repoRoot]
   repoRoot 默认为本脚本上级目录（即仓库根，含 app.js / check.js）。

   流程:
     1. 取数: config.apiUrl 有值则 fetch（并把快照写回 data/）；
        否则读本地快照 data/nbquiet_movies_all.json（UTF-8 带 BOM）。
     2. 解析 status=done、场次日期(UTC+8) ≤ 今天的记录，与 app.js 内 seed() 对账
        （键 = 日期|片名，片名先过 FIX 错字映射）。
     3. 全部新增场次可确定（影片已在库 且 参与者昵称全部已知）
           → 追加场次 + 升版本号 + node check.js + commit + push = 自动发布。
        存在不确定（新片名 / 新昵称 / 0 人场）
           → 不改任何文件，写 PENDING_REVIEW.md + data/auto_sync_pending.json，
             等用户确认后人工（或新窗口）执行 data/auto_sync_pending.json 的补丁。
     4. 任何异常（网络/解析/git）→ exit 1，
        由 auto_sync_run.ps1 链式安排 retryHours 小时后重试，直到成功。

   确定性判定（用户 2026-11-10 口径）:
     - 片名错别字直接归入正确片名（FIX 表）；
     - 同片异名按豆瓣口径（已并入 FIX / seed 现名）；
     - 新昵称若命中 ALIASES 键或「已知名 + 的朋友」模式则视为已知；
     - 同日同片多场且名单不同 → 各自成场（合法）；完全相同名单 → 视为重复跳过。
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'auto_sync.config.json'), 'utf8'));

/* 接口片名 → 站内片名（错别字/旧译名；豆瓣口径改名后站内已是正确名） */
const FIX = {
  '碟影重重': '谍影重重',
  '惠子 凝视': '惠子，凝视',
  'EVA终': '新·福音战士剧场版：终',
  'EVA剧场版终': '新·福音战士剧场版：终'
};

function die(msg) { console.error('[auto_sync] FAIL: ' + msg); process.exit(1); }
function log(msg) { console.log('[auto_sync] ' + msg); }

function localDateStr(d, offH) {
  return new Date(d.getTime() + offH * 3600e3).toISOString().slice(0, 10);
}

/* ---------- 1. 取数 ---------- */
/* 接口: GET {apiUrl}，apiUrl 含 {month} 占位符 → 按 YYYY-MM 逐月拉取；
   返回 {movies:[...], serverTime}，整月数据（可能含上月末尾几天补日历，按 id 去重）。 */
async function fetchMonth(month) {
  const url = CFG.apiUrl.replace('{month}', month);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60000);
  let res;
  try {
    res = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'film-log-auto-sync' } });
  } finally { clearTimeout(t); }
  if (!res.ok) throw new Error('HTTP ' + res.status + ' @ ' + url);
  const j = JSON.parse((await res.text()).replace(/^\uFEFF/, ''));
  const arr = Array.isArray(j) ? j : (j.movies || []);
  log('fetch ' + month + ': ' + arr.length + ' 条 (' + url + ')');
  return arr;
}

async function fetchData() {
  const snapPath = path.join(REPO, CFG.snapshot);
  if (!CFG.apiUrl) {
    if (!fs.existsSync(snapPath)) throw new Error('未配置 apiUrl 且本地快照不存在: ' + CFG.snapshot);
    const arr = JSON.parse(fs.readFileSync(snapPath, 'utf8').replace(/^\uFEFF/, ''));
    log('使用本地快照: ' + CFG.snapshot + '（' + arr.length + ' 条，未配置 apiUrl）');
    return { fresh: arr, months: [] };
  }

  /* 需要拉取的月份：当月 及 前 (monthsBack-1) 个月 */
  const offH = CFG.timezoneOffsetHours || 8;
  const nowLocal = new Date(Date.now() + offH * 3600e3);
  const months = [];
  for (let i = 0; i < (CFG.monthsBack || 2); i++) {
    const d = new Date(Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }

  const byId = new Map();
  for (const m of months) {
    for (const r of await fetchMonth(m)) if (r && r.id) byId.set(r.id, r);
  }
  const fresh = [...byId.values()];
  log('本次拉取去重后: ' + fresh.length + ' 场（月份: ' + months.join(', ') + '）');

  /* 快照按 id 累积（保留历史月份，供离线复现） */
  const snap = new Map();
  if (fs.existsSync(snapPath)) {
    try {
      const old = JSON.parse(fs.readFileSync(snapPath, 'utf8').replace(/^\uFEFF/, ''));
      for (const r of (Array.isArray(old) ? old : (old.movies || []))) if (r && r.id) snap.set(r.id, r);
    } catch (e) { log('旧快照解析失败，忽略: ' + e.message); }
  }
  for (const r of fresh) snap.set(r.id, r);
  fs.mkdirSync(path.dirname(snapPath), { recursive: true });
  fs.writeFileSync(snapPath, JSON.stringify([...snap.values()], null, 2), 'utf8');
  log('快照已更新: ' + CFG.snapshot + '（累计 ' + snap.size + ' 条）');
  return { fresh, months };
}

/* ---------- 2. 解析 app.js ---------- */
function extractSeed(appJs) {
  const a = appJs.indexOf('function seed(){');
  const b = appJs.indexOf('];\n}', a);
  if (a < 0 || b < 0) throw new Error('app.js 中未找到 seed() 数组');
  return { arr: JSON.parse(appJs.slice(appJs.indexOf('[', a), b + 1)), start: a, end: b + 4 };
}
function extractAliases(appJs) {
  const m = appJs.match(/const ALIASES = \{([\s\S]*?)\};/);
  const map = new Map();
  if (m) for (const mm of m[1].matchAll(/'((?:[^'\\]|\\.)+)'\s*:\s*'((?:[^'\\]|\\.)+)'/g)) map.set(mm[1], mm[2]);
  return map;
}
function canon(name, AL) {
  const n = String(name || '').trim();
  return AL.get(n) || n;
}

/* ---------- 3. 对账 ---------- */
function main() {
  fetchData().then(({ fresh: records, months }) => {
    const appJsPath = path.join(REPO, 'app.js');
    const appJs = fs.readFileSync(appJsPath, 'utf8');
    const { arr: seed, start, end } = extractSeed(appJs);
    const AL = extractAliases(appJs);
    const offH = CFG.timezoneOffsetHours || 8;
    const today = localDateStr(new Date(), offH);

    /* 已有场次键 与 已知人群 */
    const watchKeys = new Set();
    const seedByKey = new Map();
    const knownPeople = new Set();
    for (const f of seed) for (const w of (f.watches || [])) {
      const k = w.date + '|' + f.title;
      watchKeys.add(k);
      seedByKey.set(k, new Set((w.people || []).map(p => canon(p, AL))));
      for (const p of w.people || []) knownPeople.add(canon(p, AL));
    }

    /* 接口已完成、日期 ≤ 今天 的记录 → 候选（同时保留未开始的，仅用于统计） */
    const sessions = [];
    const apiByKey = new Map();
    let apiMin = null, apiMax = null;
    for (const r of records) {
      if (!r || !r.startTime) continue;
      const date = localDateStr(new Date(r.startTime), offH);
      apiMin = (!apiMin || date < apiMin) ? date : apiMin;
      apiMax = (!apiMax || date > apiMax) ? date : apiMax;
      if (r.status !== 'done') continue;
      const people = [...new Set((r.participants || []).map(p => String(p.nickname || '').trim()).filter(Boolean))];
      const s = { date, title: FIX[(r.title || '').trim()] || (r.title || '').trim(), people, year: r.year, director: r.director || '', intro: r.intro || '', apiId: r.id };
      sessions.push(s);
      const k = s.date + '|' + s.title;
      if (!apiByKey.has(k)) apiByKey.set(k, []);
      apiByKey.get(k).push(s);
    }

    /* 与 seed 对账：站内已有该日该片 → 站内为准（冲突）；接口内完全重复（同日|同片|同名单）→ 跳过 */
    const newOnes = [];
    const seenFull = new Set();
    const conflicts = [];
    for (const s of sessions) {
      const k = s.date + '|' + s.title;
      if (watchKeys.has(k)) {
        const seedSet = seedByKey.get(k);
        const apiSet = new Set(s.people.map(p => canon(p, AL)));
        const same = seedSet.size === apiSet.size && [...apiSet].every(p => seedSet.has(p));
        if (!same) conflicts.push({ date: s.date, title: s.title, seed: [...seedSet].length, api: apiSet.size, onlySeed: [...seedSet].filter(p => !apiSet.has(p)), onlyApi: [...apiSet].filter(p => !seedSet.has(p)) });
        continue;
      }
      const fk = k + '|' + [...s.people].sort().join(',');
      if (seenFull.has(fk)) { log('跳过接口重复记录: ' + fk); continue; }
      seenFull.add(fk);
      newOnes.push(s);
    }

    /* 缺失：窗口内（接口日期范围）站内有、接口无的场次 */
    const missing = [];
    if (apiMin) {
      for (const f of seed) for (const w of (f.watches || [])) {
        if (w.date < apiMin || w.date > apiMax) continue;
        if (!apiByKey.has(w.date + '|' + f.title)) missing.push({ date: w.date, title: f.title, people: (w.people || []).length });
      }
    }

    log('--- 对账 ---');
    log('接口窗口: ' + (apiMin || '-') + ' ~ ' + (apiMax || '-') + '，已完成 ' + sessions.length + ' 场，未开始 ' + (records.length - sessions.length) + ' 场');
    log('新增(接口有站内无): ' + newOnes.length + ' | 缺失(站内有接口无): ' + missing.length + ' | 冲突(同日同片名单不同): ' + conflicts.length);
    for (const c of conflicts) log('  冲突 ' + c.date + '《' + c.title + '》站内' + c.seed + '人 / 接口' + c.api + '人（以站内为准，不回改）');
    for (const m of missing) log('  缺失 ' + m.date + '《' + m.title + '》' + m.people + '人');

    if (!newOnes.length) {
      log('无新增场次（接口已完成场次已全部在库）。今天: ' + today);
      writeReport({ ranAt: new Date().toISOString(), today, apiWindow: [apiMin, apiMax], months, apiDone: sessions.length, added: 0, missing: missing.length, conflicts: conflicts.length, published: false, note: '无新增' });
      return;
    }

    /* 确定性检查 */
    const knownTitles = new Set(seed.map(f => f.title));
    const reasons = [];
    for (const s of newOnes) {
      const why = [];
      if (!knownTitles.has(s.title)) why.push('新片名《' + s.title + '》不在库中');
      const unknown = s.people.filter(p => {
        const c = canon(p, AL);
        if (knownPeople.has(c)) return false;
        const mFriend = /^(.*?的朋友)$/.exec(c);
        if (mFriend && knownPeople.has(mFriend[1].replace(/的朋友$/, ''))) return false;
        return true;
      });
      if (unknown.length) why.push('新昵称: ' + unknown.join('、'));
      if (!s.people.length) why.push('0 人空场');
      if (why.length) reasons.push({ date: s.date, title: s.title, people: s.people, reasons: why });
    }

    if (reasons.length) {
      /* 不确定 → 只写待审文件，不动数据 */
      const lines = ['# film-log 自动同步 · 待人工确认', '', '- 生成时间: ' + new Date().toLocaleString('zh-CN'),
        '- 数据源: ' + (CFG.apiUrl ? '接口 ' + CFG.apiUrl + '（月份 ' + months.join(', ') + '）' : '本地快照'),
        '- 接口窗口: ' + apiMin + ' ~ ' + apiMax + '，已完成 ' + sessions.length + ' 场',
        '- 对账: 新增 ' + newOnes.length + ' / 缺失 ' + missing.length + ' / 冲突 ' + conflicts.length,
        '', '## 本轮待确认的新场次（未录入，未发布）', ''];
      for (const r of reasons) lines.push('### ' + r.date + '《' + r.title + '》', '- 人数: ' + r.people.length + '（' + r.people.join('、') + '）', '- 原因: ' + r.reasons.join('；'), '');
      if (conflicts.length) {
        lines.push('## 冲突场次（站内为准，未回改）', '');
        for (const c of conflicts) lines.push('- ' + c.date + '《' + c.title + '》站内 ' + c.seed + ' 人 / 接口 ' + c.api + ' 人；仅接口有: ' + (c.onlyApi.join('、') || '无') + '；仅站内有: ' + (c.onlySeed.join('、') || '无'));
        lines.push('');
      }
      lines.push('## 处理方式', '', '确认无误后，在任意窗口说明「按 data/auto_sync_pending.json 录入并发布」即可。');
      fs.writeFileSync(path.join(REPO, CFG.pendingReviewFile), lines.join('\n'), 'utf8');
      fs.mkdirSync(path.dirname(path.join(REPO, CFG.pendingDataFile)), { recursive: true });
      fs.writeFileSync(path.join(REPO, CFG.pendingDataFile), JSON.stringify({ ranAt: new Date().toISOString(), months, apiWindow: [apiMin, apiMax], sessions: newOnes, uncertain: reasons, conflicts, missing }, null, 2), 'utf8');
      log('存在不确定项 ' + reasons.length + ' 条 → 已写 ' + CFG.pendingReviewFile + '，未发布（无需重试）。');
      writeReport({ ranAt: new Date().toISOString(), today, apiWindow: [apiMin, apiMax], months, apiDone: sessions.length, added: newOnes.length, missing: missing.length, conflicts: conflicts.length, uncertain: reasons.length, published: false, note: '待人工确认' });
      return;
    }

    /* 全部确定 → 追加场次 */
    const byTitle = new Map();
    for (const s of newOnes) {
      if (!byTitle.has(s.title)) byTitle.set(s.title, []);
      byTitle.get(s.title).push({ date: s.date, people: s.people });
    }
    for (const f of seed) {
      const adds = byTitle.get(f.title);
      if (!adds) continue;
      f.watches = f.watches || [];
      for (const a of adds) f.watches.push(a);
    }
    const newRegion = 'function seed(){\n  return ' + JSON.stringify(seed, null, 2) + ';\n}';
    fs.writeFileSync(appJsPath, appJs.slice(0, start) + newRegion + appJs.slice(end), 'utf8');

    /* 升版本号 */
    const ts = new Date().toISOString().replace(/[-T:]/g, '').replace('Z', '').slice(0, 14);
    const localTs = ts; // UTC 时间戳足够唯一
    for (const rel of ['build.json', 'index.html']) {
      const p = path.join(REPO, rel);
      const src = fs.readFileSync(p, 'utf8');
      if (!/2026\d{10}/.test(src)) throw new Error(rel + ' 未找到旧版本号');
      fs.writeFileSync(p, src.replace(/2026\d{10}/g, localTs), 'utf8');
    }

    /* 校验 + 发布 */
    execFileSync('node', ['--check', 'app.js'], { cwd: REPO, stdio: 'inherit' });
    execFileSync('node', ['check.js'], { cwd: REPO, stdio: 'inherit' });
    const msg = ['feat: auto-sync ' + newOnes.length + ' sessions from api (' + new Date().toLocaleString('zh-CN') + ')',
      '', ...newOnes.map(s => '- ' + s.date + '《' + s.title + '》' + s.people.length + '人')].join('\n');
    const mf = path.join(REPO, '.git', 'AUTO_COMMIT_MSG.txt');
    fs.writeFileSync(mf, msg, 'utf8');
    execFileSync('git', ['add', 'app.js', 'index.html', 'build.json', CFG.snapshot], { cwd: REPO, stdio: 'inherit' });
    execFileSync('git', ['commit', '-F', mf], { cwd: REPO, stdio: 'inherit' });
    fs.unlinkSync(mf);
    execFileSync('git', ['push'], { cwd: REPO, stdio: 'inherit' });
    log('已自动发布 ' + newOnes.length + ' 场，版本 ' + localTs + '。');
    writeReport({ ranAt: new Date().toISOString(), today, apiWindow: [apiMin, apiMax], months, apiDone: sessions.length, added: newOnes.length, missing: missing.length, conflicts: conflicts.length, published: true, sessions: newOnes.map(s => s.date + '|' + s.title) });
  }).catch(e => die(e && e.message || String(e)));

  function writeReport(obj) {
    try {
      fs.mkdirSync(path.dirname(path.join(REPO, CFG.reportFile)), { recursive: true });
      fs.writeFileSync(path.join(REPO, CFG.reportFile), JSON.stringify(obj, null, 2), 'utf8');
    } catch (_) { /* 报告失败不影响主流程 */ }
  }
}
main();
