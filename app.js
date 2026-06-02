import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut as fbSignOut,
  onAuthStateChanged, sendPasswordResetEmail, setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, collection, getDocs, query, orderBy, deleteDoc,
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig, FIREBASE_ENABLED } from "./firebase-config.js";

const SESSIONS = [
  { day: 1, dayName: 'တနင်္လာ', session: 'morning', label: 'မနက်' },
  { day: 1, dayName: 'တနင်္လာ', session: 'evening', label: 'ည' },
  { day: 2, dayName: 'အင်္ဂါ',   session: 'morning', label: 'မနက်' },
  { day: 2, dayName: 'အင်္ဂါ',   session: 'evening', label: 'ည' },
  { day: 3, dayName: 'ဗုဒ္ဓ',     session: 'morning', label: 'မနက်' },
  { day: 3, dayName: 'ဗုဒ္ဓ',     session: 'evening', label: 'ည' },
  { day: 4, dayName: 'ကြာသပ',  session: 'morning', label: 'မနက်' },
  { day: 4, dayName: 'ကြာသပ',  session: 'evening', label: 'ည' },
  { day: 5, dayName: 'သောကြာ', session: 'morning', label: 'မနက်' },
  { day: 5, dayName: 'သောကြာ', session: 'evening', label: 'ည' },
];

const MONTH_NAMES = ['ဇန်နဝါရီ', 'ဖေဖော်ဝါရီ', 'မတ်', 'ဧပြီ', 'မေ', 'ဇွန်',
                     'ဇူလိုင်', 'သြဂုတ်', 'စက်တင်ဘာ', 'အောက်တိုဘာ', 'နိုဝင်ဘာ', 'ဒီဇင်ဘာ'];

let app, auth, db, currentUser = null;
let saveTimer = null;
let activeInput = null;
let numpadValue = '';
let allWeeksCache = null; // cached for calendar/monthly views
let currentMonth = new Date(); // for calendar/monthly navigation

const fmt = (n) => Number(n || 0).toLocaleString();
const fmtSigned = (n) => (Number(n) > 0 ? '+' : '') + Number(n || 0).toLocaleString();
const fmtShort = (n) => {
  const num = Number(n || 0);
  const abs = Math.abs(num);
  if (abs >= 1000000) return (num >= 0 ? '+' : '-') + (abs / 1000000).toFixed(1) + 'M';
  if (abs >= 1000) return (num >= 0 ? '+' : '-') + (abs / 1000).toFixed(0) + 'K';
  return String(num);
};

// Always use full number format (user preference)
const fmtAuto = (n) => Number(n || 0).toLocaleString();
const fmtAutoSigned = (n) => {
  const num = Number(n || 0);
  return (num > 0 ? '+' : '') + num.toLocaleString();
};

// ===== Firebase =====
async function initFirebase() {
  if (!FIREBASE_ENABLED || firebaseConfig.apiKey === "YOUR_API_KEY") {
    document.getElementById('loginStatus').innerHTML =
      '⚠️ Firebase မ-config ထား<br>localStorage သုံးပါမယ်';
    setTimeout(() => {
      currentUser = { uid: 'local-user', email: 'Local Mode' };
      showApp();
    }, 1200);
    return;
  }
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    // Initialize Firestore with offline persistence (IndexedDB cache)
    try {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
      });
    } catch (e) {
      console.warn('Persistent cache init failed, falling back to default:', e);
      db = getFirestore(app);
    }
    // Persist login across browser restarts
    try { await setPersistence(auth, browserLocalPersistence); } catch (e) { /* ignore */ }
    onAuthStateChanged(auth, (user) => {
      if (user) { currentUser = user; showApp(); } else showLogin();
    });
  } catch (e) {
    document.getElementById('loginStatus').textContent = '❌ ' + e.message;
  }
}

let authMode = 'login'; // 'login' or 'signup'

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('bottomNav').style.display = 'none';
  document.getElementById('loginStatus').style.display = 'none';
  document.getElementById('authForm').style.display = 'block';
}

window.switchAuthTab = function(mode) {
  authMode = mode;
  document.getElementById('loginTab').classList.toggle('active', mode === 'login');
  document.getElementById('signupTab').classList.toggle('active', mode === 'signup');
  document.getElementById('confirmGroup').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('pwHint').style.display = mode === 'signup' ? 'inline' : 'none';
  document.getElementById('submitBtn').textContent = mode === 'signup' ? '✨ အကောင့်ဖန်တီးမည်' : '📧 ဝင်မည်';
  document.getElementById('forgotBtn').style.display = mode === 'login' ? 'block' : 'none';
  document.getElementById('authError').style.display = 'none';
  document.getElementById('passwordInput').setAttribute('autocomplete', mode === 'signup' ? 'new-password' : 'current-password');
};

function showError(message) {
  const errBox = document.getElementById('authError');
  errBox.innerHTML = '⚠️ ' + message;
  errBox.style.display = 'block';
}

function getErrorMessage(e) {
  const map = {
    'auth/invalid-email': 'Email format မမှန်ပါ',
    'auth/user-not-found': 'ဒီ Email နဲ့ account မရှိပါ — အသစ်ဖန်တီးပါ',
    'auth/wrong-password': 'Password မမှန်ပါ',
    'auth/invalid-credential': 'Email/Password မမှန်ပါ',
    'auth/email-already-in-use': 'ဒီ Email အသုံးပြုပြီး — ဝင်ပါ',
    'auth/weak-password': 'Password အနည်းဆုံး ၆ လုံး လိုပါတယ်',
    'auth/operation-not-allowed': 'Firebase Console → Authentication → Email/Password Enable လုပ်ပါ',
    'auth/unauthorized-domain': 'ဒီ domain မ-authorized — Firebase Settings မှာ ထည့်ပါ',
    'auth/network-request-failed': 'Internet connection စစ်ပါ',
    'auth/too-many-requests': 'အကြိမ်ရေများလွန်း — ခဏစောင့်ပါ',
  };
  return map[e.code] || (e.code || 'Error') + ': ' + (e.message || '');
}

window.submitAuth = async function() {
  if (!auth) { showError('Firebase မချိတ်ရသေးပါ'); return; }
  const email = document.getElementById('emailInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  const submitBtn = document.getElementById('submitBtn');
  document.getElementById('authError').style.display = 'none';

  if (!email || !password) { showError('Email နဲ့ Password ထည့်ပါ'); return; }
  if (password.length < 6) { showError('Password ၆ လုံး လိုပါတယ်'); return; }

  if (authMode === 'signup') {
    const confirm = document.getElementById('confirmInput').value;
    if (password !== confirm) { showError('Password နှစ်ခု မတူပါ'); return; }
  }

  submitBtn.disabled = true;
  submitBtn.textContent = '⏳ စောင့်ပါ...';

  try {
    if (authMode === 'signup') {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (e) {
    console.error('Auth error:', e);
    showError(getErrorMessage(e));
    submitBtn.disabled = false;
    submitBtn.textContent = authMode === 'signup' ? '✨ အကောင့်ဖန်တီးမည်' : '📧 ဝင်မည်';
  }
};

window.forgotPassword = async function() {
  if (!auth) return;
  const email = document.getElementById('emailInput').value.trim();
  if (!email) { showError('Email အရင်ထည့်ပါ'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    showError('✓ Reset link ' + email + ' ထဲ ပို့ပြီး — Inbox စစ်ပါ');
    document.getElementById('authError').style.background = '#dcfce7';
    document.getElementById('authError').style.color = '#166534';
    document.getElementById('authError').style.borderColor = '#86efac';
  } catch (e) {
    showError(getErrorMessage(e));
  }
};

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('bottomNav').style.display = 'flex';
  document.getElementById('userInfo').textContent = currentUser.email || 'Local mode';
  if (currentUser.uid.startsWith('local')) {
    document.getElementById('storageMode').textContent = '💾 Local storage';
  } else {
    document.getElementById('storageMode').textContent = '☁️ Cloud sync — ' + currentUser.email;
  }

  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  document.getElementById('weekStart').value = monday.toISOString().slice(0, 10);
  currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  buildTable();
  loadWeek();
  setupNumpad();
}

window.signOut = async () => {
  if (!confirm('Sign out လုပ်မလား?')) return;
  if (auth) await fbSignOut(auth);
  currentUser = null;
  showLogin();
};

// ===== View switching =====
window.switchView = function(view) {
  document.getElementById('weekView').style.display = view === 'week' ? 'block' : 'none';
  document.getElementById('calendarView').style.display = view === 'calendar' ? 'block' : 'none';
  document.getElementById('monthlyView').style.display = view === 'monthly' ? 'block' : 'none';

  document.getElementById('navWeek').classList.toggle('active', view === 'week');
  document.getElementById('navCalendar').classList.toggle('active', view === 'calendar');
  document.getElementById('navMonthly').classList.toggle('active', view === 'monthly');

  const titles = { week: 'Weekly P/L', calendar: 'Calendar', monthly: 'Monthly' };
  document.getElementById('pageTitle').textContent = titles[view];

  if (view === 'calendar') renderCalendar();
  if (view === 'monthly') renderMonthly();
};

// ===== Week View =====
function buildTable() {
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = '';
  SESSIONS.forEach((s, i) => {
    const isEvening = s.session === 'evening';
    const tr = document.createElement('tr');
    if (isEvening) tr.classList.add('day-end');
    tr.innerHTML = `
      <td class="idx">
        <span class="idx-num">${i + 1}</span>
        <span class="idx-sess">${s.label}</span>
      </td>
      <td class="input-cell bet">
        <input type="text" id="bet_${i}" readonly placeholder="0"
               onclick="openNumpad(this, ${i}, 'bet')">
      </td>
      <td class="input-cell win">
        <input type="text" id="win_${i}" readonly placeholder="0"
               onclick="openNumpad(this, ${i}, 'win')">
      </td>
      <td class="pl-cell" id="pl_${i}">0</td>
      <td class="daily-cell" id="daily_${i}">${isEvening ? '0' : ''}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ===== Numpad =====
function setupNumpad() {
  document.querySelectorAll('.numpad-key').forEach(btn => {
    btn.addEventListener('click', () => handleKey(btn.dataset.key));
  });
}

window.openNumpad = function(el, i, type) {
  activeInput = { el, i, type };
  const raw = (el.dataset.value || '').replace(/[^0-9]/g, '');
  numpadValue = raw || '';
  updateNumpadDisplay();
  const session = SESSIONS[i];
  const typeLabel = type === 'bet' ? 'စုစုပေါင်း ထိုးငွေ' : 'ပေါက်ဂဏန်း ထိုးငွေ';
  document.getElementById('numpadLabel').textContent =
    `${session.dayName} ${session.label} — ${typeLabel}`;
  document.getElementById('numpad').style.display = 'block';
  document.querySelectorAll('td.input-cell input').forEach(x => { x.style.outline = ''; x.style.background = ''; });
  el.style.outline = '2px solid #16a34a';
  el.style.background = '#f0fdf4';
};

window.closeNumpad = function() {
  document.getElementById('numpad').style.display = 'none';
  if (activeInput) {
    activeInput.el.style.outline = '';
    activeInput.el.style.background = '';
  }
  activeInput = null;
};

function updateNumpadDisplay() {
  const num = Number(numpadValue || 0);
  document.getElementById('numpadDisplay').textContent = num.toLocaleString();
  if (activeInput) {
    activeInput.el.value = num > 0 ? fmtAuto(num) : '';
    activeInput.el.title = num > 0 ? num.toLocaleString() : '';
    activeInput.el.dataset.value = numpadValue;
    recalc();
  }
}

function handleKey(key) {
  if (key === 'C') numpadValue = '';
  else if (key === 'back') numpadValue = numpadValue.slice(0, -1);
  else if (key === 'done') {
    const { i, type } = activeInput || {};
    closeNumpad();
    setTimeout(() => {
      if (type === 'bet') document.getElementById('win_' + i)?.click();
      else document.getElementById('bet_' + (i + 1))?.click();
    }, 80);
    return;
  } else {
    const newVal = (numpadValue + key).replace(/^0+/, '') || '0';
    if (newVal.length > 12) return;
    numpadValue = newVal === '0' ? '' : newVal;
  }
  updateNumpadDisplay();
}

function getValue(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const raw = (el.dataset.value !== undefined && el.dataset.value !== '')
    ? el.dataset.value
    : (el.value || '').replace(/[^0-9]/g, '');
  return Number(raw || 0);
}

// ===== Calculation =====
window.recalc = function() {
  const commRate = Number(document.getElementById('commRate').value) / 100;
  const payoutMult = Number(document.getElementById('payoutMult').value);
  let totBets = 0, totComm = 0, totPay = 0, totPL = 0, totWin = 0;
  const sessionPLs = [];

  for (let i = 0; i < SESSIONS.length; i++) {
    const bet = getValue('bet_' + i);
    const win = getValue('win_' + i);
    const comm = Math.round(bet * commRate);
    const payout = win * payoutMult;
    const pl = bet - comm - payout;
    sessionPLs[i] = pl;

    const plCell = document.getElementById('pl_' + i);
    if (bet > 0 || win > 0) {
      plCell.textContent = fmtAutoSigned(pl);
      plCell.title = fmtSigned(pl); // full value on hover/long-press
      plCell.className = 'pl-cell ' + (pl >= 0 ? 'positive' : 'negative');
    } else { plCell.textContent = ''; plCell.className = 'pl-cell'; }

    totBets += bet; totWin += win; totComm += comm; totPay += payout; totPL += pl;

    if (SESSIONS[i].session === 'evening') {
      const morningPL = sessionPLs[i - 1] || 0;
      const daily = morningPL + pl;
      const dailyCell = document.getElementById('daily_' + i);
      const morningBet = getValue('bet_' + (i - 1));
      if (morningBet > 0 || bet > 0) {
        dailyCell.textContent = fmtAutoSigned(daily);
        dailyCell.title = fmtSigned(daily);
        dailyCell.className = 'daily-cell ' + (daily >= 0 ? 'positive' : 'negative');
      } else { dailyCell.textContent = ''; dailyCell.className = 'daily-cell'; }
    }
  }

  const sumBetEl = document.getElementById('sumBet');
  const sumWinEl = document.getElementById('sumWin');
  const sumPLEl = document.getElementById('sumPL');
  const grandEl = document.getElementById('grandTotal');
  sumBetEl.textContent = fmtAuto(totBets); sumBetEl.title = fmt(totBets);
  sumWinEl.textContent = fmtAuto(totWin); sumWinEl.title = fmt(totWin);
  sumPLEl.textContent = fmtAutoSigned(totPL); sumPLEl.title = fmtSigned(totPL);
  sumPLEl.style.color = totPL >= 0 ? '#86efac' : '#fca5a5';
  grandEl.textContent = fmtAutoSigned(totPL); grandEl.title = fmtSigned(totPL);

  document.getElementById('qsBet').textContent = fmtAuto(totBets);
  document.getElementById('qsBet').title = fmt(totBets);
  document.getElementById('qsComm').textContent = fmtAuto(totComm);
  document.getElementById('qsComm').title = fmt(totComm);
  document.getElementById('qsPayout').textContent = fmtAuto(totPay);
  document.getElementById('qsPayout').title = fmt(totPay);

  if (saveTimer) clearTimeout(saveTimer);
  document.getElementById('saveStatus').className = 'save-indicator saving';
  saveTimer = setTimeout(saveWeek, 800);
};

window.onNoteChange = function() {
  if (saveTimer) clearTimeout(saveTimer);
  document.getElementById('saveStatus').className = 'save-indicator saving';
  saveTimer = setTimeout(saveWeek, 800);
};

// ===== Save / Load =====
function collectData() {
  const weekStart = document.getElementById('weekStart').value;
  const d = new Date(weekStart);
  return {
    weekStart,
    weekEnd: addDays(weekStart, 4),
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    commRate: document.getElementById('commRate').value,
    payoutMult: document.getElementById('payoutMult').value,
    note: document.getElementById('weekNote').value || '',
    updatedAt: new Date().toISOString(),
    rows: SESSIONS.map((_, i) => ({
      bet: String(getValue('bet_' + i)),
      win: String(getValue('win_' + i)),
    })),
  };
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function saveWeek() {
  const data = collectData();
  if (!data.weekStart) return;
  const key = `weekly_${data.weekStart}`;
  try {
    if (db && currentUser && !currentUser.uid.startsWith('local')) {
      await setDoc(doc(db, 'users', currentUser.uid, 'weeks', data.weekStart), data);
    } else {
      localStorage.setItem(key, JSON.stringify(data));
    }
    document.getElementById('saveStatus').className = 'save-indicator saved';
    allWeeksCache = null; // invalidate
  } catch (e) {
    console.error('Save error', e);
    document.getElementById('saveStatus').className = 'save-indicator error';
    localStorage.setItem(key, JSON.stringify(data));
  }
}

window.loadWeek = async function() {
  const weekStart = document.getElementById('weekStart').value;
  if (!weekStart) return;
  updateWeekLabel(weekStart);

  let data = null;
  try {
    if (db && currentUser && !currentUser.uid.startsWith('local')) {
      const snap = await getDoc(doc(db, 'users', currentUser.uid, 'weeks', weekStart));
      if (snap.exists()) data = snap.data();
    } else {
      const raw = localStorage.getItem(`weekly_${weekStart}`);
      if (raw) data = JSON.parse(raw);
    }
  } catch (e) { console.error(e); }

  for (let i = 0; i < SESSIONS.length; i++) {
    const bet = document.getElementById('bet_' + i);
    const win = document.getElementById('win_' + i);
    if (bet) { bet.value = ''; bet.dataset.value = ''; }
    if (win) { win.value = ''; win.dataset.value = ''; }
  }
  document.getElementById('weekNote').value = '';

  if (data) {
    if (data.commRate) document.getElementById('commRate').value = data.commRate;
    if (data.payoutMult) document.getElementById('payoutMult').value = data.payoutMult;
    if (data.note) document.getElementById('weekNote').value = data.note;
    if (data.rows) {
      data.rows.forEach((r, i) => {
        const betVal = Number(r.bet || 0);
        const winVal = Number(r.win || 0);
        const bel = document.getElementById('bet_' + i);
        const wel = document.getElementById('win_' + i);
        if (betVal > 0 && bel) { bel.value = fmtAuto(betVal); bel.title = fmt(betVal); bel.dataset.value = String(betVal); }
        if (winVal > 0 && wel) { wel.value = fmtAuto(winVal); wel.title = fmt(winVal); wel.dataset.value = String(winVal); }
      });
    }
  }
  recalc();
};

function updateWeekLabel(weekStart) {
  const d = new Date(weekStart);
  const end = new Date(d);
  end.setDate(d.getDate() + 4);
  const fmtDate = (x) => `${x.getDate()}/${x.getMonth() + 1}`;
  document.getElementById('weekLabel').textContent = `${fmtDate(d)} – ${fmtDate(end)}`;
}

window.changeWeek = function(direction) {
  const input = document.getElementById('weekStart');
  const d = new Date(input.value);
  d.setDate(d.getDate() + direction * 7);
  input.value = d.toISOString().slice(0, 10);
  loadWeek();
};

// ===== Load all weeks (for calendar/monthly views) =====
async function loadAllWeeks() {
  if (allWeeksCache) return allWeeksCache;
  const items = [];
  try {
    if (db && currentUser && !currentUser.uid.startsWith('local')) {
      const q = query(collection(db, 'users', currentUser.uid, 'weeks'), orderBy('weekStart', 'desc'));
      const snap = await getDocs(q);
      snap.forEach(d => items.push(d.data()));
    } else {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('weekly_')) items.push(JSON.parse(localStorage.getItem(key)));
      }
      items.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    }
  } catch (e) { console.error(e); }
  allWeeksCache = items;
  return items;
}

// Compute totals for a week data object
function computeWeekTotals(item) {
  const commRate = Number(item.commRate || 18) / 100;
  const payoutMult = Number(item.payoutMult || 80);
  let totBet = 0, totWin = 0, totComm = 0, totPay = 0, totPL = 0;
  const dailyPLs = []; // 5 days
  const sessionPLs = [];

  (item.rows || []).forEach((r, i) => {
    const bet = Number(r.bet || 0);
    const win = Number(r.win || 0);
    const comm = Math.round(bet * commRate);
    const pay = win * payoutMult;
    const pl = bet - comm - pay;
    sessionPLs[i] = pl;
    totBet += bet; totWin += win; totComm += comm; totPay += pay; totPL += pl;
  });
  // 5 days
  for (let d = 0; d < 5; d++) {
    dailyPLs.push((sessionPLs[d * 2] || 0) + (sessionPLs[d * 2 + 1] || 0));
  }
  return { totBet, totWin, totComm, totPay, totPL, dailyPLs };
}

// ===== Calendar View =====
async function renderCalendar() {
  const weeks = await loadAllWeeks();
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  document.getElementById('calMonthLabel').textContent = `${MONTH_NAMES[month]} ${year}`;

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';

  // First day of month
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  // Day of week (Mon=0, Sun=6)
  let startOffset = firstDay.getDay() - 1;
  if (startOffset === -1) startOffset = 6;

  // Build a map: date string → daily P/L
  const dailyPLMap = {};
  const dailyNoteMap = {};
  let monthTotal = 0;
  let monthWeeks = 0;

  weeks.forEach(w => {
    if (!w.weekStart) return;
    const wd = new Date(w.weekStart);
    const totals = computeWeekTotals(w);

    // Check if this week overlaps with current month
    for (let d = 0; d < 5; d++) {
      const day = new Date(wd);
      day.setDate(wd.getDate() + d);
      if (day.getFullYear() === year && day.getMonth() === month) {
        const dayStr = day.toISOString().slice(0, 10);
        dailyPLMap[dayStr] = totals.dailyPLs[d];
        if (w.note) dailyNoteMap[dayStr] = w.note;
        monthTotal += totals.dailyPLs[d];
      }
    }
  });

  // Count weeks that touch this month
  const weekStartsInMonth = new Set();
  weeks.forEach(w => {
    if (!w.weekStart) return;
    const wd = new Date(w.weekStart);
    for (let d = 0; d < 5; d++) {
      const day = new Date(wd);
      day.setDate(wd.getDate() + d);
      if (day.getFullYear() === year && day.getMonth() === month) {
        weekStartsInMonth.add(w.weekStart);
        break;
      }
    }
  });
  monthWeeks = weekStartsInMonth.size;

  // Render header total
  const monthPL = document.getElementById('calMonthPL');
  monthPL.textContent = monthTotal !== 0 ? fmtSigned(monthTotal) : '— data မရှိ —';
  monthPL.className = 'month-sub ' + (monthTotal > 0 ? 'profit' : monthTotal < 0 ? 'loss' : '');

  // Empty leading cells
  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-cell empty';
    grid.appendChild(empty);
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(year, month, d);
    const dateStr = date.toISOString().slice(0, 10);
    const pl = dailyPLMap[dateStr];
    const cell = document.createElement('div');
    cell.className = 'cal-cell';

    if (pl !== undefined && pl !== 0) cell.classList.add(pl > 0 ? 'profit' : 'loss');
    if (dateStr === todayStr) cell.classList.add('today');
    if (date.getDay() === 1) cell.classList.add('week-marker');
    if (dailyNoteMap[dateStr]) cell.classList.add('has-note');

    cell.innerHTML = `
      <div class="day-num">${d}</div>
      ${pl !== undefined && pl !== 0 ? `<div class="day-pl">${fmtShort(pl)}</div>` : ''}
    `;
    cell.onclick = () => {
      // Jump to the week containing this date
      const dt = new Date(date);
      const dayOfWeek = dt.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(dt);
      monday.setDate(dt.getDate() + diff);
      document.getElementById('weekStart').value = monday.toISOString().slice(0, 10);
      switchView('week');
      loadWeek();
    };
    grid.appendChild(cell);
  }

  // Render highlights
  renderMonthHighlights(weeks, year, month, monthTotal, monthWeeks);
}

function renderMonthHighlights(weeks, year, month, monthTotal, monthWeeks) {
  const highlights = document.getElementById('monthHighlights');

  // Find best/worst week in this month
  let bestWeek = null, worstWeek = null;
  const weeksInMonth = [];
  weeks.forEach(w => {
    if (!w.weekStart) return;
    const wd = new Date(w.weekStart);
    let inMonth = false;
    for (let d = 0; d < 5; d++) {
      const day = new Date(wd); day.setDate(wd.getDate() + d);
      if (day.getFullYear() === year && day.getMonth() === month) { inMonth = true; break; }
    }
    if (inMonth) {
      const t = computeWeekTotals(w);
      const entry = { week: w, pl: t.totPL };
      weeksInMonth.push(entry);
      if (!bestWeek || entry.pl > bestWeek.pl) bestWeek = entry;
      if (!worstWeek || entry.pl < worstWeek.pl) worstWeek = entry;
    }
  });

  const items = [
    { label: 'လ စုစုပေါင်း', value: monthTotal, sign: true },
    { label: 'သီတင်းပတ်အရေအတွက်', value: monthWeeks, sign: false },
  ];
  if (bestWeek) items.push({ label: '🏆 အကောင်းဆုံးသီတင်းပတ်', value: bestWeek.pl, sign: true, sub: bestWeek.week.weekStart });
  if (worstWeek && worstWeek !== bestWeek) items.push({ label: '📉 အရှုံးအများဆုံးသီတင်းပတ်', value: worstWeek.pl, sign: true, sub: worstWeek.week.weekStart });
  if (monthWeeks > 0) items.push({ label: 'ပျမ်းမျှ', value: Math.round(monthTotal / monthWeeks), sign: true });

  highlights.innerHTML = items.map(it => `
    <div class="highlight-item">
      <span class="label">${it.label}${it.sub ? `<br><small style="opacity:0.6">${it.sub}</small>` : ''}</span>
      <span class="value ${it.sign ? (it.value >= 0 ? 'positive' : 'negative') : ''}">${it.sign ? fmtSigned(it.value) : it.value}</span>
    </div>
  `).join('');

  if (weeksInMonth.length === 0) {
    highlights.innerHTML = '<p style="color:#9ca3af;font-size:12px;text-align:center;padding:8px;">ဒီလမှာ data မရှိသေးပါ</p>';
  }
}

// ===== Monthly View =====
async function renderMonthly() {
  const weeks = await loadAllWeeks();
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  document.getElementById('monMonthLabel').textContent = `${MONTH_NAMES[month]} ${year}`;

  // Filter weeks in this month
  const weeksInMonth = weeks.filter(w => {
    if (!w.weekStart) return false;
    const wd = new Date(w.weekStart);
    for (let d = 0; d < 5; d++) {
      const day = new Date(wd); day.setDate(wd.getDate() + d);
      if (day.getFullYear() === year && day.getMonth() === month) return true;
    }
    return false;
  });

  let totBet = 0, totWin = 0, totPay = 0, totComm = 0, totPL = 0;
  weeksInMonth.forEach(w => {
    const t = computeWeekTotals(w);
    totBet += t.totBet; totWin += t.totWin;
    totPay += t.totPay; totComm += t.totComm; totPL += t.totPL;
  });

  // Summary box
  const box = document.getElementById('monthlySummaryBox');
  box.className = 'monthly-summary ' + (totPL > 0 ? 'profit' : totPL < 0 ? 'loss' : '');
  box.innerHTML = weeksInMonth.length === 0 ? `
    <div class="label">${MONTH_NAMES[month]} ${year}</div>
    <div class="value">— data မရှိ —</div>
  ` : `
    <div class="label">${MONTH_NAMES[month]} ${year} — စုစုပေါင်း ${weeksInMonth.length} သီတင်းပတ်</div>
    <div class="value">${fmtSigned(totPL)}</div>
    <div class="breakdown">
      <div>ရောင်းရငွေ<span class="v">${fmt(totBet)}</span></div>
      <div>ကော်<span class="v">${fmt(totComm)}</span></div>
      <div>လျော်<span class="v">${fmt(totPay)}</span></div>
    </div>
  `;
  document.getElementById('monMonthSub').textContent = weeksInMonth.length > 0 ? `${weeksInMonth.length} သီတင်းပတ်` : '';
  document.getElementById('monMonthSub').className = 'month-sub';

  // Week breakdown
  const breakdown = document.getElementById('weekBreakdown');
  if (weeksInMonth.length === 0) {
    breakdown.innerHTML = '<p style="color:#9ca3af;font-size:12px;text-align:center;padding:12px;">သီတင်းပတ်များ မရှိသေးပါ</p>';
  } else {
    breakdown.innerHTML = weeksInMonth
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
      .map((w, i) => {
        const t = computeWeekTotals(w);
        const ws = new Date(w.weekStart);
        const we = new Date(ws); we.setDate(ws.getDate() + 4);
        const dateRange = `${ws.getDate()}/${ws.getMonth() + 1} – ${we.getDate()}/${we.getMonth() + 1}`;
        return `
          <div class="week-row" onclick="jumpToWeek('${w.weekStart}')">
            <span class="wk-num">${i + 1}</span>
            <div class="wk-info">
              <div class="wk-date">${dateRange}</div>
              ${w.note ? `<div class="wk-note">📝 ${w.note}</div>` : ''}
            </div>
            <span class="wk-pl ${t.totPL >= 0 ? 'positive' : 'negative'}">${fmtSigned(t.totPL)}</span>
          </div>
        `;
      }).join('');
  }

  // Compare with previous month
  renderMonthCompare(weeks, year, month, totPL, totBet, totPay);

  // Yearly chart
  renderYearlyChart(weeks, year, month);
}

function renderMonthCompare(weeks, year, month, currentPL, currentBet, currentPay) {
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  let prevPL = 0, prevBet = 0, prevPay = 0;
  weeks.forEach(w => {
    if (!w.weekStart) return;
    const wd = new Date(w.weekStart);
    let inPrev = false;
    for (let d = 0; d < 5; d++) {
      const day = new Date(wd); day.setDate(wd.getDate() + d);
      if (day.getFullYear() === prevYear && day.getMonth() === prevMonth) { inPrev = true; break; }
    }
    if (inPrev) {
      const t = computeWeekTotals(w);
      prevPL += t.totPL; prevBet += t.totBet; prevPay += t.totPay;
    }
  });

  const compare = document.getElementById('monthCompare');
  const delta = currentPL - prevPL;
  const pctChange = prevPL !== 0 ? Math.round((delta / Math.abs(prevPL)) * 100) : 0;

  if (prevBet === 0 && currentBet === 0) {
    compare.innerHTML = '<p style="color:#9ca3af;font-size:12px;text-align:center;padding:8px;">နှိုင်းယှဉ်ဖို့ data မရှိ</p>';
    return;
  }

  compare.innerHTML = `
    <div class="compare-row">
      <span class="label">ပြီးခဲ့လ (${MONTH_NAMES[prevMonth]})</span>
      <span class="value ${prevPL >= 0 ? 'positive' : 'negative'}">${fmtSigned(prevPL)}</span>
    </div>
    <div class="compare-row">
      <span class="label">ဒီလ (${MONTH_NAMES[month]})</span>
      <span class="value ${currentPL >= 0 ? 'positive' : 'negative'}">${fmtSigned(currentPL)}</span>
    </div>
    <div class="compare-row">
      <span class="label">ပြောင်းလဲမှု</span>
      <span class="value">
        ${fmtSigned(delta)}
        ${pctChange !== 0 ? `<span class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '↑' : '↓'} ${Math.abs(pctChange)}%</span>` : ''}
      </span>
    </div>
  `;
}

function renderYearlyChart(weeks, year, currentMonth) {
  const monthTotals = new Array(12).fill(0);
  const monthHas = new Array(12).fill(false);
  weeks.forEach(w => {
    if (!w.weekStart) return;
    const t = computeWeekTotals(w);
    const wd = new Date(w.weekStart);
    for (let d = 0; d < 5; d++) {
      const day = new Date(wd); day.setDate(wd.getDate() + d);
      if (day.getFullYear() === year) {
        monthTotals[day.getMonth()] += t.dailyPLs[d];
        monthHas[day.getMonth()] = true;
      }
    }
  });
  const maxAbs = Math.max(1, ...monthTotals.map(v => Math.abs(v)));
  const chart = document.getElementById('yearlyChart');
  chart.innerHTML = monthTotals.map((v, i) => {
    const heightPct = monthHas[i] ? Math.max(8, (Math.abs(v) / maxAbs) * 100) : 4;
    const cls = !monthHas[i] ? '' : v > 0 ? 'profit' : v < 0 ? 'loss' : '';
    return `
      <div class="bar ${cls} ${i === currentMonth ? 'current' : ''}" style="height:${heightPct}%">
        <span class="bar-tooltip">${MONTH_NAMES[i]}: ${fmtSigned(v)}</span>
        <span class="month-label">${i + 1}</span>
      </div>
    `;
  }).join('');
}

window.jumpToWeek = function(weekStart) {
  document.getElementById('weekStart').value = weekStart;
  switchView('week');
  loadWeek();
};

window.changeMonth = function(direction) {
  currentMonth.setMonth(currentMonth.getMonth() + direction);
  // Re-render the visible view
  const active = document.querySelector('.nav-item.active').id;
  if (active === 'navCalendar') renderCalendar();
  if (active === 'navMonthly') renderMonthly();
};

// ===== Actions =====
window.exportCSV = function() {
  const commRate = Number(document.getElementById('commRate').value) / 100;
  const payoutMult = Number(document.getElementById('payoutMult').value);
  const rows = [['#', 'Day', 'Session', 'Total Bet', 'Win Bet', 'Commission', 'Payout', 'P/L']];
  for (let i = 0; i < SESSIONS.length; i++) {
    const bet = getValue('bet_' + i);
    const win = getValue('win_' + i);
    const comm = Math.round(bet * commRate);
    const pay = win * payoutMult;
    rows.push([
      i + 1, SESSIONS[i].dayName, SESSIONS[i].label,
      bet, win, comm, pay, bet - comm - pay,
    ]);
  }
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `2d-weekly-${document.getElementById('weekStart').value}.csv`;
  a.click();
};

window.clearWeek = async function() {
  if (!confirm('ဒီအပတ်ရဲ့ data အကုန် ဖျက်မလား?')) return;
  for (let i = 0; i < SESSIONS.length; i++) {
    const b = document.getElementById('bet_' + i);
    const w = document.getElementById('win_' + i);
    if (b) { b.value = ''; b.dataset.value = ''; }
    if (w) { w.value = ''; w.dataset.value = ''; }
  }
  document.getElementById('weekNote').value = '';
  const weekStart = document.getElementById('weekStart').value;
  try {
    if (db && currentUser && !currentUser.uid.startsWith('local')) {
      await deleteDoc(doc(db, 'users', currentUser.uid, 'weeks', weekStart));
    } else {
      localStorage.removeItem(`weekly_${weekStart}`);
    }
  } catch (e) { console.error(e); }
  allWeeksCache = null;
  recalc();
};

// Auth form: Enter key submits
['emailInput', 'passwordInput', 'confirmInput'].forEach(id => {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.activeElement?.id === id) {
      e.preventDefault();
      submitAuth();
    }
  });
});

// Re-render numbers when window resizes (orientation change)
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (document.getElementById('weekView').style.display !== 'none') loadWeek();
  }, 200);
});

initFirebase();
