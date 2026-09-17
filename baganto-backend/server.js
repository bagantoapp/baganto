// Baganto backend — simplified auth using db.json
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

// Read database
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

// Write database
function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Hash/check password
function hashPassword(password) {
  return bcryptjs.hashSync(password, 10);
}

function checkPassword(hashed, plain) {
  return bcryptjs.compareSync(plain, hashed);
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

// Get full database
app.get("/api/db", (req, res) => {
  res.json(readDb());
});

// Update full database
app.put("/api/db", (req, res) => {
  const body = req.body;
  if (!body || !Array.isArray(body.users) || !Array.isArray(body.items)) {
    return res.status(400).json({ error: "Malformed DB payload" });
  }
  try {
    writeDb(body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to persist", detail: String(e) });
  }
});

// ---- AUTH ENDPOINTS ----

// Signup
app.post("/auth/signup", (req, res) => {
  const { name, email, phone, city, password } = req.body;

  if (!name || !email || !phone || !password) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const db = readDb();

  // Check if user exists
  if (db.users.some((u) => u.email === email)) {
    return res.status(400).json({ error: "Email already registered" });
  }
  if (db.users.some((u) => u.phone === phone)) {
    return res.status(400).json({ error: "Phone already registered" });
  }

  // Create user
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

// Login
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

  if (!checkPassword(user.pwHash, password)) {
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
