// Baganto backend — minimal real server so listings, proposals, chats, purchases
// and ratings sync across every device (web, Android, iOS) instead of living only
// in one browser's localStorage.
"use strict";

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const bcryptjs = require("bcryptjs");

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

// ---- Helper: hash password with bcryptjs ----
function hashPassword(password) {
  return bcryptjs.hashSync(password, 10);
}

function checkPassword(hashed, plain) {
  return bcryptjs.compareSync(plain, hashed);
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

// ---- AUTH ENDPOINTS ----

// Signup endpoint
app.post("/auth/signup", async (req, res) => {
  const { name, email, phone, city, password } = req.body;

  // Validation
  if (!name || !email || !phone || !password) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const db = readDb();

  // Check if user already exists
  const existingEmail = db.users.find((u) => u.email === email);
  if (existingEmail) {
    return res.status(400).json({ error: "Email already registered" });
  }

  const existingPhone = db.users.find((u) => u.phone === phone);
  if (existingPhone) {
    return res.status(400).json({ error: "Phone already registered" });
  }

  // Create new user
  const newUser = {
    id: "u" + Math.random().toString(36).substr(2, 9),
    name: name,
    email: email,
    phone: phone,
    city: city || "Mysore, Karnataka",
    avatar: "🙂",
    memberSince: Date.now(),
    pwHash: hashPassword(password),
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

  try {
    await persist(db);
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
  } catch (e) {
    res.status(500).json({ error: "Failed to save user", detail: String(e) });
  }
});

// Login endpoint
app.post("/auth/login", (req, res) => {
  const { email, phone, password } = req.body;

  if (!password || (!email && !phone)) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  const db = readDb();

  // Find user by email or phone
  const user = db.users.find((u) => (email && u.email === email) || (phone && u.phone === phone));

  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  // Verify password
  if (!checkPassword(user.pwHash, password)) {
    return res.status(401).json({ error: "Incorrect password" });
  }

  // Login successful
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
