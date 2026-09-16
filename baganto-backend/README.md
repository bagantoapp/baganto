# Baganto backend

Minimal real server so listings, proposals, chats, ratings and purchases sync
across every device (web, Android, iOS) instead of living in one browser's
localStorage.

## Run locally

```
npm install
npm start
```

Listens on `http://0.0.0.0:3000`. Data persists to `db.json` next to
`server.js` (auto-seeded with demo data on first run).

## API

- `GET /api/health` — liveness check.
- `GET /api/db` — returns the full shared state `{users, items, deals, messages, ratings}`.
- `PUT /api/db` — client pushes its full updated state after any change.
- `POST /api/db/reset` — wipes everyone back to the original demo seed.

This is a deliberately simple "whole state" sync model — there's no
per-account auth, and the last write wins on conflicts. Fine for a demo /
single-shared-marketplace MVP; see "Hardening for production" below before
relying on this for real users.

## Deploying so your phone can actually reach it

`localhost:3000` only works on the same machine. To get real cross-device
sync on actual phones, deploy this folder to a host with a public URL, e.g.:

- [Render](https://render.com) or [Railway](https://railway.app) — free
  tiers exist; point them at this folder, build command `npm install`,
  start command `npm start`.
- Your own VPS — `npm install && npm start` behind a process manager
  (pm2/systemd) and a reverse proxy (nginx/Caddy) for HTTPS.

Once deployed, set `window.BAGANTO_API_BASE` in the app to that public URL
(see the main app's README / the `baganto-app/README.md` notes on this).

## Hardening for production

This was built to prove out real sync, not as a production-grade backend.
Before real users rely on it, you'd want:

- Real user accounts/auth (currently anyone can write anyone else's data).
- Per-resource endpoints instead of one whole-DB blob (smaller payloads,
  proper conflict handling instead of last-write-wins).
- A real database (Postgres/SQLite) instead of a single JSON file.
- Input validation beyond the current "users/items must be arrays" check.
- Rate limiting / abuse protection.
