// Baganto backend — minimal real server so listings, proposals, chats, purchases
// and ratings sync across every device (web, Android, iOS) instead of living only
// in one browser's localStorage.
//
// Design: the client (baganto-barter-app.html) already keeps its entire state in
// one in-memory `DB` object ({users, items, deals, messages, ratings}) and calls
// saveDB() after every mutation. Rather than rewriting every call site into many
// fine-grained REST endpoints (high risk of regressions in an already-tested app),
// this server exposes the whole DB as one resource:
//   GET  /api/db        -> current shared state (seeds it on first run)
//   PUT  /api/db        -> client pushes its full updated state after a mutation
//   POST /api/db/reset  -> reset everyone back to the original demo seed
// This is intentionally simple for an MVP-scale prototype (single shared
// marketplace, not per-account auth) — see README in this folder for the
// production hardening checklist (auth, per-resource endpoints, a real DB engine,
// optimistic-lock/merge for concurrent writers, etc).
"use strict";

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const { buildSeed } = require("./seed");

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "db.json");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ---- tiny write queue so concurrent PUTs can't interleave and corrupt the file ----
let writing = Promise.resolve();
function persist(data) {
  writing = writing.then(
    () =>
      new Promise((resolve, reject) => {
        fs.writeFile(DB_FILE, JSON.stringify(data), (err) => (err ? reject(err) : resolve()));
      })
  );
  return writing;
}

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    const fresh = buildSeed();
    fs.writeFileSync(DB_FILE, JSON.stringify(fresh));
    return fresh;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {
    const fresh = buildSeed();
    fs.writeFileSync(DB_FILE, JSON.stringify(fresh));
    return fresh;
  }
}

app.get("/api/health", (req, res) => res.json({ ok: true, time: Date.now() }));

app.get("/api/db", (req, res) => {
  res.json(readDb());
});

app.put("/api/db", async (req, res) => {
  const body = req.body;
  if (!body || !Array.isArray(body.users) || !Array.isArray(body.items)) {
    return res.status(400).json({ error: "Malformed DB payload" });
  }
  try {
    await persist(body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to persist", detail: String(e) });
  }
});

app.post("/api/db/reset", async (req, res) => {
  const fresh = buildSeed();
  try {
    await persist(fresh);
    res.json(fresh);
  } catch (e) {
    res.status(500).json({ error: "Failed to reset", detail: String(e) });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Baganto backend listening on http://0.0.0.0:${PORT}`);
});
