# Baganto — Project Handoff

**Last updated:** 7 September 2026
**Owner:** Kiran (kirangowda3636@gmail.com), Mysore, Karnataka, India
**Product:** Baganto — a barter + resale marketplace for India ("Sell. Exchange. Save.")

---

## 1. What Baganto is

A marketplace where users can **list items**, then either **sell** them or **barter/exchange** them with other users. Includes chat between traders, ratings after a deal, a support/contact system, and a freemium subscription model that limits how many ads a user can post.

**Tagline:** Sell. Exchange. Save.
**Brand colour:** Orange `#f97316` (primary), dark orange `#c2500a`
**Font:** Baloo 2 (logo/headings), system sans (body)
**Contact email:** contact@baganto.com
**Grievance Officer:** Kiran, contact@baganto.com, Vijayanagar, Mysore

---

## 2. Where the files live

| What | Path |
|---|---|
| Frontend (single-file app) | `~/Desktop/baganto/baganto-barter-app.html` (~408 KB) |
| Regression test suite | `~/Desktop/baganto/baganto-regression-tests.js` (143 tests, all passing) |
| Backend (Node/Express) | `~/Desktop/baganto-backend/` |
| Backend entry point | `~/Desktop/baganto-backend/index.js` |
| Backend env vars | `~/Desktop/baganto-backend/.env` |
| Backup copies of frontend | `~/Desktop/baganto/` (several `baganto barter app.backup...` files) |
| This handoff | `~/Desktop/baganto/HANDOFF.md` |

Other docs already in `~/Desktop/baganto/`: `CLAUDE.md` (instructions), `Project roadmap.md`, `Trust safety complete.md`, `Features complete.md`, `Baganto complete backend roadmap`, `Baganto interactive roadmap`, `Baganto logo.png`.

---

## 3. Current status — the honest version

**Backend: working.** Express server runs on `http://localhost:3000`, talks to Supabase over the REST API, and has been verified end-to-end — a user and an item were both created successfully and are sitting in the database right now.

**Frontend: not yet connected.** It still runs entirely on `localStorage`. This is the single biggest remaining task.

**Payments: not started.** No Razorpay account, no company bank details yet. This is a deliberate hold — Kiran flagged that company registration and bank account are still pending, so deployment is on hold until payments can be wired up properly.

---

## 4. Backend — full detail

### 4.1 Stack
- Node.js + Express 5
- Supabase (PostgreSQL) accessed via **direct REST API calls with `fetch`**, *not* the `@supabase/supabase-js` client
- `dotenv` for env vars, `cors` for cross-origin

### 4.2 Why REST instead of the JS client
The Supabase JS client kept throwing `TypeError: fetch failed`. After a long debugging session (see §7) the root cause turned out to be a typo in the project URL, but by then the code had already been rewritten to call the REST API directly via a single helper function. **Leave it this way** — it works, it's transparent, and it's easier to debug.

The helper in `index.js`:

```js
async function supabaseCall(table, method = 'GET', data = null, filters = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${filters}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey': SUPABASE_KEY,
      'Prefer': 'return=representation'
    }
  };
  if (data) options.body = JSON.stringify(data);
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || JSON.stringify(result));
  return result;
}
```

Note: Supabase REST uses `PATCH` for updates (not `PUT`), and filters are query strings like `?id=eq.<uuid>` or `?order=created_at.desc`.

### 4.3 Supabase project
- **Project name:** bagantoapp's Project
- **Org:** baganto (Free tier)
- **Project URL:** `https://sobvkkqqlovgaatpoyyg.supabase.co`
  ⚠️ **Note the double `y` in `poyyg`.** An earlier single-`y` typo (`poyg`) cost hours of debugging with `NXDOMAIN` DNS errors. Always copy this from the dashboard, never retype it.
- **Region:** Northeast Asia (Seoul), `ap-northeast-2`, `t3.nano` — chosen for low latency to India
- **Status:** Healthy. No GitHub repo connected, no migrations, no backups yet.

### 4.4 `.env` file (`~/Desktop/baganto-backend/.env`)
```
SUPABASE_URL=https://sobvkkqqlovgaatpoyyg.supabase.co
SUPABASE_ANON_KEY=<anon public key from Supabase dashboard>
SUPABASE_SERVICE_ROLE_KEY=<service role key from Supabase dashboard>
PORT=3000
```
Keys live only in this file. **Never paste keys into chat, screenshots, or commits.** If the backend is ever pushed to GitHub, add `.env` to `.gitignore` first.

### 4.5 `package.json` scripts
```json
"scripts": {
  "start": "node index.js",
  "test": "echo \"Error: no test specified\" && exit 1"
}
```
(The `start` script was missing initially and had to be added — `npm start` failed with `Missing script: "start"` until then.)

### 4.6 Dependencies installed
`express`, `@supabase/supabase-js` (installed but no longer used), `dotenv`, `cors`, `node-fetch` (installed but unused — Node 18+ has native `fetch`).

### 4.7 Running it
```bash
cd ~/Desktop/baganto-backend
npm start
```
Expected output:
```
✓ Backend running on http://localhost:3000
📍 API Endpoints: ...
```

---

## 5. Database schema (Supabase, `public` schema)

Six tables. All six are **exposed to the Data API** (this was a blocker — see §7).

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| email | text | |
| phone | text | nullable |
| name | text | |
| avatar | text | nullable |
| city | text | |
| bio | text | |
| is_verified | bool | default false |
| created_at | timestamp | now() |
| updated_at | timestamp | now() |

### `items`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK, `gen_random_uuid()` |
| owner_id | uuid | **FK → `public.users.id`** (constraint `items_owner_id_fkey`) |
| title | text | |
| description | text | |
| category | text | |
| icon | text | nullable |
| price | numeric | |
| condition | text | nullable |
| listing_type | text | nullable — sale vs barter |
| photos | text | nullable |
| created_at | timestamp | now() |
| expires_at | timestamp | `now() + '30 days'::interval` |

### `trades`
`id`, `from_user_id`, `to_user_id`, `item_id`, `kind`, `status`, `created_at`, `updated_at`

### `messages`
`id`, `trade_id`, `sender_id`, `content`, `photo`, `is_read`, `created_at`

### `ratings`
`id`, `from_user_id`, `to_user_id`, `trade_id`, `rating` (1–5), `review`, `created_at`

### `support_tickets`
`id`, `user_id`, `contact_email`, `category`, `subject`, `message`, `status`, `admin_reply`, `created_at`

### Important database facts
- **RLS is currently DISABLED** on the tables. They are publicly readable and writable. This is fine for local development and **must be fixed before launch** (see §8, Phase 2).
- **Data API exposure:** Supabase → Integrations → Data API → Exposed tables. All 6 are on. "Automatically expose new tables" is OFF, so **any new table must be exposed manually** or it will return `permission denied`.
- `items.owner_id` has a foreign key to `users.id`, so **a user must exist before an item can be created for them.**
- All IDs are UUIDs. Passing a string like `"user123"` returns `invalid input syntax for type uuid`.

### Verified test data currently in the database
```
User:  550e8400-e29b-41d4-a716-446655440000
       kiran@baganto.com / Kiran / Mysore / "Baganto founder"

Item:  982ba000-34d3-4354-8b44-e35005baef01
       Bicycle / "Good condition" / sports / ₹5000
       owner_id → the user above
```

---

## 6. API reference (all live and tested)

Base URL: `http://localhost:3000`

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Liveness check, returns status + timestamp |
| GET | `/items` | List all items |
| GET | `/items/:id` | One item |
| POST | `/items` | Create item — needs `owner_id` (existing user uuid), `title`, `description`, `category`, `price`, optional `condition`, `listing_type` |
| PUT | `/items/:id` | Update item |
| DELETE | `/items/:id` | Delete item |
| GET | `/trades` | List all trades |
| POST | `/trades` | Create trade — `from_user_id`, `to_user_id`, `item_id`, `kind`, `status` |
| PUT | `/trades/:id` | Update trade (e.g. change status) |
| GET | `/messages/:tradeId` | Messages for a trade, oldest first |
| POST | `/messages` | Send message — `trade_id`, `sender_id`, `content`, optional `photo` |
| GET | `/ratings/:userId` | Ratings received by a user |
| POST | `/ratings` | Leave rating — `from_user_id`, `to_user_id`, `trade_id`, `rating`, `review` |
| GET | `/users/:id` | One user |
| POST | `/users` | Create user — `id` (uuid), `email`, `phone`, `name`, `city`, `bio` |
| PUT | `/users/:id` | Update user |
| GET | `/support` | All support tickets, newest first |
| POST | `/support` | Create ticket — `user_id`, `contact_email`, `category`, `subject`, `message` (status auto-set to `open`) |
| PUT | `/support/:id` | Update ticket (e.g. add `admin_reply`, change `status`) |

### Auth endpoints — REMOVED
`/auth/signup` and `/auth/login` were written but **removed** during the REST rewrite. They also used `supabase.auth.signUpWithPassword()`, which **is not a real method** — the correct one is `signUp()`. Auth needs to be rebuilt from scratch (see §8, Phase 2).

### Working curl examples
```bash
# health
curl http://localhost:3000/health

# create user (must come first — FK constraint)
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"id":"550e8400-e29b-41d4-a716-446655440000","email":"kiran@baganto.com","name":"Kiran","city":"Mysore","bio":"Baganto founder"}'

# create item
curl -X POST http://localhost:3000/items \
  -H "Content-Type: application/json" \
  -d '{"owner_id":"550e8400-e29b-41d4-a716-446655440000","title":"Bicycle","description":"Good condition","category":"sports","price":5000}'
```

**Tip for testing:** run the server in one Terminal tab and curl in a *second* tab (`Cmd+T`). Running curl in the same tab as the server won't work — the server is holding that shell.

---

## 7. Bugs already solved — do not re-debug these

1. **`Missing script: "start"`** — `package.json` had no `start` script. Added `"start": "node index.js"`.

2. **`TypeError: fetch failed` / `NXDOMAIN`** — The Supabase URL in `.env` was `sobvkkqqlovgaatpoyg` (one `y`). The real URL is `sobvkkqqlovgaatpoyyg` (two `y`s). Everything downstream — DNS failures, `/etc/hosts` edits, `dns.setServers()` calls, switching from mobile hotspot to WiFi — was chasing this one typo. **Fixed.**
   - Leftover from that hunt: a line was added to `/etc/hosts` mapping `34.120.177.193 sobvkkqqlovgaatpoyg.supabase.co`. It's harmless (points at the misspelled domain) but **should be removed** for cleanliness: `sudo nano /etc/hosts`, delete that line.

3. **`permission denied for table items` / `... for table users`** — Tables existed but were not exposed to the Data API. Fixed in Supabase → Integrations → Data API → Exposed tables → enabled all 6. Remember: "Automatically expose new tables" is OFF.

4. **`invalid input syntax for type uuid: "user123"`** — `owner_id` must be a real UUID, not an arbitrary string.

5. **`violates foreign key constraint "items_owner_id_fkey"`** — Can't create an item for a user that doesn't exist. Create the user first.

6. **GitHub push failure (session 1)** — Username mismatch (`bagantoapp` vs `bagantoappp`) plus GitHub having disabled password auth. Fixed by correcting the remote URL and authenticating with a personal access token via `gh auth`.

7. **Pricing inconsistency (session 1)** — The Growth plan said 25 ads in `PRICING_PLANS` but 22 in the comparison table (`compareRows`). Two separate data structures were out of sync. Fixed to 25 in both. **Watch for this class of bug** — the frontend has duplicated pricing data in more than one place.

### Environment quirks worth knowing
- Kiran uses a **MacBook Air**, zsh, Terminal.
- `nano` on this machine opens as **UW PICO 5.09**. Save is `Ctrl+X` → `Y` → `Enter`. Ctrl+F does *not* search in this build.
- Mobile hotspot was suspected of blocking DNS at one point; it wasn't the cause, but WiFi is the safer bet for dev work.

---

## 8. What still needs doing

### Phase 1 — Connect the frontend to the backend ← **START HERE**
The frontend is a single ~408 KB HTML file running on `localStorage`. It needs to talk to the API instead.

1. Add near the top of the main `<script>` block:
   ```js
   const API_BASE_URL = 'http://localhost:3000';
   ```
2. Replace the `localStorage` read/write layer with `fetch()` calls to the endpoints in §6. The app is built as a single IIFE with a persistence layer — find that layer and swap its implementation rather than rewriting call sites throughout.
3. Handle the async shift: `localStorage` is synchronous, `fetch` is not. Functions that read data will need `async/await` and the UI will need loading states.
4. Map frontend concepts to backend tables: listings → `items`, proposals/deals → `trades`, chats → `messages`, reviews → `ratings`, contact form → `support_tickets`.
5. Re-run `baganto-regression-tests.js` (143 tests) after the change. Some will need rewriting for async.

**Practical note:** the file is too large to read in one pass with a file tool (~30k tokens). Work on it in slices with offset/limit, or grep for the specific functions to change.

### Phase 2 — Security and auth (before any real user touches this)
- **Enable RLS** on all 6 tables and write proper policies. Right now anyone with the anon key can read and write everything. Policies needed: users edit only their own profile; items writable only by `owner_id`; messages readable only by trade participants; support tickets readable only by their author and admins.
- **Rebuild authentication.** Email/password via Supabase Auth (`signUp()` / `signInWithPassword()` — note the correct method names). Session/JWT handling on the frontend.
- **Phone OTP via Twilio** — deferred, was always Phase 2.
- Move to the **service role key** for server-side writes that must bypass RLS, keeping the anon key for anything client-facing.
- Add input validation and rate limiting on the API.

### Phase 3 — Payments (blocked on business setup)
- Company registration and business bank account — **pending, this is the actual blocker**
- Razorpay account + API keys
- Wire subscription tiers to real payments
- Handle the annual (15% off) vs monthly billing distinction server-side
- Webhooks for payment success/failure; subscription state stored against the user

### Phase 4 — Deployment
- Push backend to GitHub (with `.env` gitignored)
- Deploy to **Render** or **Railway** (both have free tiers; build `npm install`, start `npm start`)
- Set env vars in the host's dashboard, not in the repo
- Update the frontend's `API_BASE_URL` from `localhost:3000` to the public URL
- Host the frontend (Netlify/Vercel/Cloudflare Pages all fine for a single HTML file)
- Configure CORS on the backend to allow only the real frontend origin
- Custom domain + HTTPS

### Phase 5 — Polish and scale
- Image upload and storage (Supabase Storage) — `items.photos` is a text column doing nothing yet
- Search and filtering on listings
- Push/email notifications
- Admin dashboard for support tickets
- Enforce the ad limits per plan (currently only displayed, not enforced)
- Database backups (currently none)
- Monitoring and error tracking

---

## 9. Pricing model (already built in the frontend)

| Plan | Monthly | Ads |
|---|---|---|
| Free | ₹0 | 3 |
| Growth | ₹199 | 25 |
| Professional | ₹499 | 50 |
| Business | ₹899 | 100 |

- **Annual billing gives 15% off**, with a Monthly/Annual toggle in the UI (segmented-control style, like a settings switch).
- Ad limits are **displayed but not enforced** — enforcement is a Phase 5 task.
- Watch for the duplicated-pricing-data bug described in §7.7.

---

## 10. Frontend features already built and passing tests

All 143 regression tests pass as of the last frontend change.

- Item listing, browsing, categories
- Barter proposals and sale flow
- Chat between traders
- Ratings and reviews after a deal
- **Contact Us page** — full page with category selection, message history, and an admin interface for replying. Note: Kiran asked for a *dedicated page*, not a row in the pricing table — an earlier attempt got this wrong. Also reachable from the header.
- Pricing page with the Monthly/Annual toggle
- Grievance Officer details (Kiran, contact@baganto.com, Vijayanagar Mysore)
- Trust & safety content

---

## 11. Decisions made, and why

- **Custom Node.js REST APIs over Supabase's auto-generated endpoints** — chosen for full control over business logic.
- **Supabase over Firebase** — Postgres, and the free tier is generous. Firebase was considered and set aside.
- **Seoul region** — lowest latency to India among available Supabase regions.
- **`contact@baganto.com`** — chosen over `support@` because it works for both business enquiries and user complaints.
- **Direct REST calls over the Supabase JS client** — emerged from debugging, kept because it's simpler to reason about.
- **Deployment deferred until payments are ready** — Kiran's call, and the right one; no point shipping a marketplace that can't take money.

---

## 12. Fastest way to pick this up in a new session

```bash
# 1. Start the backend
cd ~/Desktop/baganto-backend
npm start

# 2. In a SECOND terminal tab (Cmd+T), confirm it's alive
curl http://localhost:3000/health
curl http://localhost:3000/items     # should show the Bicycle

# 3. Open the frontend to see current state
open ~/Desktop/baganto/baganto-barter-app.html
```

Then start on **Phase 1** — connecting the frontend to the API.

---

## 13. Working notes for whoever picks this up

- Kiran is not a developer. Give one command at a time, say exactly which Terminal tab it goes in, and wait for the result before moving on. Screenshots are the usual way results come back.
- Kiran is security-conscious in a good way — asked before pasting the Mac password, cropped screenshots to hide keys. **Never ask for API keys, passwords, or anything sensitive in chat.** Direct him to copy from the Supabase dashboard into the file himself.
- When something breaks, check the simple things first: correct directory, correct spelling of the URL, correct Terminal tab, server actually restarted after a file change. Every bug in §7 was one of those.
- The frontend file is very large. Don't try to read it whole.
