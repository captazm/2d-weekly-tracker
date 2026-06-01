# 📊 2D Weekly P/L Tracker — Firebase Edition

တစ်ပတ်စာ အရှုံးအမြတ် မှတ်တမ်း app — Cloud-saved via Firebase.

---

## 🚀 Quick Start (Firebase မ-setup ဘဲ စမ်းသုံးရန်)

ဒီ folder ထဲက `index.html` ကို browser မှာ ဖွင့်လိုက်ရုံပဲ။ Firebase setup မလုပ်ထားသေးရင် **localStorage** အသုံးပြုပြီး browser ထဲမှာပဲ သိမ်းပါမယ်။

```bash
open "/Users/macbookair/Documents/n8n claude/weekly-tracker-app/index.html"
```

---

## ☁️ Firebase Setup (Cloud Save လုပ်ရန်)

### Step 1: Firebase Project ဖန်တီးပါ

1. https://console.firebase.google.com/ သို့ သွားပါ
2. **Add project** နှိပ်ပါ
3. Project name ထည့်ပါ (ဥပမာ: `2d-tracker`)
4. Google Analytics — disable လုပ်နိုင်တယ်
5. **Create project** နှိပ်ပါ

### Step 2: Web App ထည့်ပါ

1. Project overview မှာ **Web (</>)** icon နှိပ်
2. App nickname: `2D Tracker`
3. **Register app** နှိပ်
4. Firebase config object ပေါ်လာရင် **copy** လုပ်ပါ

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "2d-tracker.firebaseapp.com",
  projectId: "2d-tracker",
  storageBucket: "2d-tracker.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc123"
};
```

### Step 3: `firebase-config.js` File ပြင်ပါ

`firebase-config.js` ဖိုင်ထဲမှာ Step 2 က config ကို ထည့်ပါ။ ပြီးရင် `FIREBASE_ENABLED = true` ပြောင်းပါ:

```javascript
export const firebaseConfig = {
  apiKey: "သင့်ရဲ့ API key",
  authDomain: "...",
  // ... (Step 2 မှ copy ထားတဲ့ values)
};

export const FIREBASE_ENABLED = true;  // ← true ပြောင်း!
```

### Step 4: Authentication ဖွင့်ပါ

1. Firebase Console → **Build → Authentication**
2. **Get started** နှိပ်
3. **Sign-in method** tab → ဒီနှစ်ခု enable လုပ်:
   - ✅ **Email/Password**
   - ✅ **Anonymous**

### Step 5: Firestore Database ဖန်တီးပါ

1. Firebase Console → **Build → Firestore Database**
2. **Create database** နှိပ်
3. Location ရွေး (ဥပမာ: `asia-southeast1`)
4. **Start in production mode** ရွေး
5. **Enable** နှိပ်

### Step 6: Security Rules ထည့်ပါ

Firestore → **Rules** tab → အောက်က rules ထည့်ပါ:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only access their own data
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

**Publish** နှိပ်ပါ။

### Step 7: App ဖွင့်ပါ

```bash
open "/Users/macbookair/Documents/n8n claude/weekly-tracker-app/index.html"
```

- **Email ဖြင့် ဝင်ရန်** → Email + Password ထည့်ပါ (အသစ်ဆို account ဖန်တီးပေးမယ်)
- **Guest အဖြစ် ဝင်ရန်** → Anonymous (browser တစ်ခုပဲ — ပျောက်နိုင်တယ်)

---

## 📱 Mobile/Phone မှာ သုံးရန်

### Option A: GitHub Pages မှ Free Hosting

1. GitHub repo ဖန်တီး → ဒီ folder ထဲ files အကုန် push
2. **Settings → Pages → Source → main branch → Save**
3. URL ရမယ်: `https://YOUR-USERNAME.github.io/REPO-NAME/`
4. Phone မှာ ဖွင့်ပြီး — Safari/Chrome menu → **Add to Home Screen**

### Option B: Firebase Hosting

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Init (cd into weekly-tracker-app folder first)
cd "/Users/macbookair/Documents/n8n claude/weekly-tracker-app"
firebase init hosting
# - Use existing project: 2d-tracker
# - Public directory: . (current folder)
# - Configure as single-page app: No
# - Set up automatic builds: No

# Deploy
firebase deploy --only hosting
```

URL ရမယ်: `https://2d-tracker.web.app`

### Option C: Local Server Only

```bash
# Python ရှိရင်
cd "/Users/macbookair/Documents/n8n claude/weekly-tracker-app"
python3 -m http.server 8080

# Phone မှာ Wi-Fi တူရင်: http://YOUR-MAC-IP:8080
```

---

## ✨ Features

- 📊 ၁၀ ကြိမ်စာ (၅ ရက် × ၂ ပွဲ) auto-tracking
- 💰 ၁၈% commission နှင့် ×၈၀ payout — auto calculate
- 📅 Week navigation (◀ ▶ buttons)
- ☁️ **Auto-save** to Firebase (typing ပြီး 0.8s နောက်)
- 📜 ယခင်အပတ်များ history list
- 📤 CSV export
- 📱 Mobile-responsive
- 🔐 Per-user data isolation (security rules)
- 🌐 Offline fallback (localStorage)

---

## 🗂️ File Structure

```
weekly-tracker-app/
├── index.html          ← Main app
├── styles.css          ← Styling
├── app.js              ← App logic + Firebase
├── firebase-config.js  ← Firebase credentials (EDIT THIS)
├── manifest.json       ← PWA manifest
└── README.md           ← ဒီ file
```

---

## 🔒 Data Privacy

Firebase Firestore မှာ data သိမ်းတဲ့အခါ:
- **Path:** `users/{your-uid}/weeks/{week-start-date}`
- ကိုယ့်ရဲ့ account ထဲက data ကို ကိုယ်တင် access ရတယ်
- Security rules က တခြားသူရဲ့ data ကို လုံးဝ မမြင်ရဘူး
- Browser ပြောင်းသုံးရင်လည်း login လုပ်ရင် data ပြန်ဆွဲမယ်

---

## 💡 Troubleshooting

| ပြဿနာ | ဖြေရှင်းနည်း |
|--------|-----------|
| "Firebase မ-config ထား" alert | `firebase-config.js` ပြင်ပါ, `FIREBASE_ENABLED = true` |
| Login မရဘူး | Firebase Console → Authentication → Sign-in method enable စစ်ပါ |
| Save မဖြစ်ဘူး | Firestore Rules ပြန်စစ်၊ Network ပြန်စစ် |
| Data ပျောက်သွားရင် | localStorage ထဲ backup ရှိနိုင်တယ်: DevTools → Application → Local Storage |

---

**Version:** 1.0.0
**License:** Personal use
