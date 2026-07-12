// ===== Luck Max — 2D Dealer Module (Firestore) =====
import {
  doc, setDoc, getDoc, getDocs, collection, deleteDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

let db = null, uid = null;
let settings = { defaultLimit: 50000, commissionRate: 18, payoutMult: 80, blocked: [], limits: {} };
let agents = [];
let loaded = false;
let currentDraw = null;
let currentTab = 'new';

const fmt = (n) => Number(n || 0).toLocaleString();
const fmtSigned = (n) => (Number(n) > 0 ? '+' : '') + Number(n || 0).toLocaleString();
const genId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function initLottery(database, userId) {
  db = database;
  uid = userId;
  loaded = false;
}

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
// DRAW LIST VIEW
// =====================================================
export async function renderDrawList() {
  const el = document.getElementById('drawsView');
  if (!db || !uid) return needCloud(el);
  el.innerHTML = `<div class="card" style="text-align:center;color:#9ca3af;">Loading...</div>`;
  await ensureLoaded();

  const snap = await getDocs(query(collection(db, 'users', uid, 'draws'), orderBy('date', 'desc')));
  const draws = [];
  snap.forEach(d => draws.push(d.data()));
  draws.sort((a, b) => b.date.localeCompare(a.date) || (b.session === 'evening' ? 1 : -1));

  el.innerHTML = `
    <div class="card">
      <h3>🎯 2D Draw များ</h3>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <input type="date" id="lotNewDate" value="${new Date().toISOString().slice(0,10)}"
               style="flex:1;border:1.5px solid var(--border);border-radius:10px;padding:10px;font-family:inherit;font-weight:600;">
        <select id="lotNewSession" style="border:1.5px solid var(--border);border-radius:10px;padding:10px;font-family:inherit;font-weight:600;">
          <option value="morning">မနက်</option>
          <option value="evening">ည</option>
        </select>
        <button onclick="lotCreateDraw()" class="nav-btn" style="width:auto;padding:0 16px;font-size:14px;">+ ဖွင့်</button>
      </div>
      <div id="lotDrawList">
        ${draws.length === 0 ? '<p style="color:#9ca3af;text-align:center;padding:12px;font-size:13px;">Draw မရှိသေးပါ</p>' :
          draws.map(d => {
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
      </div>
    </div>`;
}

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
const SHORTCUTS = [
  { label: 'အပူး', fn: () => ['00','11','22','33','44','55','66','77','88','99'] },
  { label: 'စုံစုံ', fn: () => pairs(d=>d%2===0, d=>d%2===0) },
  { label: 'မမ', fn: () => pairs(d=>d%2===1, d=>d%2===1) },
  { label: 'စုံမ', fn: () => pairs(d=>d%2===0, d=>d%2===1) },
  { label: 'မစုံ', fn: () => pairs(d=>d%2===1, d=>d%2===0) },
  { label: 'ညီကို', fn: () => ['01','12','23','34','45','56','67','78','89'] },
  { label: 'ကိုညီ', fn: () => ['10','21','32','43','54','65','76','87','98'] },
  { label: 'ထိပ်', digit: true, fn: (n) => Array.from({length:10},(_,i)=>n+String(i)) },
  { label: 'ပိတ်', digit: true, fn: (n) => Array.from({length:10},(_,i)=>String(i)+n) },
  { label: 'ဘရိတ်', digit: true, fn: (n) => [...new Set(Array.from({length:10},(_,i)=>n+String(i)).concat(Array.from({length:10},(_,i)=>String(i)+n)))] },
];
function pairs(f1, f2) {
  const out = [];
  for (let i=0;i<10;i++) for (let j=0;j<10;j++) if (f1(i)&&f2(j)) out.push(String(i)+String(j));
  return out;
}

function renderBetEntry(el) {
  el.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:8px;margin-bottom:10px;">
        <select id="lotAgent" style="flex:1;border:1.5px solid var(--border);border-radius:10px;padding:10px;font-family:inherit;font-weight:600;">
          ${agents.length === 0 ? '<option value="">— ထိုးသား မရှိ (Settings မှာထည့်ပါ) —</option>' :
            agents.map(a => `<option value="${a.id}">${a.name}${a.comm ? ' /'+a.comm+'%' : ''}</option>`).join('')}
        </select>
      </div>
      <textarea id="lotBetInput" rows="4" placeholder="12.34.56d 5000, 78r 1000&#10;(d=ထိုး  r=ပတ်  , နဲ့ခြား)"
        style="width:100%;border:1.5px solid var(--border);border-radius:12px;padding:12px;font-family:monospace;font-size:15px;resize:vertical;"></textarea>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0;">
        ${SHORTCUTS.map((s,i) => `<button onclick="lotShortcut(${i})"
          style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;">${s.label}</button>`).join('')}
      </div>
      <button onclick="lotSubmitBets()" ${currentDraw.status==='settled'?'disabled':''}
        style="width:100%;padding:14px;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:white;border:none;border-radius:12px;font-size:15px;font-weight:800;font-family:inherit;cursor:pointer;${currentDraw.status==='settled'?'opacity:0.5;':''}">
        ${currentDraw.status==='settled' ? '🔒 ရှင်းပြီးသား Draw' : 'ထည့်မည်'}
      </button>
      <div id="lotBetResult"></div>
    </div>`;
}

window.lotShortcut = function(i) {
  const s = SHORTCUTS[i];
  let nums;
  if (s.digit) {
    const d = prompt('ဂဏန်း (0-9):');
    if (d === null || !/^[0-9]$/.test(d.trim())) return;
    nums = s.fn(d.trim());
  } else {
    nums = s.fn();
  }
  const ta = document.getElementById('lotBetInput');
  ta.value += (ta.value && !ta.value.endsWith('\n') && !ta.value.endsWith(' ') ? ', ' : '') + nums.join('.') + 'd ';
  ta.focus();
};

function parseBetInput(text) {
  const entries = [];
  const parts = text.replace(/=/g, ' ').split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^([\d.\s]+?)\s*([drDR])?\s+(\d+)$/);
    if (!m) continue;
    const nums = m[1].split(/[.\s]+/).filter(n => /^\d{2}$/.test(n));
    const type = (m[2] || 'd').toLowerCase();
    const amount = parseInt(m[3]);
    if (!amount) continue;
    for (const n of nums) {
      entries.push({ number: n, amount });
      if (type === 'r' && n[0] !== n[1]) entries.push({ number: n[1] + n[0], amount });
    }
  }
  return entries;
}

window.lotSubmitBets = async function() {
  if (currentDraw.status === 'settled') return;
  const agentId = document.getElementById('lotAgent').value;
  if (!agentId) { alert('ထိုးသား အရင်ရွေးပါ (Settings မှာ ထည့်လို့ရတယ်)'); return; }
  const agent = agents.find(a => a.id === agentId);
  const text = document.getElementById('lotBetInput').value;
  const entries = parseBetInput(text);
  if (entries.length === 0) { alert('Format မမှန်ပါ။ ဥပမာ: 12.34d 5000'); return; }

  // current accepted totals per number
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

  let html = '<div style="margin-top:12px;font-size:13px;">';
  if (blockedSkipped.length) {
    html += `<div style="background:#fee2e2;color:#991b1b;border-radius:10px;padding:10px;margin-bottom:8px;font-weight:700;">🚫 ပိတ်ဂဏန်း (မလက်ခံ): ${[...new Set(blockedSkipped)].join(', ')}</div>`;
  }
  html += results.map(r => `
    <div style="display:flex;justify-content:space-between;padding:7px 10px;border-radius:8px;margin-bottom:3px;background:${r.over>0?'#fef3c7':'#f0fdf4'};">
      <b style="font-family:monospace;">${r.number}</b>
      <span>လက်ခံ ${fmt(r.acc)}${r.over>0 ? ` <b style="color:#d97706;">| ကာ ${fmt(r.over)}</b>` : ''}</span>
    </div>`).join('');
  html += '</div>';

  renderDrawDetail();
  // show result after re-render
  setTimeout(() => { const rb = document.getElementById('lotBetResult'); if (rb) rb.innerHTML = html; }, 50);
};

// ===== TAB: Bet list + agent summary =====
function renderBetList(el) {
  const bets = [...currentDraw.bets].sort((a, b) => b.ts - a.ts);

  // per-agent summary
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
      <h3>📝 ထိုးစာရင်း (${bets.length})</h3>
      <div style="max-height:400px;overflow-y:auto;">
      ${bets.map(b => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 6px;border-bottom:1px solid #f3f4f6;font-size:13px;">
          <b style="font-family:monospace;font-size:16px;color:var(--primary-dark);width:30px;">${b.number}</b>
          <span style="flex:1;color:#6b7280;">${b.agentName}</span>
          <b>${fmt(b.amount)}</b>
          ${currentDraw.status!=='settled' ? `<button onclick="lotDeleteBet('${b.id}')" style="background:none;border:none;cursor:pointer;">🗑️</button>` : ''}
        </div>`).join('') || '<p style="color:#9ca3af;font-size:13px;text-align:center;">မရှိသေးပါ</p>'}
      </div>
    </div>`;
}

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
  // group numbers by amount
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

// ===== TAB: Grid =====
function renderGrid(el) {
  const t = drawTotals();
  let maxNum = '—', maxPot = 0;
  const cells = [];
  for (let i = 0; i < 100; i++) {
    const num = String(i).padStart(2, '0');
    const net = Math.max(0, t.perNum[num] || 0);
    const limit = (settings.limits || {})[num] ?? settings.defaultLimit;
    const pot = net * settings.payoutMult;
    if (pot > maxPot) { maxPot = pot; maxNum = num; }
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
    </div>`;
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
  // merge same numbers
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

  el.innerHTML = `
    <div class="card">
      <h3>🏆 ပေါက်ဂဏန်း</h3>
      ${pendingKa > 0 ? `<div style="background:#fef3c7;color:#92400e;border-radius:10px;padding:9px 12px;font-size:12.5px;font-weight:600;margin-bottom:10px;">⚠️ မပို့ရသေးတဲ့ ကာ ${pendingKa} ခု ရှိနေတယ် — ပို့ပြီးမှတ်မှ Net ထဲက နှုတ်မယ်</div>` : ''}
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;">
        <input id="lotWinNum" maxlength="2" inputmode="numeric" placeholder="00" value="${currentDraw.winningNumber || ''}"
          style="width:80px;text-align:center;font-size:30px;font-weight:900;font-family:monospace;border:2px solid var(--primary);border-radius:12px;padding:8px;color:#dc2626;">
        <button onclick="lotSettle()"
          style="flex:1;padding:14px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:white;border:none;border-radius:12px;font-size:15px;font-weight:800;font-family:inherit;cursor:pointer;">
          ${settled ? '🔄 ပြန်ရှင်းမည်' : 'ရှင်းမည်'}
        </button>
      </div>
      ${settled ? `
        <div style="background:#f9fafb;border-radius:12px;padding:14px;font-size:13.5px;">
          <div style="display:flex;justify-content:space-between;padding:5px 0;"><span style="color:#6b7280;">ရောင်းရ (Net)</span><b>${fmt(tot.netSales)}</b></div>
          <div style="display:flex;justify-content:space-between;padding:5px 0;"><span style="color:#6b7280;">ပေါက်ဂဏန်း ထိုးငွေ</span><b>${fmt(tot.winNet)}</b></div>
          <div style="display:flex;justify-content:space-between;padding:5px 0;"><span style="color:#6b7280;">ကော် (${settings.commissionRate}% + ထိုးသား)</span><b style="color:#d97706;">-${fmt(tot.commission)}</b></div>
          <div style="display:flex;justify-content:space-between;padding:5px 0;"><span style="color:#6b7280;">လျော်ကြေး ×${settings.payoutMult}</span><b style="color:#dc2626;">-${fmt(tot.payout)}</b></div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #e5e7eb;margin-top:4px;font-size:16px;">
            <b>အမြတ်/အရှုံး</b><b class="${tot.pl>=0?'positive':'negative'}">${fmtSigned(tot.pl)}</b>
          </div>
          <div style="text-align:center;margin-top:8px;font-size:11.5px;color:#16a34a;font-weight:700;">✓ Weekly Tracker ထဲ auto ထည့်ပြီး</div>
        </div>
        ${(tot.winners||[]).length > 0 ? `
          <h3 style="margin-top:14px;">🎉 နိုင်သူများ</h3>
          ${tot.winners.map(w => `
            <div style="display:flex;justify-content:space-between;padding:8px 10px;background:#f0fdf4;border-radius:10px;margin-bottom:5px;font-size:13px;">
              <b>${w.name}</b>
              <span>${fmt(w.amount)} → <b style="color:#16a34a;">${fmt(w.payout)}</b></span>
            </div>`).join('')}` : ''}
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

  // per-agent commission
  const agentTotals = {};
  currentDraw.bets.forEach(b => agentTotals[b.agentId] = (agentTotals[b.agentId] || 0) + b.amount);
  let perAgentComm = 0;
  Object.entries(agentTotals).forEach(([aid, total]) => {
    const ag = agents.find(a => a.id === aid);
    if (ag && ag.comm) perAgentComm += Math.round(total * ag.comm / 100);
  });

  const commission = globalComm + perAgentComm;
  const pl = t.netSales - commission - payout;

  // winners
  const winnersMap = {};
  currentDraw.bets.filter(b => b.number === winNum).forEach(b => {
    if (!winnersMap[b.agentId]) winnersMap[b.agentId] = { name: b.agentName, amount: 0 };
    winnersMap[b.agentId].amount += b.amount;
  });
  const winners = Object.values(winnersMap).map(w => ({ ...w, payout: w.amount * settings.payoutMult }));

  currentDraw.status = 'settled';
  currentDraw.winningNumber = winNum;
  currentDraw.totals = { sales: t.totalBets, netSales: t.netSales, winNet, commission, payout, pl, winners };
  await saveDraw();

  // === Auto-feed weekly tracker ===
  await feedWeekly(currentDraw.date, currentDraw.session, t.netSales, winNet);

  renderDrawDetail();
};

async function feedWeekly(dateStr, session, netSales, winNet) {
  try {
    const d = new Date(dateStr);
    const dow = d.getDay(); // 0=Sun
    if (dow === 0 || dow === 6) return; // weekend — tracker covers Mon-Fri
    const monday = new Date(d);
    monday.setDate(d.getDate() - (dow - 1));
    const weekStart = monday.toISOString().slice(0, 10);
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
    </div>`;
}

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
