# Baganto — Project Handoff Document
_Last updated: August 10, 2026. Continue from this document in the next session._

---

## 1. What Is Baganto

Baganto is an Indian barter-and-trade marketplace app (like OLX but focused on barter/exchange). Tagline: **"Sell · Exchange · Save"**. Built for Indian users — cities, INR pricing, local barter culture.

**Current state:** A fully functional single-file HTML app (`baganto-barter-app.html`) with no build step, no npm, no frameworks. Pure HTML + vanilla ES5 JavaScript + CSS. All data stored in `localStorage`. 40 automated tests pass.

---

## 2. File Locations

| File | Path | Purpose |
|------|------|---------|
| **Main app** | `/Users/kiranr/Desktop/baganto/baganto-barter-app.html` | The entire app — ~2900 lines, ~304KB (includes embedded base64 logo) |
| **Logo PNG** | `/Users/kiranr/Desktop/baganto/baganto-logo.png` | Orange "b" icon — already embedded as base64 in the HTML |
| **Test runner** | `/Users/kiranr/Desktop/baganto/_test_runner.js` | jsdom-based test suite, 40 tests — now lives in the baganto folder |
| **Outputs dir** | `/Users/kiranr/Library/Application Support/Claude/local-agent-mode-sessions/.../outputs/` | Temp working directory (non-persistent between sessions) |

**Shell path mapping (for bash commands):**
- `/Users/kiranr/Desktop/baganto/` → `/sessions/magical-intelligent-feynman/mnt/baganto/`
- outputs dir → `/sessions/magical-intelligent-feynman/mnt/outputs/`

**How to run tests:**
```bash
cp /sessions/magical-intelligent-feynman/mnt/baganto/baganto-barter-app.html /sessions/magical-intelligent-feynman/mnt/outputs/baganto-barter-app.html
cp /sessions/magical-intelligent-feynman/mnt/baganto/_test_runner.js /sessions/magical-intelligent-feynman/mnt/outputs/_test_runner.js
cd /sessions/magical-intelligent-feynman/mnt/outputs && node _test_runner.js 2>&1 | grep -v 'Could not load\|Not implemented'
```
The test runner handles the two-step login automatically (phone+password → OTP "123456").

---

## 3. Architecture — Single-File App

### Pattern
- **One HTML file** — `<style>`, `<div id="app">`, one `<script>` block
- **IIFE** wrapping all JS: `(function(){ ... })()`
- **Full re-render** on every state change: `render()` sets `document.getElementById("app").innerHTML`
- **Event delegation**: single `onClick`, `onChange`, `onInput`, `onSubmit` listeners on `#app`
- **`data-action` attributes** drive all interactions (list below)
- **ES5 compatible** (no arrow functions, no template literals, no `let`/`const` in most places)
- **localStorage only** — no external dependencies, no network required to function

### Key Constants
```js
var STORAGE_KEY = "baganto_db_v4";   // DB in localStorage
var USER_KEY    = "baganto_user_v2"; // logged-in userId in localStorage
var DAY  = 86400000;
var HOUR = 3600000;
var API_BASE = (window.BAGANTO_API_BASE || "").replace(/\/+$/, ""); // optional backend
```

### Storage Functions
```js
storageGet(key)     // localStorage.getItem with try/catch
storageSet(key, v)  // localStorage.setItem with try/catch
storageRemove(key)  // localStorage.removeItem
```

---

## 4. CSS Design System

### Color Variables (`:root`)
```css
--bg: #f6f4f0          /* warm off-white page background */
--surface: #ffffff      /* card/panel backgrounds */
--ink: #1f2937          /* primary text */
--muted: #6b7280        /* secondary text */
--border: #e6e1d8       /* card borders */
--primary: #f97316      /* orange — buttons, accents */
--primary-dark: #c2500a
--primary-light: #fff7ed
--accent: #f97316       /* same as primary */
--accent-dark: #ea580c
--danger: #dc2626
--danger-light: #fdecec
--success: #16a34a      /* barter green */
--success-light: #f0fdf4
--barter: #16a34a
--barter-light: #f0fdf4
```

### Key CSS Classes
```css
.nav              /* top navigation bar */
.nav-logo         /* logo + wordmark container */
.nav-logo-icon-wrap  /* dark #1a1a2e rounded box holding the logo img */
.nav-logo-words   /* "Baganto" + tagline */
.post-btn         /* orange "+ Post" button in nav */
.login-btn        /* dark "#1a1a2e" Login button in nav (guests only) */
.card             /* white rounded card */
.item-card        /* listing card */
.item-card-img    /* photo thumbnail (140px tall) when listing has images */
.item-icon        /* emoji icon when no images */
.modal-overlay    /* full-screen modal backdrop */
.modal-box        /* modal content box */
.modal-gallery    /* horizontal scrollable image gallery in modal */
.modal-icon-big   /* 46px emoji fallback in modal when no images */
.auth-screen      /* full-page login/signup overlay */
.auth-card        /* white card on auth screen */
.auth-dismiss     /* "← Continue browsing" button at top of auth card */
.cat-tile         /* category browse tile on home */
.cat-grid         /* 4-column grid of category tiles */
.pill-sale        /* "Sale" badge */
.pill-barter      /* "Barter" badge (green) */
.img-upload-area  /* dashed upload zone in listing form */
.img-previews     /* flex row of image thumbnails */
.img-preview-wrap /* single preview: 80×80px relative container */
.img-remove-btn   /* red ✕ button overlaid on preview */
```

### Nav Logo HTML (inside `renderNav()`)
```js
'<div class="nav-logo" data-action="goto-tab" data-tab="market">' +
  '<div class="nav-logo-icon-wrap"><img src="[BASE64]" alt="Baganto"></div>' +
  '<div class="nav-logo-words">' +
    '<span class="w1"><span class="ob">B</span>aganto</span>' +
    '<span class="w2">Sell &middot; Exchange &middot; Save</span>' +
  '</div>' +
'</div>'
```
(The `[BASE64]` is the full embedded base64 of `baganto-logo.png` — the orange "b" icon.)

---

## 5. Data Model (DB)

`DB` is loaded from `localStorage` via `loadDB()`, or seeded fresh via `seedDB()`.

```js
DB = {
  users:     [...],   // User objects
  items:     [...],   // Item/listing objects
  deals:     [...],   // Barter proposals / purchase records
  messages:  [...],   // Chat messages per deal
  ratings:   [...],   // User reviews
  savedItems:[...],   // Saved/hearted listings
  reports:   [...]    // Reported ads
}
```

### User Object
```js
{
  id: "u1",
  name: "You",
  phone: "9876541001",   // used as login credential
  password: "demo123",   // plaintext (demo only)
  avatar: "🙂",
  city: "Mumbai, Maharashtra",
  memberSince: <timestamp>
}
```

### Seed Users (all password: `demo123`)
| id | name | phone | city |
|----|------|-------|------|
| u1 | You | 9876541001 | Mumbai, Maharashtra |
| u2 | Aarav Mehta | 9876541002 | Bengaluru, Karnataka |
| u3 | Priya Sharma | 9876541003 | Delhi |
| u4 | Rohan Verma | 9876541004 | Chennai, Tamil Nadu |
| u5 | Ananya Iyer | 9876541005 | Pune, Maharashtra |
| u6 | (6th user) | 9876541006 | (varies) |

### Item Object
```js
{
  id: "i1",
  ownerId: "u1",
  title: "...",
  icon: "🚲",            // emoji icon (shown when no images)
  category: "Bicycles",  // must match a sub in CATEGORY_TREE
  description: "...",
  forSale: true,
  price: 1500,           // null if not for sale
  negotiable: false,
  forBarter: true,
  wantInExchange: "Sci-fi books",
  city: "Mumbai, Maharashtra",
  status: "available",   // "available" | "sold" | "bartered"
  images: [],            // array of base64 data URIs (up to 5)
  views: 0,
  isFeatured: false,
  createdAt: <timestamp>
}
```

### Deal Object
```js
{
  id: "d1",
  type: "barter",          // "barter" | "buy" | "offer"
  status: "pending",       // "pending" | "accepted" | "completed" | "rejected" | "withdrawn"
  fromUserId: "u2",
  toUserId: "u1",
  offeredItemId: "i3",     // item offered in barter
  requestedItemId: "i1",   // item being requested
  message: "...",
  offerPrice: null,        // for type="offer"
  createdAt: <timestamp>
}
```

### Other Collections
- **Message**: `{ id, dealId, fromUserId, text, createdAt }`
- **Rating**: `{ id, fromUserId, toUserId, dealId, stars, review, createdAt }`
- **SavedItem**: `{ id, userId, itemId, createdAt }`
- **Report**: `{ id, itemId, reportedBy, reason, createdAt }`

---

## 6. Category Tree

All categories are barter-eligible (`isNoBarter()` always returns `false`).

```js
var CATEGORY_TREE = [
  { id:"cars",        label:"Cars",                     icon:"🚗",
    subs:["Cars","Used Cars"] },
  { id:"bikes",       label:"Bikes",                    icon:"🏍️",
    subs:["Motorcycles","Scooters","Bicycles","Bike Spare Parts"] },
  { id:"mobiles",     label:"Mobiles",                  icon:"📱",
    subs:["Mobile Phones","Mobile Accessories","Tablets"] },
  { id:"electronics", label:"Electronics & Appliances", icon:"💻",
    subs:["TVs & Audio","Kitchen Appliances","Computers & Laptops","Cameras & Lenses",
          "Games & Entertainment","Fridges & ACs","Washing Machines","Computer Accessories","Other Electronics"] },
  { id:"furniture",   label:"Furniture",                icon:"🛋️",
    subs:["Sofa & Dining","Beds & Wardrobes","Home Decor & Garden","Kids Furniture",
          "Tools & Equipment","Other Household Items"] },
  { id:"fashion",     label:"Fashion",                  icon:"👗",
    subs:["Men","Women","Kids Fashion"] },
  { id:"pets",        label:"Pets",                     icon:"🐾",
    subs:["Dogs & Cats","Fish & Aquarium","Pet Food & Accessories","Other Pets"] },
  { id:"books",       label:"Books, Sports & Hobbies",  icon:"📚",
    subs:["Books","Gym & Fitness","Musical Instruments","Sports Equipment","Toys & Baby","Other Hobbies"] }
];
// Removed: Properties, Commercial Vehicles, Jobs, Services
```

`CATEGORIES` (flat array of subcategory strings) is derived from `CATEGORY_TREE`.

---

## 7. UI State Object

```js
var UI = {
  tab: "market",                  // "market" | "listings" | "trades" | "profile"
  currentUserId: storageGet(USER_KEY) || "",  // "" = guest (not logged in)
  filters: {
    q: "", category: "all", city: "all",
    listingType: "all",           // "all" | "sale" | "barter"
    sort: "newest",               // "newest" | "price-asc" | "price-desc" | "distance"
    showTraded: false,
    priceMin: "", priceMax: ""
  },
  modal: null,                    // null | {type:"item"|"propose"|"buy"|"offer"|"report"|"trade"|"rate", itemId/dealId}
  toast: null,                    // null | {msg:"..."}
  listingFormOpen: false,
  profileFormOpen: false,
  legalPage: null,                // null | "terms"|"privacy"|"refund"|"grievance"
  recentlyViewed: [],             // array of itemIds
  homeSection: null,              // null=home grid, "cat:CATID" for drill-down
  savedTab: false,
  myAdsTab: "active",             // "active" | "sold"
  editingItemId: null,
  newListingCategory: "",         // tracks selected category in listing form
  newListingImages: [],           // base64 strings for new listing (up to 5)
  authScreen: false,              // true = show auth overlay instead of app
  authPage: "login",              // "login" | "signup"
  authReturnTab: null,            // tab to navigate to after successful login
  authReturnAction: null,         // action to execute after login ("start-sell" etc.)
  recentSearches: [],
  chatsFilter: "all"              // "all" | "barter" | "sale" | "offer"
};
```

---

## 8. Auth System

### Login Flow (guests can browse freely)
1. App opens → `currentUserId = storageGet(USER_KEY) || ""` → if empty, **guest mode** (no redirect)
2. Guests see all listings, categories, item modals
3. Write actions trigger login: posting, save/heart, propose, buy, make offer, clicking My Ads/Chats/Profile tabs
4. Login screen shows with `UI.authScreen = true`
5. Auth screen has **"← Continue browsing"** dismiss button (`data-action="dismiss-auth"`)

### Auth Screen
- `renderAuth()` renders login, signup, forgot-password, and otp-verify pages (toggled by `UI.authPage`)
- **Login flow (two steps)**:
  1. Phone + password → `onSubmit "auth-login"` → looks up user → if found, sets demo OTP `"123456"`, shows `UI.authPage = "otp-verify"`
  2. OTP entry → `onSubmit "auth-otp-verify"` → validates OTP → sets `UI.currentUserId`, saves to `USER_KEY`, `UI.authScreen = false`
- **Signup**: name + email + phone + city + password → validates → creates user → logs in directly (no OTP step)
- **Forgot password**: email or phone → sets demo OTP `"654321"`, shows otp-verify with `UI.otpVerifyMode = "forgot-password"`
- Login mode toggle: phone vs email (radio buttons, `UI.loginMode = "phone"|"email"`)
- After login: if `UI.authReturnAction === "start-sell"` → go to listings tab with form open; else if `UI.authReturnTab` → go to that tab
- **Startup auth guard**: `DOMContentLoaded` sets `UI.authScreen = true` if no saved user ID. Guests can dismiss it with "← Continue browsing".

### Logout
- `data-action="logout"` → clears `UI.currentUserId`, clears `USER_KEY`, sets `UI.tab = "market"`, `UI.authScreen = false` (stays on home)
- Logout button is inside `renderProfile()` (inside the profile-head card, after the stat-row)

### Guest-Safe `currentUser()`
```js
function currentUser(){
  var GUEST = {id:"", name:"Guest", city:"", avatar:"👤", phone:"", password:"", memberSince:0};
  if(!UI.currentUserId) return GUEST;
  var u = userById(UI.currentUserId);
  return u && u.id ? u : GUEST;
}
```

### Tab Guards
- Clicking "My Ads", "Chats", or "Profile" as guest → `UI.authScreen=true`, `UI.authReturnTab = dest`
- Home tab always accessible

### Nav (logged in vs. guest)
- **Logged in**: shows `+ Post` button + demo user switcher
- **Guest**: shows dark `Login` button (`data-action="goto-login-screen"`) + no user switcher

---

## 9. Image Upload

### In Listing Form (`renderListingForm`)
- File input (`id="imgFileInput"`, `accept="image/*"`, `multiple`)
- Clicking "📷 Add Photos" button triggers `document.getElementById('imgFileInput').click()`
- `FileReader` in a **document-level** `change` listener (not `#app` — survives re-renders)
- Up to 5 images; new images append to `UI.newListingImages[]`
- Preview thumbnails at 80×80px with red ✕ remove button per image
- Remove handled by a **document-level** click listener on `.img-remove-btn`
- On form submit: `images: UI.newListingImages` passed to `addListing()`; then `UI.newListingImages = []`

### In Item Cards (`renderItemCard`)
```js
(it.images && it.images.length
  ? '<div class="item-card-img"><img src="'+it.images[0]+'" alt=""></div>'
  : '<div class="item-icon">'+it.icon+'</div>')
```

### In Item Modal (`renderItemModalBody`)
```js
var galleryHtml = (it.images && it.images.length)
  ? '<div class="modal-gallery">' + it.images.map(function(src){ return '<img src="'+src+'" alt="">'; }).join("") + '</div>'
  : '<div class="modal-icon-big">'+it.icon+'</div>';
// galleryHtml used at top of modal return
```

---

## 10. All `data-action` Values

| Action | Description |
|--------|-------------|
| `goto-tab` | Navigate tab (guarded for guests on non-market tabs) |
| `start-sell` | Open listing form (guarded — requires login) |
| `open-item` | Open item detail modal |
| `toggle-save` | Heart/save an item (guarded) |
| `open-propose` | Open barter propose modal (guarded) |
| `open-buy` | Open buy modal (guarded) |
| `open-offer` | Open make-offer modal (guarded) |
| `open-deal` | Open trade/deal modal |
| `open-rate` | Open rate-trade modal |
| `open-report` | Open report-ad modal |
| `close-modal` | Close any modal |
| `close-modal-overlay` | Click backdrop to close modal |
| `close-legal` | Close legal page |
| `open-legal` | Open legal page |
| `dismiss-auth` | Dismiss auth screen, continue browsing as guest |
| `goto-login-screen` | Show auth screen (login page) |
| `goto-login` | Switch auth screen to login page |
| `goto-signup` | Switch auth screen to signup page |
| `logout` | Log out, return to home as guest |
| `browse-category` | Drill into parent category |
| `browse-subcategory` | Drill into subcategory results |
| `clear-home-section` | Back to home from category drill-down |
| `accept-deal` / `reject-deal` / `withdraw-deal` / `complete-deal` | Deal lifecycle |
| `confirm-buy` | Confirm purchase |
| `send-available` | Send "Is this still available?" message |
| `share-item` | Share item (clipboard/native share) |
| `edit-listing` / `delete-listing` / `cancel-edit` | Listing CRUD |
| `mark-sold` | Mark item as sold |
| `delete-profile` | Delete current profile |
| `switch-user` | Demo user switcher (select element) |
| `toggle-listing-form` / `toggle-profile-form` | Toggle forms open/close |
| `toggle-sale-field` / `toggle-barter-field` | Toggle price/want row in listing form |
| `pick-icon` / `pick-avatar` / `pick-star` | Picker selections |
| `profile-tab-reviews` / `profile-tab-saved` | Profile sub-tabs |
| `my-ads-tab` | My Ads sub-tab (active/sold) |
| `chats-filter` | Filter trades by type |
| `see-all-featured` / `see-all-fresh` / `see-all-nearby` | Home "See All" links |
| `apply-recent-search` | Re-apply a saved search |
| `reset-demo` | Reset all data to seed state |

---

## 11. Key Functions

### Render Pipeline
```
render()
  ├── if UI.authScreen → renderAuth() [replaces entire #app]
  └── else → renderNav() + renderTabContent() + renderModal() + renderToast() + renderFooter()
               └── renderTabContent() dispatches to:
                     market   → renderMarket()
                     listings → renderListings()
                     trades   → renderTrades()
                     profile  → renderProfile()
```

### Data Helpers
```js
currentUser()            // current user object (or GUEST object if not logged in)
userById(id)             // User by id
itemById(id)             // Item by id
myItems()                // items owned by currentUser
myAvailableItems()       // available items owned by currentUser
dealsFor(userId)         // all deals involving userId
pendingIncomingCount(id) // count of pending incoming proposals (for badge)
userRating(userId)       // {avg, count} star rating
isSaved(itemId)          // whether currentUser has saved this item
savedCount(userId)       // count of saved items
distanceKm(cityA, cityB) // approximate distance between cities
```

### Write Operations
```js
addListing(data)          // creates item, pushes to DB, saves
deleteListing(itemId)     // removes item, withdraws related deals
saveEditedListing(id, data)
createProfile(data)       // creates new user
deleteProfile()           // deletes currentUser + cascade
createBarterProposal(requestedId, offeredId, message)
acceptDeal(dealId) / rejectDeal / withdrawDeal / completeDeal
buyItem(itemId)
makeOffer(itemId, price, message)
sendMessage(dealId, text)
submitRating(dealId, toUserId, stars, review)
toggleSave(itemId)
reportItem(itemId, reason)
markItemSold(itemId)
```

### Utility
```js
uid(prefix)         // generates unique IDs like "u_abc123"
esc(str)            // HTML-escape a string
formatINR(n)        // formats number as ₹1,23,456
timeAgo(ts)         // "2 hours ago", "3 days ago"
showToast(msg)      // shows toast notification
```

---

## 12. Optional Backend

The app has stub support for an optional REST backend:
- `window.BAGANTO_API_BASE` — set this to enable server sync
- `syncToServer()` — `PUT /api/db` with full DB JSON
- `syncFromServer()` — `GET /api/db`
- A sync status pill (`renderSyncPill()`) appears in the nav when API is configured
- Currently used as localhost prototype only; Firebase migration is planned

---

## 13. What Has Been Built (Completed Features)

- [x] OLX-style marketplace UI (cards, modals, filters, sort, search)
- [x] Category tree with 8 parent categories, subcategories drill-down
- [x] Barter + Sale dual-mode listings
- [x] Trade proposal → chat → accept/reject → complete → rate flow
- [x] Buy / Make Offer / Free claim flows
- [x] Profile page with stats, reviews, saved ads, edit listing
- [x] Save/heart ads
- [x] Recently viewed, recent searches
- [x] Distance-based sorting and nearby listings
- [x] Featured items ribbon
- [x] "Is this still available?" quick message
- [x] Safe Deal Tips accordion in modal
- [x] Share item (native share / clipboard)
- [x] Report ad
- [x] Legal pages (Terms, Privacy, Refund, Grievance)
- [x] Hero banner on home
- [x] Baganto logo (orange "b") embedded as base64 — visible in nav + hero + auth screen
- [x] Orange color scheme throughout
- [x] Login / Signup / Logout pages (phone + password auth)
- [x] Guest browsing — no login required to view app
- [x] Login only required for: Post ad, Save, Propose, Buy, Offer, My Ads, Chats, Profile tabs
- [x] "← Continue browsing" button on auth screen
- [x] After-login redirect (back to where user was trying to go)
- [x] Image upload in listing form (up to 5 photos, base64, live preview, remove)
- [x] Photo thumbnail in item cards
- [x] Photo gallery in item modal
- [x] 40 automated tests passing (jsdom-based)
- [x] Demo user switcher (for testing multiple users)
- [x] Reset demo data button

---

## 14. Planned / Next Steps

### High Priority
- **Firebase integration** — replace localStorage with Firestore; migrate `DB` schema; real-time updates
  - Collections: `users`, `items`, `deals`, `messages`, `ratings`, `savedItems`
  - Auth: replace phone+password demo auth with Firebase Phone Auth (OTP)
- **Real phone OTP auth** — currently phone+password is plaintext demo; needs Firebase Auth
- **Image hosting** — currently images are stored as base64 in DB (huge); move to Firebase Storage
- **Push notifications** — for trade proposals, chat messages, deal updates

### Medium Priority
- **Search improvements** — full-text search, search by image category
- **Map view** — show listings on a map (Google Maps or Leaflet)
- **User verification** — verified badge, Aadhaar/phone verification
- **In-app notifications center** — beyond badge count
- **Admin panel** — approve featured listings, moderate reports

### Nice to Have
- **PWA** — make installable (service worker, manifest)
- **Dark mode**
- **Multi-language** — Hindi, Kannada, Tamil
- **Shipping integration** — Shiprocket or Delhivery for items that can be shipped

---

## 15. Known Issues / Gotchas

1. **Base64 images in DB** — images stored as base64 in localStorage will hit the ~5MB limit quickly. Must move to cloud storage before production.
2. **`data-group` not `data-super`** — `data-super` is a JS reserved word; the browse action uses `data-group` for category grouping.
3. **Duplicate phone key bug** (fixed) — seed users originally had a trailing `phone:"[your phone]"` that overwrote the real phone. Fixed by removing duplicates.
4. **Unescaped apostrophe** (fixed) — `India's` inside a JS single-quoted string caused a SyntaxError. Must escape as `India\'s`.
5. **FileReader delegation** — image file input is inside `#app` which re-renders. FileReader listener is on `document` (not `#app`) so it survives re-renders.
6. **`galleryHtml` scope** — must be declared as `var galleryHtml` inside `renderItemModalBody()` before the `return` statement.
7. **Test runner reads from outputs copy** — always `cp` the main file to outputs before running tests.
8. **Auth flow** — `onSubmit` handles: `auth-login` (→ OTP), `auth-signup` (direct login), `auth-otp-verify`, `auth-forgot-password`. `onClick` handles: `goto-login`, `goto-signup`, `goto-login-screen`, `logout`, `dismiss-auth`, `goto-forgot-password`, `back-from-otp`, `resend-otp`, `set-login-mode`.
9. **`migrateDB`** — if seed user lacks `phone` field, `migrateDB` sets it to `"[hidden]"`. Old localStorage saves from before the phone/password update will have missing credentials. Tell user to reset demo data (reset-demo button).
10. **`var logoSrc` in `renderAuth()`** — must be a quoted string: `var logoSrc = "data:image/png;base64,...";`. The base64 value is extracted from the nav logo. If this ever breaks (SyntaxError), fix by wrapping the raw data URI in `"..."`.
11. **Test runner login** — uses two-step flow: submit `auth-login` form → OTP screen appears → submit `auth-otp-verify` with value `"123456"`. jsdom's `FormData` DOES work for programmatically-set input values (verified). The old single-step form submit silently failed because the login now shows OTP screen instead of immediately logging in.

---

## 16. How to Make Changes (Workflow)

Since the file is large (~297KB with embedded base64), **always use Python scripts for edits** — never use `sed` with long lines.

```python
# Pattern for all edits:
with open('/sessions/.../baganto/baganto-barter-app.html', 'r') as f:
    html = f.read()

html = html.replace(OLD_STRING, NEW_STRING)  # be exact and unique

with open('/sessions/.../baganto/baganto-barter-app.html', 'w') as f:
    f.write(html)
```

After changes:
1. `cp /sessions/magical-intelligent-feynman/mnt/baganto/baganto-barter-app.html /sessions/magical-intelligent-feynman/mnt/outputs/`
2. `cp /sessions/magical-intelligent-feynman/mnt/baganto/_test_runner.js /sessions/magical-intelligent-feynman/mnt/outputs/`
3. `cd /sessions/magical-intelligent-feynman/mnt/outputs && node _test_runner.js 2>&1 | grep -v 'Could not load\|Not implemented'`
4. All 40 tests must pass before considering work done

---

## 17. Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| UI | Vanilla HTML + CSS + ES5 JS |
| State | In-memory JS object (`UI`) |
| Persistence | `localStorage` (key: `baganto_db_v4`) |
| Auth | Phone + password in `DB.users` (demo); `USER_KEY` in localStorage |
| Images | base64 data URIs embedded in `DB.items[].images[]` |
| Testing | Node.js + jsdom (40 tests) |
| Fonts | Google Fonts — Baloo 2 (via CDN link) |
| Backend | Optional REST API stub (not yet built) — Firebase planned |
| Hosting | Static file — open in browser directly |
