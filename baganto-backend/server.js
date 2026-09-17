"use strict";

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const bcryptjs = require("bcryptjs");

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "db.json");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    return { users: [], items: [], deals: [], messages: [], purchases: [], ratings: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {
    return { users: [], items: [], deals: [], messages: [], purchases: [], ratings: [] };
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

app.get("/api/db", (req, res) => {
  res.json(readDb());
});

app.put("/api/db", (req, res) => {
  const incoming = req.body;
  if (!incoming || !Array.isArray(incoming.users) || !Array.isArray(incoming.items)) {
    return res.status(400).json({ error: "Malformed DB payload" });
  }
  try {
    const current = readDb();

    // --- users: incoming fields win, but the server's pwHash is never clobbered
    const serverUsers = new Map((current.users || []).map((u) => [u.id, u]));
    const mergedUsers = incoming.users.map((u) => {
      const existing = serverUsers.get(u.id);
      if (!existing) return u;
      serverUsers.delete(u.id);
      return Object.assign({}, existing, u, { pwHash: existing.pwHash || u.pwHash });
    });
    for (const leftover of serverUsers.values()) mergedUsers.push(leftover);

    // --- items: union by id so another session's listings aren't wiped
    const byId = new Map((current.items || []).map((it) => [it.id, it]));
    for (const it of incoming.items) byId.set(it.id, it);

    const merged = Object.assign({}, current, incoming, {
      users: mergedUsers,
      items: Array.from(byId.values())
    });

    writeDb(merged);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to persist", detail: String(e) });
  }
});

app.post("/auth/signup", (req, res) => {
  const { name, email, phone, city, password } = req.body;

  if (!name || !email || !phone || !password) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const db = readDb();

  if (db.users.some((u) => u.email === email)) {
    return res.status(400).json({ error: "Email already registered" });
  }
  if (db.users.some((u) => u.phone === phone)) {
    return res.status(400).json({ error: "Phone already registered" });
  }

  const newUser = {
    id: "u" + Math.random().toString(36).substr(2, 9),
    name: name,
    email: email,
    phone: phone,
    city: city || "Mysore, Karnataka",
    avatar: "🙂",
    memberSince: Date.now(),
    pwHash: bcryptjs.hashSync(password, 10),
    phoneVerified: false,
    emailVerified: false,
    isVerified: false,
    blockedUsers: [],
    reputationScore: 50,
    dealCompletionRate: 0,
    responseTimeHours: 24,
    fraudFlags: 0
  };

  db.users.push(newUser);
  writeDb(db);

  res.json({
    ok: true,
    user: {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      phone: newUser.phone,
      city: newUser.city,
      avatar: newUser.avatar
    }
  });
});

app.post("/auth/login", (req, res) => {
  const { email, phone, password } = req.body;

  if (!password || (!email && !phone)) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  const db = readDb();
  const user = db.users.find((u) => (email && u.email === email) || (phone && u.phone === phone));

  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  if (!bcryptjs.compareSync(password, user.pwHash)) {
    return res.status(401).json({ error: "Incorrect password" });
  }

  res.json({
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      city: user.city,
      avatar: user.avatar
    }
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Baganto backend listening on http://0.0.0.0:${PORT}`);
});
