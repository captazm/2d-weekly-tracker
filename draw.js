// ===== Luck Max — 2D Dealer Module (Firestore) v2 =====
import {
  doc, setDoc, getDoc, getDocs, collection, deleteDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

let db = null, uid = null;
let settings = { defaultLimit: 50000, commissionRate: 18, payoutMult: 80, blocked: [], limits: {} };
let agents = [];
let loaded = false;
let currentDraw = null;
let currentTab = 'new';
let betSearch = '';
let drawsCache = [];
let listMode = 'draws';   // 'draws' | 'settle'
let settleScope = 'all';  // 'all' | 'today' | 'month'

const fmt = (n) => Number(n || 0).toLocaleString();
const localISO = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const fmtSigned = (n) => (Number(n) > 0 ? '+' : '') + Number(n || 0).toLocaleString();
const genId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const uniq = (a) => [...new Set(a)];

export function initLottery(database, userId) {
  db = database;
  uid = userId;
  loaded = false;
}

// ===== Share receiver (Viber/Telegram message → bet entry) =====
export async function openShareSheet(text) {
  const sheet = document.getElementById('shareSheet');
  if (!db || !uid) {
    alert('Cloud login လိုပါတယ် — Email နဲ့ ဝင်ပြီးမှ share လုပ်ပါ');
    return;
  }
  await ensureLoaded();

  document.getElementById('shareText').value = text || '';
  document.getElementById('shareDate').value = localISO(new Date());
  document.getElementById('shareResult').innerHTML = '';

  const agentSel = document.getElementById('shareAgent');
  agentSel.innerHTML = agents.length === 0
    ? '<option value="">— ထိုးသား မရှိ (Settings မှာထည့်ပါ) —</option>'
    : agents.map(a => `<option value="${a.id}">${a.name}${a.comm ? ' /' + a.comm + '%' : ''}</option>`).join('');

  sheet.style.display = 'flex';
}

window.closeShareSheet = function() {
  document.getElementById('shareSheet').style.display = 'none';
  // clean the ?text= param so refresh doesn't re-trigger
  if (location.search.includes('text=') || location.search.includes('share')) {
    history.replaceState(null, '', location.pathname);
  }
};

window.submitShare = async function() {
  const agentId = document.getElementById('shareAgent').value;
  if (!agentId) { alert('ထိုးသား ရွေးပါ (Settings မှာ ထည့်လို့ရတယ်)'); return; }
  const agent = agents.find(a => a.id === agentId);
  const date = document.getElementById('shareDate').value;
  const session = document.getElementById('shareSession').value;
  const text = document.getElementById('shareText').value;
  const entries = parseBetInput(text);
  if (entries.length === 0) { alert('Format မမှန်ပါ — message ကို ပြန်စစ်ပါ'); return; }

  // open/create draw
  const id = `${date}_${session}`;
  const ref = doc(db, 'users', uid, 'draws', id);
  const snap = await getDoc(ref);
  let draw = snap.exists() ? snap.data() : { id, date, session, status: 'open', bets: [], forwards: [], createdAt: new Date().toISOString() };
  if (!draw.bets) draw.bets = [];
  if (!draw.forwards) draw.forwards = [];
  if (draw.status === 'settled') { alert('ဒီ Draw က ရှင်းပြီးသား — ပြင်လို့မရပါ'); return; }

  const accepted = {};
  draw.bets.forEach(b => accepted[b.number] = (accepted[b.number] || 0) + b.amount);

  const results = [], blockedSkipped = [];
  for (const e of entries) {
    if ((settings.blocked || []).includes(e.number)) { blockedSkipped.push(e.number); continue; }
    const limit = (settings.limits || {})[e.number] ?? settings.defaultLimit;
    const cur = accepted[e.number] || 0;
    const remaining = Math.max(0, limit - cur);
    const acc = Math.min(e.amount, remaining);
    const over = e.amount - acc;
    if (acc > 0) {
      draw.bets.push({ id: genId(), agentId, agentName: agent.name, number: e.number, amount: acc, ts: Date.now() });
      accepted[e.number] = cur + acc;
    }
    if (over > 0) draw.forwards.push({ id: genId(), number: e.number, amount: over, status: 'pending' });
    results.push({ number: e.number, acc, over });
  }

  draw.updatedAt = new Date().toISOString();
  await setDoc(ref, draw);

  let html = `<div style="margin-top:12px;font-size:13px;max-height:220px;overflow-y:auto;">
    <div style="font-weight:700;color:var(--primary-dark);margin-bottom:6px;">✓ ${results.length} ကွက် ထည့်ပြီး (${agent.name} — ${date} ${session === 'morning' ? 'မနက်' : 'ည'})</div>`;
  if (blockedSkipped.length) html += `<div style="background:#fee2e2;color:#991b1b;border-radius:10px;padding:10px;margin-bottom:8px;font-weight:700;">🚫 ပိတ်ဂဏန်း: ${uniq(blockedSkipped).join(', ')}</div>`;
  html += results.map(r => `<div style="display:flex;justify-content:space-between;padding:6px 10px;border-radius:8px;margin-bottom:3px;background:${r.over > 0 ? '#fef3c7' : '#f0fdf4'};"><b style="font-family:monospace;">${r.number}</b><span>လက်ခံ ${fmt(r.acc)}${r.over > 0 ? ` <b style="color:#d97706;">| ကာ ${fmt(r.over)}</b>` : ''}</span></div>`).join('');
  html += '</div>';
  document.getElementById('shareResult').innerHTML = html;
  document.getElementById('shareText').value = '';

  // refresh draw list cache if visible
  drawsCache = [];
};

function needCloud(el) {
  el.innerHTML = `<div class="card" style="text-align:center;color:#9ca3af;padding:30px;">
    ☁️ ဒီ feature က Cloud login လိုပါတယ်<br><small>Email နဲ့ ဝင်ထားမှ သုံးလို့ရပါမယ်</small></div>`;
}

// ===== Data loading =====
async function ensureLoaded() {
  if (loaded) return;
  const [setSnap, agentSnap] = await Promise.all([
    getDoc(doc(db, 'users', uid, 'config', 'lottery')),
    getDocs(collection(db, 'users', uid, 'agents')),
  ]);
  if (setSnap.exists()) settings = { ...settings, ...setSnap.data() };
  agents = [];
  agentSnap.forEach(d => agents.push({ id: d.id, ...d.data() }));
  agents.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  loaded = true;
}

async function saveSettings() {
  await setDoc(doc(db, 'users', uid, 'config', 'lottery'), settings);
}

// =====================================================
// NUMBER PATTERN EXPANSION
// =====================================================
function expandDoubles() { return ['00','11','22','33','44','55','66','77','88','99']; }
function expandKhwe(digits, withDoubles) {
  const ds = uniq(digits.replace(/[^0-9]/g, '').split(''));
  const out = [];
  for (const a of ds) for (const b of ds) {
    if (a === b && !withDoubles) continue;
    out.push(a + b);
  }
  return uniq(out);
}
function expandBrake(digits) {
  // ဘရိတ် = digit-sum family: 4ဘရိတ် → 04,13,22,31,40,59,68,77,86,95
  const ds = uniq(digits.replace(/[^0-9]/g, '').split('').map(Number));
  const out = [];
  for (const t of ds)
    for (let a = 0; a < 10; a++)
      for (let b = 0; b < 10; b++)
        if ((a + b) % 10 === t) out.push(String(a) + String(b));
  return uniq(out);
}
function expandPat(digits, doubleTwice) {
  // ပတ်/ပါ = contains digit: 1ပတ် → 19 ကွက် (11 once); ပတ်အပူး → 11 twice (20)
  const ds = uniq(digits.replace(/[^0-9]/g, '').split(''));
  const out = [];
  for (const d of ds) for (let i = 0; i < 10; i++) {
    out.push(d + String(i));
    out.push(String(i) + d);
  }
  let res = uniq(out);
  if (doubleTwice) ds.forEach(d => res = res.concat(d + d));
  return res;
}
function expandHead(digits) {
  const ds = uniq(digits.replace(/[^0-9]/g, '').split(''));
  return uniq(ds.flatMap(d => Array.from({ length: 10 }, (_, i) => d + String(i))));
}
function expandTail(digits) {
  const ds = uniq(digits.replace(/[^0-9]/g, '').split(''));
  return uniq(ds.flatMap(d => Array.from({ length: 10 }, (_, i) => String(i) + d)));
}
function expandPairs(f1, f2) {
  const out = [];
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) if (f1(i) && f2(j)) out.push(String(i) + String(j));
  return out;
}
const POWER = ['05','50','16','61','27','72','38','83','49','94'];
const NAKHAT = ['07','70','18','81','24','42','35','53','69','96'];
const BROTHER = ['01','12','23','34','45','56','67','78','89'];
const ELDER = ['10','21','32','43','54','65','76','87','98'];

// Word patterns — order matters (longer words first)
const WORD_PATTERNS = [
  { re: /ခွေပူး/, fn: (d) => expandKhwe(d, true), needDigits: true },
  { re: /ခွေ/, fn: (d) => expandKhwe(d, false), needDigits: true },
  { re: /(အပူး|ပူးစုံ|စုံပူး)/, fn: () => expandDoubles() },
  { re: /(ဘရိတ်|ဘရိတ|bk|BK|Bk)/, fn: (d) => expandBrake(d), needDigits: true },
  { re: /ထိပ်/, fn: (d) => expandHead(d), needDigits: true },
  { re: /(ပိတ်|နောက်ပိတ်)/, fn: (d) => expandTail(d), needDigits: true },
  { re: /ပါဝါ/, fn: () => POWER },
  { re: /(ပတ်အပူး|ပါအပူး)/, fn: (d) => expandPat(d, true), needDigits: true },
  { re: /(ပတ်|ပါ)/, fn: (d) => expandPat(d, false), needDigits: true },
  { re: /(နက္ခတ်|နခတ်)/, fn: () => NAKHAT },
  { re: /(စုံစုံ|ဆုံဆုံ)/, fn: () => expandPairs(i => i % 2 === 0, j => j % 2 === 0) },
  { re: /(မမ)/, fn: () => expandPairs(i => i % 2 === 1, j => j % 2 === 1) },
  { re: /(စုံမ|ဆုံမ)/, fn: () => expandPairs(i => i % 2 === 0, j => j % 2 === 1) },
  { re: /(မစုံ|မဆုံ)/, fn: () => expandPairs(i => i % 2 === 1, j => j % 2 === 0) },
  { re: /ညီကို/, fn: () => BROTHER },
  { re: /ကိုညီ/, fn: () => ELDER },
];

// Convert Myanmar digits to Arabic
function normalizeDigits(text) {
  const mm = '၀၁၂၃၄၅၆၇၈၉';
  return text.replace(/[၀-၉]/g, (c) => String(mm.indexOf(c)));
}

// =====================================================
// BET INPUT PARSER
// Supports:
//   12.34.56d 5000 | 12.34r 1000 | 12 5000 | 11=3000
//   10/30/90/r500  (slash format, r = reverse)
//   1267ခွေ100 | 2479ခွေပူး100 | အပူး100 | 4ဘရိတ်200
//   1.2.3 bk 100 | 1 2 3 4 ဘရိတ် 100 | 3ထိပ်500 | 12.34ပတ်500
// =====================================================
function parseBetInput(text) {
  const entries = [];
  const normalized = normalizeDigits(text).replace(/=/g, ' ');
  const parts = normalized.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);

  for (const part of parts) {
    // --- 1. Slash format: 10/30/90/r500 or 10/30/90/500
    if (part.includes('/')) {
      const tokens = part.split('/').map(t => t.trim()).filter(Boolean);
      const last = tokens[tokens.length - 1];
      const m = last.match(/^([rRဒါ]?)(\d+)$/);
      if (m && tokens.length >= 2) {
        const rev = m[1].toLowerCase() === 'r';
        const amount = parseInt(m[2]);
        const nums = tokens.slice(0, -1).filter(t => /^\d{2}$/.test(t));
        if (nums.length > 0 && amount > 0) {
          for (const n of nums) {
            entries.push({ number: n, amount });
            if (rev && n[0] !== n[1]) entries.push({ number: n[1] + n[0], amount });
          }
          continue;
        }
      }
    }

    // --- 2. ပတ် word (reverse) after numbers: 12.34ပတ်500 or 12.34 ပတ် 500
    let m = part.match(/^([\d.\s]+?)\s*(?:အပြန်)\s*(\d+)$/);
    if (m) {
      const nums = m[1].split(/[.\s]+/).filter(n => /^\d{2}$/.test(n));
      const amount = parseInt(m[2]);
      if (nums.length && amount > 0) {
        for (const n of nums) {
          entries.push({ number: n, amount });
          if (n[0] !== n[1]) entries.push({ number: n[1] + n[0], amount });
        }
        continue;
      }
    }

    // --- 3. Burmese word patterns: [digits]WORD[amount]
    let matched = false;
    for (const wp of WORD_PATTERNS) {
      const wre = new RegExp(`^([\\d.\\s]*?)\\s*(?:${wp.re.source})\\s*(\\d+)$`, 'u');
      const wm = part.match(wre);
      if (wm) {
        const digits = wm[1] || '';
        const amount = parseInt(wm[wm.length - 1]);
        if (!amount) break;
        if (wp.needDigits && !digits.replace(/[^0-9]/g, '')) break;
        const nums = wp.fn(digits);
        if (nums.length > 0) {
          nums.forEach(n => entries.push({ number: n, amount }));
          matched = true;
        }
        break;
      }
    }
    if (matched) continue;

    // --- 4. Standard dot format: 12.34.56d 5000 | 12.34r 1000 | 12 5000
    m = part.match(/^([\d.\s]+?)\s*([drDR])?\s+(\d+)$/);
    if (m) {
      const nums = m[1].split(/[.\s]+/).filter(n => /^\d{2}$/.test(n));
      const type = (m[2] || 'd').toLowerCase();
      const amount = parseInt(m[3]);
      if (nums.length && amount > 0) {
        for (const n of nums) {
          entries.push({ number: n, amount });
          if (type === 'r' && n[0] !== n[1]) entries.push({ number: n[1] + n[0], amount });
        }
        continue;
      }
    }

    // --- 5. Attached d/r: 12.34.56d5000 | 78r1000
    m = part.match(/^([\d.]+?)([drDR])(\d{2,})$/);
    if (m) {
      const nums = m[1].split('.').filter(n => /^\d{2}$/.test(n));
      const type = m[2].toLowerCase();
      const amount = parseInt(m[3]);
      if (nums.length && amount > 0) {
        for (const n of nums) {
          entries.push({ number: n, amount });
          if (type === 'r' && n[0] !== n[1]) entries.push({ number: n[1] + n[0], amount });
        }
      }
    }
  }
  return entries;
}

// =====================================================
// DRAW LIST + SETTLEMENT VIEW
// =====================================================
export async function renderDrawList() {
  const el = document.getElementById('drawsView');
  if (!db || !uid) return needCloud(el);
  el.innerHTML = `<div class="card" style="text-align:center;color:#9ca3af;">Loading...</div>`;

  let snap;
  try {
    await ensureLoaded();
    snap = await getDocs(query(collection(db, 'users', uid, 'draws'), orderBy('date', 'desc')));
  } catch (e) {
    console.error('renderDrawList', e);
    el.innerHTML = `<div class="card" style="text-align:center;padding:24px;">
      <p style="color:#dc2626;font-weight:700;margin-bottom:6px;">⚠️ Data ဆွဲလို့မရပါ</p>
      <p style="color:#6b7280;font-size:12.5px;line-height:1.7;margin-bottom:12px;">Internet / VPN ကို စစ်ပါ။<br>VPN သုံးနေရင် ခဏပိတ်ပြီး ပြန်စမ်းကြည့်ပါ။</p>
      <button onclick="switchView('draws')" style="padding:10px 24px;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:white;border:none;border-radius:10px;font-weight:700;font-family:inherit;cursor:pointer;">🔄 ပြန်ကြိုးစား</button>
    </div>`;
    return;
  }
  drawsCache = [];
  snap.forEach(d => drawsCache.push(d.data()));
  drawsCache.sort((a, b) => b.date.localeCompare(a.date) || (b.session === 'evening' ? 1 : -1));

  el.innerHTML = `
    <div style="display:flex;gap:4px;background:rgba(0,0,0,0.06);border-radius:12px;padding:4px;margin:12px 12px 0;">
      <button onclick="lotListMode('draws')" style="flex:1;padding:10px;border:none;border-radius:9px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;
        background:${listMode==='draws'?'white':'transparent'};color:${listMode==='draws'?'var(--primary-dark)':'#6b7280'};
        ${listMode==='draws'?'box-shadow:0 1px 3px rgba(0,0,0,0.1);':''}">🎯 Draw များ</button>
      <button onclick="lotListMode('settle')" style="flex:1;padding:10px;border:none;border-radius:9px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;
        background:${listMode==='settle'?'white':'transparent'};color:${listMode==='settle'?'var(--primary-dark)':'#6b7280'};
        ${listMode==='settle'?'box-shadow:0 1px 3px rgba(0,0,0,0.1);':''}">💰 စာရင်းရှင်း</button>
    </div>
    <div id="lotListBody"></div>`;

  if (listMode === 'draws') renderDrawsBody();
  else renderSettleBody();
}

window.lotListMode = function(mode) {
  listMode = mode;
  if (mode === 'draws') renderDrawsBody(); else renderSettleBody();
  // update segmented styles
  renderDrawList();
};

function renderDrawsBody() {
  const el = document.getElementById('lotListBody');
  if (!el) return;
  el.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <input type="date" id="lotNewDate" value="${localISO(new Date())}"
               style="flex:1;border:1.5px solid var(--border);border-radius:10px;padding:10px;font-family:inherit;font-weight:600;">
        <select id="lotNewSession" style="border:1.5px solid var(--border);border-radius:10px;padding:10px;font-family:inherit;font-weight:600;">
          <option value="morning">မနက်</option>
          <option value="evening">ည</option>
        </select>
        <button onclick="lotCreateDraw()" class="nav-btn" style="width:auto;padding:0 16px;font-size:14px;">+ ဖွင့်</button>
      </div>
      ${drawsCache.length === 0 ? '<p style="color:#9ca3af;text-align:center;padding:12px;font-size:13px;">Draw မရှိသေးပါ</p>' :
        drawsCache.map(d => {
          const t = d.totals || {};
          return `
          <div class="week-row" onclick="lotOpenDraw('${d.id}')">
            <span class="wk-num" style="background:${d.session==='morning'?'linear-gradient(135deg,#f59e0b,#d97706)':'linear-gradient(135deg,#6366f1,#4f46e5)'}">${d.session==='morning'?'☀️':'🌙'}</span>
            <div class="wk-info">
              <div class="wk-date">${d.date} — ${d.session==='morning'?'မနက်':'ည'}</div>
              <div class="wk-note">${d.status==='settled' ? `ပေါက်: ${d.winningNumber} | P/L: ${fmtSigned(t.pl||0)}` : `${(d.bets||[]).length} ကွက် | ${fmt((d.bets||[]).reduce((s,b)=>s+b.amount,0))}`}</div>
            </div>
            <span class="wk-pl ${d.status==='settled' ? ((t.pl||0)>=0?'positive':'negative') : ''}" style="font-size:12px;">
              ${d.status==='settled' ? fmtSigned(t.pl||0) : '🟢 ဖွင့်'}
            </span>
            <button onclick="event.stopPropagation();lotDeleteDraw('${d.id}')" style="background:none;border:none;font-size:16px;cursor:pointer;">🗑️</button>
          </div>`;
        }).join('')}
    </div>`;
}

// ---- Settlement (စာရင်းရှင်းရန်) ----
function renderSettleBody() {
  const el = document.getElementById('lotListBody');
  if (!el) return;

  const today = localISO(new Date());
  const thisMonth = today.slice(0, 7);
  const settled = drawsCache.filter(d => d.status === 'settled').filter(d => {
    if (settleScope === 'today') return d.date === today;
    if (settleScope === 'month') return d.date.startsWith(thisMonth);
    return true;
  });

  // Aggregate per agent
  const perAgent = {};
  for (const d of settled) {
    const winners = (d.totals?.winners) || [];
    for (const b of (d.bets || [])) {
      if (!perAgent[b.agentName]) perAgent[b.agentName] = { sales: 0, win: 0, comm: 0, agentId: b.agentId };
      perAgent[b.agentName].sales += b.amount;
    }
    for (const w of winners) {
      if (!perAgent[w.name]) perAgent[w.name] = { sales: 0, win: 0, comm: 0 };
      perAgent[w.name].win += w.payout;
    }
  }
  // commission per agent (their own rate)
  for (const [name, v] of Object.entries(perAgent)) {
    const ag = agents.find(a => a.name === name || a.id === v.agentId);
    v.comm = ag && ag.comm ? Math.round(v.sales * ag.comm / 100) : 0;
    v.balance = v.sales - v.win - v.comm;
  }

  const scopeBtn = (id, label) => `
    <button onclick="lotSettleScope('${id}')" style="padding:7px 14px;border:none;border-radius:999px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;
      background:${settleScope===id?'var(--primary)':'#f3f4f6'};color:${settleScope===id?'white':'#6b7280'};">${label}</button>`;

  el.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:6px;margin-bottom:12px;">
        ${scopeBtn('all', 'အားလုံး')}${scopeBtn('today', 'ဒီနေ့')}${scopeBtn('month', 'ဒီလ')}
        <span style="margin-left:auto;font-size:11px;color:#9ca3af;align-self:center;">${settled.length} draw</span>
      </div>
      ${Object.keys(perAgent).length === 0 ? '<p style="color:#9ca3af;text-align:center;padding:14px;font-size:13px;">ရှင်းပြီး draw မရှိသေးပါ</p>' :
        Object.entries(perAgent).sort((a, b) => b[1].sales - a[1].sales).map(([name, v]) => `
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:14px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <b style="font-size:15px;color:var(--primary-dark);">${name}</b>
            <button onclick="lotCopySettle('${name.replace(/'/g, "\\'")}',${v.sales},${v.win},${v.comm},${v.balance})"
              style="background:none;border:none;font-size:17px;cursor:pointer;">📋</button>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;"><span style="color:#6b7280;">ရောင်းရငွေ</span><b style="color:#1e40af;">${fmt(v.sales)}</b></div>
          <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;"><span style="color:#6b7280;">ပေါက်သီး</span><b style="color:#dc2626;">${fmt(v.win)}</b></div>
          <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;"><span style="color:#6b7280;">ကော်မရှင်</span><b style="color:#d97706;">${fmt(v.comm)}</b></div>
          <div style="display:flex;justify-content:space-between;font-size:15px;padding:8px 0 0;margin-top:6px;border-top:2px solid #e5e7eb;">
            <b>စာရင်း</b>
            <b class="${v.balance >= 0 ? 'positive' : 'negative'}">${fmtSigned(v.balance)}</b>
          </div>
          <div style="font-size:10.5px;color:#9ca3af;text-align:right;margin-top:2px;">
            ${v.balance >= 0 ? '← ထိုးသားက ပေးရမည်' : '→ ဒိုင်က ပြန်ပေးရမည်'}
          </div>
        </div>`).join('')}
    </div>`;
}

window.lotSettleScope = function(scope) {
  settleScope = scope;
  renderSettleBody();
};

window.lotCopySettle = function(name, sales, win, comm, balance) {
  const text = `${name}\nရောင်းရငွေ = ${fmt(sales)}\nပေါက်သီး = ${fmt(win)}\nကော်မရှင် = ${fmt(comm)}\n----------------------------\nစာရင်း = ${fmtSigned(balance)}`;
  navigator.clipboard.writeText(text);
  alert('📋 Copy ပြီးပါပြီ\n\n' + text);
};

window.lotCreateDraw = async function() {
  const date = document.getElementById('lotNewDate').value;
  const session = document.getElementById('lotNewSession').value;
  if (!date) return;
  const id = `${date}_${session}`;
  const ref = doc(db, 'users', uid, 'draws', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      id, date, session, status: 'open',
      bets: [], forwards: [],
      createdAt: new Date().toISOString(),
    });
  }
  lotOpenDraw(id);
};

window.lotDeleteDraw = async function(id) {
  if (!confirm('ဒီ Draw ကို ဖျက်မလား? ထိုးငွေအားလုံး ပါပျက်မယ်။')) return;
  await deleteDoc(doc(db, 'users', uid, 'draws', id));
  renderDrawList();
};

window.lotOpenDraw = async function(id) {
  const snap = await getDoc(doc(db, 'users', uid, 'draws', id));
  if (!snap.exists()) return;
  currentDraw = snap.data();
  if (!currentDraw.bets) currentDraw.bets = [];
  if (!currentDraw.forwards) currentDraw.forwards = [];
  currentTab = 'new';
  betSearch = '';
  window.switchView('drawDetail');
  renderDrawDetail();
};

async function saveDraw() {
  currentDraw.updatedAt = new Date().toISOString();
  await setDoc(doc(db, 'users', uid, 'draws', currentDraw.id), currentDraw);
}

// =====================================================
// DRAW DETAIL VIEW (tabs)
// =====================================================
const TABS = [
  { id: 'new', label: 'ထည့်' },
  { id: 'list', label: 'စာရင်း' },
  { id: 'grid', label: 'ဂဏန်း' },
  { id: 'ka', label: 'ကာ' },
  { id: 'result', label: 'ပေါက်' },
];

function drawTotals() {
  const bets = currentDraw.bets, fwds = currentDraw.forwards;
  const perNum = {};
  bets.forEach(b => perNum[b.number] = (perNum[b.number] || 0) + b.amount);
  const sentF = fwds.filter(f => f.status === 'sent');
  sentF.forEach(f => perNum[f.number] = (perNum[f.number] || 0) - f.amount);
  const totalBets = bets.reduce((s, b) => s + b.amount, 0);
  const forwarded = sentF.reduce((s, f) => s + f.amount, 0);
  return { perNum, totalBets, forwarded, netSales: totalBets - forwarded, uniqueNums: new Set(bets.map(b => b.number)).size };
}

function renderDrawDetail() {
  const el = document.getElementById('drawDetailView');
  const d = currentDraw;
  const t = drawTotals();

  el.innerHTML = `
    <div class="week-selector-bar" style="top:56px;">
      <button onclick="switchView('draws');" class="nav-btn">‹</button>
      <div class="week-info">
        <span style="font-weight:800;color:var(--primary-dark);font-size:15px;">${d.date} — ${d.session==='morning'?'☀️ မနက်':'🌙 ည'}</span>
        <span class="week-label">${d.status==='settled' ? '✅ ရှင်းပြီး (ပေါက်: '+d.winningNumber+')' : '🟢 ဖွင့်ထား'}</span>
      </div>
      <div style="width:40px;"></div>
    </div>

    <div style="display:flex;background:white;border-bottom:1px solid #e5e7eb;overflow-x:auto;">
      ${TABS.map(tb => `
        <button onclick="lotSwitchTab('${tb.id}')"
          style="flex:1;padding:11px 8px;border:none;background:none;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;
                 color:${currentTab===tb.id?'var(--primary-dark)':'#9ca3af'};
                 border-bottom:2.5px solid ${currentTab===tb.id?'var(--primary)':'transparent'};">
          ${tb.label}</button>`).join('')}
    </div>

    <div style="display:flex;gap:6px;padding:8px 12px;background:rgba(255,255,255,0.6);">
      <div class="stat-pill" style="flex:1;"><span class="lbl">ရောင်းရ</span><span class="val">${fmt(t.totalBets)}</span></div>
      <div class="stat-pill orange" style="flex:1;"><span class="lbl">ကာပြီး</span><span class="val">${fmt(t.forwarded)}</span></div>
      <div class="stat-pill" style="flex:1;background:linear-gradient(135deg,#d1fae5,#a7f3d0);"><span class="lbl">Net</span><span class="val">${fmt(t.netSales)}</span></div>
    </div>

    <div id="lotTabContent"></div>`;

  renderTab();
}

window.lotSwitchTab = function(tab) {
  currentTab = tab;
  renderDrawDetail();
};

function renderTab() {
  const el = document.getElementById('lotTabContent');
  if (currentTab === 'new') renderBetEntry(el);
  else if (currentTab === 'list') renderBetList(el);
  else if (currentTab === 'grid') renderGrid(el);
  else if (currentTab === 'ka') renderKa(el);
  else if (currentTab === 'result') renderResult(el);
}

// ===== TAB: Bet entry =====
const SHORTCUT_BTNS = [
  { label: 'အပူး', insert: 'အပူး' },
  { label: 'ပါဝါ', insert: 'ပါဝါ' },
  { label: 'နက္ခတ်', insert: 'နက္ခတ်' },
  { label: 'စုံစုံ', insert: 'စုံစုံ' },
  { label: 'မမ', insert: 'မမ' },
  { label: 'ညီကို', insert: 'ညီကို' },
  { label: 'ကိုညီ', insert: 'ကိုညီ' },
  { label: 'ခွေ', insert: 'ခွေ', prefix: true },
  { label: 'ထိပ်', insert: 'ထိပ်', prefix: true },
  { label: 'ပိတ်', insert: 'ပိတ်', prefix: true },
  { label: 'ဘရိတ်', insert: 'ဘရိတ်', prefix: true },
  { label: 'ပတ်', insert: 'ပတ်', prefix: true },
];

function renderBetEntry(el) {
  el.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:8px;margin-bottom:10px;">
        <select id="lotAgent" style="flex:1;border:1.5px solid var(--border);border-radius:10px;padding:10px;font-family:inherit;font-weight:600;">
          ${agents.length === 0 ? '<option value="">— ထိုးသား မရှိ (Settings မှာထည့်ပါ) —</option>' :
            agents.map(a => `<option value="${a.id}">${a.name}${a.comm ? ' /'+a.comm+'%' : ''}</option>`).join('')}
        </select>
      </div>

      <!-- Blocked chips + quick add -->
      <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:10px;">
        ${(settings.blocked || []).map(n => `
          <span onclick="lotQuickUnblock('${n}')" style="background:white;border:1.5px solid #fca5a5;color:#dc2626;border-radius:50%;width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;font-family:monospace;font-weight:800;font-size:12px;cursor:pointer;">${n}</span>`).join('')}
        <input id="lotQuickBlock" maxlength="2" inputmode="numeric" placeholder="00"
          style="width:44px;text-align:center;font-family:monospace;font-weight:700;border:1.5px dashed #d1d5db;border-radius:999px;padding:7px 0;font-size:12px;">
        <button onclick="lotQuickBlockAdd()" style="background:var(--primary);color:white;border:none;border-radius:999px;padding:7px 14px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;">Add</button>
      </div>

      <textarea id="lotBetInput" rows="5" placeholder="12.34.56d 5000, 78r 1000&#10;1267ခွေ100&#10;အပူး100&#10;4ဘရိတ်200&#10;10/30/90/r500"
        style="width:100%;border:1.5px solid var(--border);border-radius:12px;padding:12px;font-family:monospace;font-size:15px;resize:vertical;"></textarea>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0;">
        ${SHORTCUT_BTNS.map((s, i) => `<button onclick="lotShortcut(${i})"
          style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;">${s.label}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;">
        <button onclick="lotPasteInput()" style="width:52px;padding:14px 0;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:12px;font-size:16px;cursor:pointer;">📋</button>
        <button onclick="lotSubmitBets()" ${currentDraw.status==='settled'?'disabled':''}
          style="flex:1;padding:14px;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:white;border:none;border-radius:12px;font-size:15px;font-weight:800;font-family:inherit;cursor:pointer;${currentDraw.status==='settled'?'opacity:0.5;':''}">
          ${currentDraw.status==='settled' ? '🔒 ရှင်းပြီးသား Draw' : 'ထည့်မည်'}
        </button>
      </div>
      <div id="lotBetResult"></div>
    </div>`;
}

window.lotPasteInput = async function() {
  try {
    const text = await navigator.clipboard.readText();
    const ta = document.getElementById('lotBetInput');
    ta.value += (ta.value ? '\n' : '') + text;
  } catch (e) {
    alert('Clipboard ဖတ်ခွင့် မရပါ — ကိုယ်တိုင် paste လုပ်ပါ');
  }
};

window.lotQuickBlockAdd = async function() {
  const n = document.getElementById('lotQuickBlock').value.trim();
  if (!/^\d{2}$/.test(n)) return;
  if (!settings.blocked) settings.blocked = [];
  if (!settings.blocked.includes(n)) settings.blocked.push(n);
  await saveSettings();
  renderTab();
};

window.lotQuickUnblock = async function(n) {
  if (!confirm(`${n} ကို ပြန်ဖွင့်မလား?`)) return;
  settings.blocked = (settings.blocked || []).filter(x => x !== n);
  await saveSettings();
  renderTab();
};

window.lotShortcut = function(i) {
  const s = SHORTCUT_BTNS[i];
  const ta = document.getElementById('lotBetInput');
  if (s.prefix) {
    const d = prompt('ဂဏန်း (ဥပမာ 1267 သို့ 4):');
    if (d === null || !/^\d+$/.test(d.trim())) return;
    ta.value += (ta.value && !ta.value.endsWith('\n') ? '\n' : '') + d.trim() + s.insert;
  } else {
    ta.value += (ta.value && !ta.value.endsWith('\n') ? '\n' : '') + s.insert;
  }
  ta.focus();
};

window.lotSubmitBets = async function() {
  if (currentDraw.status === 'settled') return;
  const agentId = document.getElementById('lotAgent').value;
  if (!agentId) { alert('ထိုးသား အရင်ရွေးပါ (Settings မှာ ထည့်လို့ရတယ်)'); return; }
  const agent = agents.find(a => a.id === agentId);
  const text = document.getElementById('lotBetInput').value;
  const entries = parseBetInput(text);
  if (entries.length === 0) { alert('Format မမှန်ပါ။\nဥပမာ:\n12.34d 5000\n1267ခွေ100\nအပူး100'); return; }

  const accepted = {};
  currentDraw.bets.forEach(b => accepted[b.number] = (accepted[b.number] || 0) + b.amount);

  const results = [], blockedSkipped = [];
  for (const e of entries) {
    if ((settings.blocked || []).includes(e.number)) { blockedSkipped.push(e.number); continue; }
    const limit = (settings.limits || {})[e.number] ?? settings.defaultLimit;
    const cur = accepted[e.number] || 0;
    const remaining = Math.max(0, limit - cur);
    const acc = Math.min(e.amount, remaining);
    const over = e.amount - acc;
    if (acc > 0) {
      currentDraw.bets.push({ id: genId(), agentId, agentName: agent.name, number: e.number, amount: acc, ts: Date.now() });
      accepted[e.number] = cur + acc;
    }
    if (over > 0) {
      currentDraw.forwards.push({ id: genId(), number: e.number, amount: over, status: 'pending' });
    }
    results.push({ number: e.number, acc, over });
  }

  await saveDraw();
  document.getElementById('lotBetInput').value = '';

  let html = '<div style="margin-top:12px;font-size:13px;max-height:260px;overflow-y:auto;">';
  html += `<div style="font-weight:700;color:var(--primary-dark);margin-bottom:6px;">✓ ${results.length} ကွက် ထည့်ပြီး (${agent.name})</div>`;
  if (blockedSkipped.length) {
    html += `<div style="background:#fee2e2;color:#991b1b;border-radius:10px;padding:10px;margin-bottom:8px;font-weight:700;">🚫 ပိတ်ဂဏန်း (မလက်ခံ): ${uniq(blockedSkipped).join(', ')}</div>`;
  }
  html += results.map(r => `
    <div style="display:flex;justify-content:space-between;padding:7px 10px;border-radius:8px;margin-bottom:3px;background:${r.over>0?'#fef3c7':'#f0fdf4'};">
      <b style="font-family:monospace;">${r.number}</b>
      <span>လက်ခံ ${fmt(r.acc)}${r.over>0 ? ` <b style="color:#d97706;">| ကာ ${fmt(r.over)}</b>` : ''}</span>
    </div>`).join('');
  html += '</div>';

  renderDrawDetail();
  setTimeout(() => { const rb = document.getElementById('lotBetResult'); if (rb) rb.innerHTML = html; }, 50);
};

// ===== TAB: Bet list + agent summary =====
function renderBetList(el) {
  let bets = [...currentDraw.bets].sort((a, b) => b.ts - a.ts);
  if (betSearch) bets = bets.filter(b => b.number.includes(betSearch) || (b.agentName || '').toLowerCase().includes(betSearch.toLowerCase()));

  const byAgent = {};
  currentDraw.bets.forEach(b => {
    if (!byAgent[b.agentId]) byAgent[b.agentId] = { name: b.agentName, total: 0, nums: {} };
    byAgent[b.agentId].total += b.amount;
    byAgent[b.agentId].nums[b.number] = (byAgent[b.agentId].nums[b.number] || 0) + b.amount;
  });

  el.innerHTML = `
    <div class="card">
      <h3>👥 ထိုးသားအလိုက်</h3>
      ${Object.entries(byAgent).length === 0 ? '<p style="color:#9ca3af;font-size:13px;text-align:center;">မရှိသေးပါ</p>' :
        Object.entries(byAgent).map(([aid, a]) => `
        <div class="week-row">
          <div class="wk-info">
            <div class="wk-date">${a.name}</div>
            <div class="wk-note">${Object.keys(a.nums).length} ကွက်</div>
          </div>
          <span class="wk-pl" style="color:#1e40af;">${fmt(a.total)}</span>
          <button onclick="lotCopyAgent('${aid}')" style="background:none;border:none;font-size:17px;cursor:pointer;">📋</button>
        </div>`).join('')}
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h3 style="margin:0;">📝 ထိုးစာရင်း (${bets.length})</h3>
      </div>
      <input id="lotBetSearch" value="${betSearch}" oninput="lotSearchBets(this.value)"
        placeholder="🔍 ဂဏန်း / ထိုးသား ရှာရန်"
        style="width:100%;border:1.5px solid var(--border);border-radius:10px;padding:9px 12px;font-family:inherit;font-size:13px;margin-bottom:10px;background:#f9fafb;">
      <div style="max-height:400px;overflow-y:auto;">
      ${bets.map(b => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 6px;border-bottom:1px solid #f3f4f6;font-size:13px;">
          <b style="font-family:monospace;font-size:16px;color:var(--primary-dark);width:30px;">${b.number}</b>
          <span style="flex:1;color:#6b7280;">${b.agentName}</span>
          <b>${fmt(b.amount)}</b>
          ${currentDraw.status!=='settled' ? `
            <button onclick="lotEditBet('${b.id}')" style="background:none;border:none;cursor:pointer;font-size:13px;">✏️</button>
            <button onclick="lotDeleteBet('${b.id}')" style="background:none;border:none;cursor:pointer;">🗑️</button>` : ''}
        </div>`).join('') || '<p style="color:#9ca3af;font-size:13px;text-align:center;">မတွေ့ပါ</p>'}
      </div>
    </div>`;
}

window.lotSearchBets = function(val) {
  betSearch = val.trim();
  const listEl = document.getElementById('lotTabContent');
  const scrollPos = document.getElementById('lotBetSearch');
  renderBetList(listEl);
  const inp = document.getElementById('lotBetSearch');
  if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
};

window.lotEditBet = async function(id) {
  const b = currentDraw.bets.find(x => x.id === id);
  if (!b) return;
  const val = prompt(`${b.number} (${b.agentName}) — ပမာဏအသစ်:`, b.amount);
  if (val === null) return;
  const amt = Number(String(val).replace(/[^0-9]/g, ''));
  if (amt <= 0) return;
  b.amount = amt;
  await saveDraw();
  renderDrawDetail();
};

window.lotDeleteBet = async function(id) {
  currentDraw.bets = currentDraw.bets.filter(b => b.id !== id);
  await saveDraw();
  renderDrawDetail();
};

window.lotCopyAgent = function(agentId) {
  const nums = {};
  let total = 0;
  currentDraw.bets.filter(b => b.agentId === agentId).forEach(b => {
    nums[b.number] = (nums[b.number] || 0) + b.amount;
    total += b.amount;
  });
  const byAmt = {};
  Object.entries(nums).forEach(([n, amt]) => {
    if (!byAmt[amt]) byAmt[amt] = [];
    byAmt[amt].push(n);
  });
  let text = '';
  Object.entries(byAmt).sort((a, b) => Number(b[0]) - Number(a[0])).forEach(([amt, ns]) => {
    text += `${ns.join('.')} = ${Number(amt).toLocaleString()}\n`;
  });
  text += `----------------------------\nTotal = ${total.toLocaleString()}`;
  navigator.clipboard.writeText(text);
  alert('📋 Copy ပြီးပါပြီ — Viber/Telegram မှာ paste လုပ်ပါ\n\n' + text);
};

// ===== TAB: Grid + ခန့်မှန်း =====
function renderGrid(el) {
  const t = drawTotals();
  let maxNum = '—', maxPot = 0;
  const cells = [];
  const exposures = [];
  for (let i = 0; i < 100; i++) {
    const num = String(i).padStart(2, '0');
    const net = Math.max(0, t.perNum[num] || 0);
    const limit = (settings.limits || {})[num] ?? settings.defaultLimit;
    const pot = net * settings.payoutMult;
    if (pot > maxPot) { maxPot = pot; maxNum = num; }
    if (net > 0) exposures.push({ num, net, pot });
    const pct = limit > 0 ? net / limit : 0;
    let bg = '#fafafa';
    if ((settings.blocked || []).includes(num)) bg = '#e5e7eb';
    else if (net > 0 && pct < 0.5) bg = '#dcfce7';
    else if (pct >= 0.5 && pct < 0.9) bg = '#fef9c3';
    else if (pct >= 0.9 && net < limit) bg = '#ffedd5';
    else if (net >= limit && limit > 0) bg = '#fecaca';
    cells.push(`<div style="background:${bg};border-radius:8px;padding:5px 2px;text-align:center;border:1px solid rgba(0,0,0,0.05);">
      <div style="font-family:monospace;font-weight:800;font-size:13px;">${num}</div>
      ${net > 0 ? `<div style="font-size:9.5px;color:#1e40af;font-weight:700;">${fmt(net)}</div>` : '<div style="font-size:9.5px;color:#d1d5db;">-</div>'}
    </div>`);
  }
  exposures.sort((a, b) => b.net - a.net);
  const top = exposures.slice(0, 10);

  el.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;font-size:13px;">
        <span>⚠️ အန္တရာယ်အကြီးဆုံး: <b style="color:#dc2626;">${maxNum}</b></span>
        <span>လျော်ရနိုင်ဆုံး: <b style="color:#dc2626;">${fmt(maxPot)}</b></span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(10,1fr);gap:3px;">${cells.join('')}</div>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:10px;font-size:10px;color:#6b7280;flex-wrap:wrap;">
        <span>🟩 &lt;50%</span><span>🟨 50-90%</span><span>🟧 90%+</span><span>🟥 ပြည့်</span><span>⬜ ပိတ်</span>
      </div>
    </div>
    ${top.length > 0 ? `
    <div class="card">
      <h3>📊 ခန့်မှန်း — ထိုးငွေအများဆုံး ၁၀ ကွက်</h3>
      ${top.map((e, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:7px 6px;border-bottom:1px solid #f3f4f6;font-size:13px;">
          <span style="color:#9ca3af;font-size:11px;width:18px;">${i + 1}</span>
          <b style="font-family:monospace;font-size:16px;color:var(--primary-dark);width:30px;">${e.num}</b>
          <span style="flex:1;color:#1e40af;font-weight:700;">${fmt(e.net)}</span>
          <span style="color:#dc2626;font-size:12px;">လျော်: ${fmt(e.pot)}</span>
        </div>`).join('')}
    </div>` : ''}`;
}

// ===== TAB: ကာ (forwards) =====
function renderKa(el) {
  const pending = currentDraw.forwards.filter(f => f.status === 'pending');
  const sent = currentDraw.forwards.filter(f => f.status === 'sent');

  el.innerHTML = `
    <div class="card">
      <h3>🔄 ပြန်ကာရန် (${pending.length})</h3>
      ${pending.length > 0 ? `
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <button onclick="lotCopyKa()" style="flex:1;padding:10px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;border:none;border-radius:10px;font-weight:700;font-family:inherit;cursor:pointer;font-size:13px;">📋 Copy All</button>
          <button onclick="lotAllSent()" style="flex:1;padding:10px;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:white;border:none;border-radius:10px;font-weight:700;font-family:inherit;cursor:pointer;font-size:13px;">✓ အားလုံးပို့ပြီး</button>
        </div>` : ''}
      ${pending.map(f => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 8px;background:#fef3c7;border-radius:10px;margin-bottom:5px;">
          <b style="font-family:monospace;font-size:17px;">${f.number}</b>
          <span style="flex:1;font-weight:700;">${fmt(f.amount)}</span>
          <button onclick="lotKaSent('${f.id}')" style="background:#16a34a;color:white;border:none;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;font-family:inherit;">✓ ပို့ပြီး</button>
          <button onclick="lotKaDelete('${f.id}')" style="background:none;border:none;font-size:15px;cursor:pointer;">🗑️</button>
        </div>`).join('') || '<p style="color:#9ca3af;font-size:13px;text-align:center;padding:8px;">ကာစရာ မရှိပါ</p>'}
      ${sent.length > 0 ? `
        <h3 style="margin-top:14px;color:#9ca3af;">ပို့ပြီးသား (${sent.length})</h3>
        ${sent.map(f => `
          <div style="display:flex;gap:10px;padding:7px 8px;color:#9ca3af;font-size:13px;border-bottom:1px solid #f3f4f6;">
            <b style="font-family:monospace;">${f.number}</b>
            <span style="flex:1;">${fmt(f.amount)}</span>
            <span style="color:#16a34a;">✓ Sent</span>
          </div>`).join('')}` : ''}
    </div>`;
}

window.lotCopyKa = function() {
  const pending = currentDraw.forwards.filter(f => f.status === 'pending');
  const merged = {};
  pending.forEach(f => merged[f.number] = (merged[f.number] || 0) + f.amount);
  let total = 0;
  let text = Object.entries(merged).map(([n, a]) => { total += a; return `${n} = ${a.toLocaleString()}`; }).join('\n');
  text += `\n----------------------------\nTotal = ${total.toLocaleString()}`;
  navigator.clipboard.writeText(text);
  alert('📋 Copy ပြီးပါပြီ\n\n' + text);
};

window.lotAllSent = async function() {
  currentDraw.forwards.forEach(f => { if (f.status === 'pending') f.status = 'sent'; });
  await saveDraw();
  renderDrawDetail();
};
window.lotKaSent = async function(id) {
  const f = currentDraw.forwards.find(x => x.id === id);
  if (f) f.status = 'sent';
  await saveDraw();
  renderDrawDetail();
};
window.lotKaDelete = async function(id) {
  currentDraw.forwards = currentDraw.forwards.filter(x => x.id !== id);
  await saveDraw();
  renderDrawDetail();
};

// ===== TAB: Result / settle =====
function renderResult(el) {
  const t = drawTotals();
  const pendingKa = currentDraw.forwards.filter(f => f.status === 'pending').length;
  const settled = currentDraw.status === 'settled';
  const tot = currentDraw.totals || {};

  // ကာဂဏာန်း receivable — winning number amount forwarded (sent) to other dealer
  let kaCard = '';
  if (settled && currentDraw.winningNumber) {
    const kaAmt = currentDraw.forwards
      .filter(f => f.status === 'sent' && f.number === currentDraw.winningNumber)
      .reduce((s, f) => s + f.amount, 0);
    if (kaAmt > 0) {
      const kaRecovery = kaAmt * settings.payoutMult;
      kaCard = `
        <div style="display:flex;align-items:center;gap:14px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:14px;padding:14px;margin-top:10px;">
          <b style="font-family:monospace;font-size:26px;color:#16a34a;">${currentDraw.winningNumber}</b>
          <div style="flex:1;">
            <div style="font-size:12px;color:#6b7280;">ကာဂဏာန်း — တခြားဒိုင်ဆီက ရရန်</div>
            <div style="font-size:12.5px;color:#6b7280;">ကာထား ${fmt(kaAmt)}</div>
          </div>
          <b style="color:#16a34a;font-size:17px;">+${fmt(kaRecovery)}</b>
        </div>`;
    }
  }

  el.innerHTML = `
    <div class="card">
      <h3>🏆 ပေါက်ဂဏန်း</h3>
      ${pendingKa > 0 ? `<div style="background:#fef3c7;color:#92400e;border-radius:10px;padding:9px 12px;font-size:12.5px;font-weight:600;margin-bottom:10px;">⚠️ မပို့ရသေးတဲ့ ကာ ${pendingKa} ခု ရှိနေတယ် — ပို့ပြီးမှတ်မှ Net ထဲက နှုတ်မယ်</div>` : ''}
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;">
        <input id="lotWinNum" maxlength="2" inputmode="numeric" placeholder="00" value="${currentDraw.winningNumber || ''}"
          style="width:80px;text-align:center;font-size:30px;font-weight:900;font-family:monospace;border:2px solid var(--primary);border-radius:12px;padding:8px;color:#dc2626;">
        <button onclick="lotSettle()"
          style="flex:1;padding:14px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:white;border:none;border-radius:12px;font-size:15px;font-weight:800;font-family:inherit;cursor:pointer;">
          ${settled ? '🔄 ပြင်ဆင်ရန်' : 'ရှင်းမည်'}
        </button>
      </div>
      ${settled ? `
        <div style="background:#f9fafb;border-radius:12px;padding:14px;font-size:13.5px;">
          <div style="display:flex;justify-content:space-between;padding:5px 0;"><span style="color:#6b7280;">ရောင်းရငွေ (Net)</span><b>${fmt(tot.netSales)}</b></div>
          <div style="display:flex;justify-content:space-between;padding:5px 0;"><span style="color:#6b7280;">ပေါက်သီး</span><b>${fmt(tot.winNet)}</b></div>
          <div style="display:flex;justify-content:space-between;padding:5px 0;"><span style="color:#6b7280;">လျော်ငွေ ×${settings.payoutMult}</span><b style="color:#dc2626;">-${fmt(tot.payout)}</b></div>
          <div style="display:flex;justify-content:space-between;padding:5px 0;"><span style="color:#6b7280;">တစ်ဦးချင်းကော်</span><b style="color:#d97706;">-${fmt(tot.perAgentComm || 0)}</b></div>
          <div style="display:flex;justify-content:space-between;padding:5px 0;"><span style="color:#6b7280;">စာရင်းကော် ${settings.commissionRate}%</span><b style="color:#d97706;">-${fmt(tot.globalComm || 0)}</b></div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #e5e7eb;margin-top:4px;font-size:16px;">
            <b>အမြတ်ငွေ</b><b class="${tot.pl>=0?'positive':'negative'}">${fmtSigned(tot.pl)}</b>
          </div>
          <div style="text-align:center;margin-top:8px;font-size:11.5px;color:#16a34a;font-weight:700;">✓ Weekly Tracker ထဲ auto ထည့်ပြီး</div>
        </div>
        ${(tot.winners||[]).length > 0 ? `
          <h3 style="margin-top:14px;">🎉 နိုင်သူများ</h3>
          ${tot.winners.map(w => `
            <div style="display:flex;align-items:center;gap:14px;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:14px;margin-bottom:8px;">
              <b style="font-family:monospace;font-size:26px;color:#16a34a;">${currentDraw.winningNumber}</b>
              <div style="flex:1;">
                <div style="font-weight:700;">${w.name}</div>
                <div style="font-size:12.5px;color:#6b7280;">${fmt(w.amount)}</div>
              </div>
              <b style="font-size:16px;">${fmt(w.payout)}</b>
            </div>`).join('')}` : ''}
        ${kaCard}
      ` : ''}
    </div>`;
}

window.lotSettle = async function() {
  const winNum = document.getElementById('lotWinNum').value.trim();
  if (!/^\d{2}$/.test(winNum)) { alert('ဂဏန်း ၂ လုံး ထည့်ပါ (00-99)'); return; }

  const t = drawTotals();
  const winNet = Math.max(0, t.perNum[winNum] || 0);
  const payout = winNet * settings.payoutMult;
  const globalComm = Math.round(t.netSales * settings.commissionRate / 100);

  const agentTotals = {};
  currentDraw.bets.forEach(b => agentTotals[b.agentId] = (agentTotals[b.agentId] || 0) + b.amount);
  let perAgentComm = 0;
  Object.entries(agentTotals).forEach(([aid, total]) => {
    const ag = agents.find(a => a.id === aid);
    if (ag && ag.comm) perAgentComm += Math.round(total * ag.comm / 100);
  });

  const commission = globalComm + perAgentComm;
  const pl = t.netSales - commission - payout;

  const winnersMap = {};
  currentDraw.bets.filter(b => b.number === winNum).forEach(b => {
    if (!winnersMap[b.agentId]) winnersMap[b.agentId] = { name: b.agentName, amount: 0 };
    winnersMap[b.agentId].amount += b.amount;
  });
  const winners = Object.values(winnersMap).map(w => ({ ...w, payout: w.amount * settings.payoutMult }));

  currentDraw.status = 'settled';
  currentDraw.winningNumber = winNum;
  currentDraw.totals = { sales: t.totalBets, netSales: t.netSales, winNet, commission, globalComm, perAgentComm, payout, pl, winners };
  await saveDraw();

  await feedWeekly(currentDraw.date, currentDraw.session, t.netSales, winNet);

  renderDrawDetail();
};

async function feedWeekly(dateStr, session, netSales, winNet) {
  try {
    const d = new Date(dateStr);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return;
    const monday = new Date(d);
    monday.setDate(d.getDate() - (dow - 1));
    const weekStart = localISO(monday);
    const rowIdx = (dow - 1) * 2 + (session === 'evening' ? 1 : 0);

    const ref = doc(db, 'users', uid, 'weeks', weekStart);
    const snap = await getDoc(ref);
    let data = snap.exists() ? snap.data() : {
      weekStart,
      commRate: String(settings.commissionRate),
      payoutMult: String(settings.payoutMult),
      rows: Array.from({ length: 10 }, () => ({ bet: '', win: '' })),
    };
    const rows = (data.rows || Array.from({ length: 10 }, () => ({ bet: '', win: '' }))).map(r => ({ ...r }));
    rows[rowIdx] = { bet: String(netSales), win: String(winNet) };
    await setDoc(ref, { ...data, rows, updatedAt: new Date().toISOString() });
    window.invalidateWeeksCache?.();
  } catch (e) {
    console.error('feedWeekly failed', e);
  }
}

// =====================================================
// LOTTERY SETTINGS VIEW
// =====================================================
export async function renderLotSettings() {
  const el = document.getElementById('lotsetView');
  if (!db || !uid) return needCloud(el);
  el.innerHTML = `<div class="card" style="text-align:center;color:#9ca3af;">Loading...</div>`;
  await ensureLoaded();

  el.innerHTML = `
    <div class="card">
      <h3>👥 ထိုးသားများ</h3>
      <div style="display:flex;gap:6px;margin-bottom:10px;">
        <input id="lotAgName" placeholder="နာမည်" style="flex:2;border:1.5px solid var(--border);border-radius:10px;padding:9px;font-family:inherit;">
        <input id="lotAgComm" placeholder="ကော် %" type="number" inputmode="decimal" style="flex:1;border:1.5px solid var(--border);border-radius:10px;padding:9px;font-family:inherit;">
        <button onclick="lotAddAgent()" class="nav-btn" style="width:auto;padding:0 14px;font-size:13px;">+ ထည့်</button>
      </div>
      ${agents.map(a => `
        <div class="week-row">
          <div class="wk-info"><div class="wk-date">${a.name}</div></div>
          <span style="color:#d97706;font-weight:700;">${a.comm || 0}%</span>
          <button onclick="lotEditAgent('${a.id}')" style="background:none;border:none;font-size:15px;cursor:pointer;">✏️</button>
          <button onclick="lotDelAgent('${a.id}')" style="background:none;border:none;font-size:15px;cursor:pointer;">🗑️</button>
        </div>`).join('') || '<p style="color:#9ca3af;font-size:13px;text-align:center;">မရှိသေးပါ</p>'}
    </div>

    <div class="card">
      <h3>⚙️ 2D Settings</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
        <label style="font-size:11px;color:#6b7280;font-weight:700;">Limit<input id="lotSetLimit" type="number" inputmode="numeric" value="${settings.defaultLimit}" style="width:100%;border:1.5px solid var(--border);border-radius:8px;padding:8px;font-family:inherit;font-weight:700;margin-top:3px;"></label>
        <label style="font-size:11px;color:#6b7280;font-weight:700;">ကော် %<input id="lotSetComm" type="number" inputmode="decimal" value="${settings.commissionRate}" style="width:100%;border:1.5px solid var(--border);border-radius:8px;padding:8px;font-family:inherit;font-weight:700;margin-top:3px;"></label>
        <label style="font-size:11px;color:#6b7280;font-weight:700;">လျော် ×<input id="lotSetPayout" type="number" inputmode="numeric" value="${settings.payoutMult}" style="width:100%;border:1.5px solid var(--border);border-radius:8px;padding:8px;font-family:inherit;font-weight:700;margin-top:3px;"></label>
      </div>
      <button onclick="lotSaveSettings()" style="width:100%;padding:12px;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:white;border:none;border-radius:10px;font-weight:800;font-family:inherit;cursor:pointer;" id="lotSaveBtn">💾 သိမ်းမည်</button>
    </div>

    <div class="card">
      <h3>🚫 ပိတ်ဂဏန်းများ</h3>
      <div style="display:flex;gap:6px;margin-bottom:10px;">
        <input id="lotBlockNum" maxlength="2" inputmode="numeric" placeholder="00" style="width:70px;text-align:center;font-family:monospace;font-weight:700;border:1.5px solid var(--border);border-radius:10px;padding:9px;">
        <button onclick="lotAddBlocked()" style="background:#dc2626;color:white;border:none;border-radius:10px;padding:9px 16px;font-weight:700;font-family:inherit;cursor:pointer;">ပိတ်</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${(settings.blocked || []).map(n => `
          <span style="background:#fee2e2;color:#991b1b;border-radius:999px;padding:5px 12px;font-family:monospace;font-weight:800;font-size:13px;">
            ${n} <button onclick="lotDelBlocked('${n}')" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:13px;">×</button>
          </span>`).join('') || '<span style="color:#9ca3af;font-size:13px;">မရှိပါ</span>'}
      </div>
    </div>

    <div class="card">
      <h3>🎯 နံပါတ်အလိုက် Limit</h3>
      <div style="display:flex;gap:6px;margin-bottom:10px;">
        <input id="lotLimNum" maxlength="2" inputmode="numeric" placeholder="00" style="width:70px;text-align:center;font-family:monospace;font-weight:700;border:1.5px solid var(--border);border-radius:10px;padding:9px;">
        <input id="lotLimAmt" type="number" inputmode="numeric" placeholder="ပမာဏ" style="flex:1;border:1.5px solid var(--border);border-radius:10px;padding:9px;font-family:inherit;">
        <button onclick="lotAddLimit()" class="nav-btn" style="width:auto;padding:0 14px;font-size:13px;">သတ်မှတ်</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${Object.entries(settings.limits || {}).map(([n, v]) => `
          <span style="background:#dbeafe;color:#1e40af;border-radius:999px;padding:5px 12px;font-size:12.5px;font-weight:700;">
            <span style="font-family:monospace;">${n}</span>: ${fmt(v)} <button onclick="lotDelLimit('${n}')" style="background:none;border:none;color:#1e40af;cursor:pointer;">×</button>
          </span>`).join('') || '<span style="color:#9ca3af;font-size:13px;">Custom limit မရှိ (default သုံး)</span>'}
      </div>
    </div>

    <div class="card">
      <h3>⚠️ Danger Zone</h3>
      <button onclick="lotDeleteAllDraws()"
        style="width:100%;padding:12px;background:linear-gradient(135deg,#ef4444,#dc2626);color:white;border:none;border-radius:10px;font-weight:800;font-family:inherit;cursor:pointer;">
        🗑️ 2D Draw Data အားလုံး ဖျက်မည်
      </button>
      <p style="font-size:11px;color:#9ca3af;margin-top:6px;text-align:center;">Draw + ထိုးငွေအားလုံး ပျက်မယ် (Weekly tracker data မပါ)</p>
    </div>`;
}

window.lotDeleteAllDraws = async function() {
  if (!confirm('Draw data အားလုံး ဖျက်မှာ သေချာလား?')) return;
  if (!confirm('နောက်ဆုံး အတည်ပြုချက် — ပြန်ယူလို့ မရတော့ပါ!')) return;
  const snap = await getDocs(collection(db, 'users', uid, 'draws'));
  const deletions = [];
  snap.forEach(d => deletions.push(deleteDoc(doc(db, 'users', uid, 'draws', d.id))));
  await Promise.all(deletions);
  alert('✓ ဖျက်ပြီးပါပြီ');
  renderDrawList?.();
  window.switchView('draws');
};

window.lotAddAgent = async function() {
  const name = document.getElementById('lotAgName').value.trim();
  const comm = Number(document.getElementById('lotAgComm').value || 0);
  if (!name) return;
  const id = genId();
  await setDoc(doc(db, 'users', uid, 'agents', id), { name, comm });
  agents.push({ id, name, comm });
  agents.sort((a, b) => a.name.localeCompare(b.name));
  renderLotSettings();
};

window.lotEditAgent = async function(id) {
  const a = agents.find(x => x.id === id);
  if (!a) return;
  const name = prompt('နာမည်:', a.name);
  if (name === null) return;
  const comm = prompt('ကော် %:', a.comm || 0);
  if (comm === null) return;
  a.name = name.trim() || a.name;
  a.comm = Number(comm) || 0;
  await setDoc(doc(db, 'users', uid, 'agents', id), { name: a.name, comm: a.comm });
  renderLotSettings();
};

window.lotDelAgent = async function(id) {
  if (!confirm('ဒီထိုးသားကို ဖျက်မလား?')) return;
  await deleteDoc(doc(db, 'users', uid, 'agents', id));
  agents = agents.filter(a => a.id !== id);
  renderLotSettings();
};

window.lotSaveSettings = async function() {
  settings.defaultLimit = Number(document.getElementById('lotSetLimit').value || 50000);
  settings.commissionRate = Number(document.getElementById('lotSetComm').value || 18);
  settings.payoutMult = Number(document.getElementById('lotSetPayout').value || 80);
  await saveSettings();
  const btn = document.getElementById('lotSaveBtn');
  btn.textContent = '✓ သိမ်းပြီး!';
  setTimeout(() => btn.textContent = '💾 သိမ်းမည်', 1500);
};

window.lotAddBlocked = async function() {
  const n = document.getElementById('lotBlockNum').value.trim();
  if (!/^\d{2}$/.test(n)) return;
  if (!settings.blocked) settings.blocked = [];
  if (!settings.blocked.includes(n)) settings.blocked.push(n);
  await saveSettings();
  renderLotSettings();
};
window.lotDelBlocked = async function(n) {
  settings.blocked = (settings.blocked || []).filter(x => x !== n);
  await saveSettings();
  renderLotSettings();
};

window.lotAddLimit = async function() {
  const n = document.getElementById('lotLimNum').value.trim();
  const amt = Number(document.getElementById('lotLimAmt').value || 0);
  if (!/^\d{2}$/.test(n) || amt <= 0) return;
  if (!settings.limits) settings.limits = {};
  settings.limits[n] = amt;
  await saveSettings();
  renderLotSettings();
};
window.lotDelLimit = async function(n) {
  delete (settings.limits || {})[n];
  await saveSettings();
  renderLotSettings();
};
