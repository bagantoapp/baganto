const express = require('express');
require('dotenv').config();
const cors = require('cors');
if (!process.env.service_role) {
  throw new Error('The service_role environment variable must be set before the server starts');
}

const app = express();
app.use(cors({ origin: 'https://baganto.com' }));
const bcryptjs = require('bcryptjs');
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
});

const rateLimit = require('express-rate-limit');

app.use(express.json({ limit: '10mb' }));
app.set('etag', false);

// Supabase REST API config
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.anon_public;

// Helper function for Supabase REST API calls
async function supabaseCall(table, method = 'GET', data = null, filters = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${filters}`;
  // user_plans is private (plan limits); only the server's service_role key may touch it
  // All database calls use the server-only service_role key, so Row Level Security can block the public anon key.
  const key = process.env.service_role || SUPABASE_KEY;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'apikey': key,
      'Prefer': 'return=representation'
    }
  };
  if (data) options.body = JSON.stringify(data);

  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || JSON.stringify(result));
  return result;
}

// ============ INPUT VALIDATION ============
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  return password && password.length >= 8;
}

function validateString(str, minLength = 1, maxLength = 500) {
  return typeof str === 'string' && str.length >= minLength && str.length <= maxLength;
}
// ============ HEALTH ============
app.get('/health', (req, res) => {
  res.json({ status: 'Backend is running!', timestamp: new Date().toISOString() });
});

// ============ ITEMS (Listings) ============
// An ad whose end date has passed is shown as expired, even if its stored status still says available.
function effectiveItem(it) {
  if (it && it.status === 'available' && it.expires_at && new Date(it.expires_at) < new Date()) {
    return Object.assign({}, it, { status: 'expired' });
  }
  return it;
}

// Ids of accounts that are deactivated. If the lookup fails, nothing is hidden.
async function deactivatedIds() {
  try {
    const rows = await sbFetch('users?deactivated=eq.true&select=id', 'GET');
    return new Set(rows.map(r => r.id));
  } catch (e) {
    return new Set();
  }
}

function optionalUid(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? verifyAuthToken(h.slice(7)) : '';
}

// IDs of people who have blocked this user, or whom this user has blocked.
async function blockedOtherIds(uid) {
  const ids = new Set();
  if (!uid) return ids;
  const rows = await sbFetch(`user_blocks?or=(blocker_id.eq.${encodeURIComponent(uid)},blocked_id.eq.${encodeURIComponent(uid)})&select=blocker_id,blocked_id`, 'GET');
  rows.forEach(r => ids.add(r.blocker_id === uid ? r.blocked_id : r.blocker_id));
  return ids;
}

app.get('/items', async (req, res) => {
  try {
    const data = await supabaseCall('items');
    const hidden = await blockedOtherIds(optionalUid(req));
    const offIds = await deactivatedIds();
    res.json((data || []).map(effectiveItem).filter(it => !hidden.has(it.owner_id) && !offIds.has(it.owner_id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/items/:id', async (req, res) => {
  try {
    const data = await supabaseCall('items', 'GET', null, `?id=eq.${req.params.id}`);
    const row = data[0] || null;
    if (row && (await blockedOtherIds(optionalUid(req))).has(row.owner_id)) return res.json(null);
    res.json(effectiveItem(row));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function makeAuthToken(userId) {
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const payload = `${userId}|${exp}`;
  const sig = require('crypto').createHmac('sha256', process.env.AUTH_SECRET).update('auth:' + payload).digest('hex');
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}

function verifyAuthToken(token) {
  try {
    if (!process.env.AUTH_SECRET) return null;
    const [part, sig] = String(token || '').split('.');
    if (!part || !sig) return null;
    const payload = Buffer.from(part, 'base64url').toString();
    const [userId, exp] = payload.split('|');
    const expect = require('crypto').createHmac('sha256', process.env.AUTH_SECRET).update('auth:' + payload).digest('hex');
    if (sig.length !== expect.length) return null;
    if (!require('crypto').timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    if (!userId || Date.now() > Number(exp)) return null;
    return userId;
  } catch (e) {
    return null;
  }
}

function requireAuth(req, res, next) {
  if (!process.env.AUTH_SECRET) return res.status(500).json({ error: 'Server auth is not configured' });
  const h = req.headers.authorization || '';
  const userId = verifyAuthToken(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!userId) return res.status(401).json({ error: 'Please log in again' });
  req.userId = userId;
  next();
}

async function itemOwnerId(id) {
  const rows = await supabaseCall('items', 'GET', null, `?id=eq.${encodeURIComponent(id)}&select=owner_id`);
  return rows && rows[0] ? rows[0].owner_id : null;
}


// ============ PLAN LIMITS ============
async function getUserPlan(userId) {
  try {
    let plan = await supabaseCall('user_plans', 'GET', null, `?user_id=eq.${userId}`);
    if (!plan || plan.length === 0) {
      // First time user - create Free plan
      const newPlan = { user_id: userId, plan_type: 'free', ads_used_this_month: 0, boosts_available: 0, premium_credits: 0, reset_date: new Date().toISOString().split('T')[0] };
      plan = await supabaseCall('user_plans', 'POST', newPlan);
      return plan[0] || newPlan;
    }
    return plan[0];
  } catch (e) {
    console.error('Error getting user plan:', e.message);
    throw new Error('Could not fetch plan info');
  }
}

// Count the ads this user has posted since the start of the current calendar month (UTC).
async function countPostsThisMonth(userId) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const rows = await sbFetch(`items?owner_id=eq.${encodeURIComponent(userId)}&created_at=gte.${encodeURIComponent(start.toISOString())}&select=id`, 'GET');
  return rows.length;
}

async function canPostAd(userId) {
  const plan = await getUserPlan(userId);
  const limits = {
    free: 3,
    growth: 25,
    professional: 50,
    business: 100
  };
  const limit = limits[planTypeOf(plan)] || 3;
  const used = await countPostsThisMonth(userId);
  return used < limit;
}

async function deductAd(userId) {
  try {
    const plan = await getUserPlan(userId);
    await supabaseCall('user_plans', 'PATCH', { ads_used_this_month: (plan.ads_used_this_month || 0) + 1 }, `?user_id=eq.${userId}`);
  } catch (e) {
    console.error('Error deducting ad:', e.message);
  }
}

app.post('/items', requireAuth, async (req, res) => {
  try {
    // Check if user can post (plan limit)
    const canPost = await canPostAd(req.userId);
    if (!canPost) {
      const plan = await getUserPlan(req.userId);
      const limits = { free: 3, growth: 25, professional: 50, business: 100 };
      const limit = limits[planTypeOf(plan)] || 3;
      return res.status(429).json({ error: `Monthly ad limit (${limit}) reached. Upgrade your plan or wait for reset.` });
    }
    
    const { title, description, category, price, condition, listing_type, photos } = req.body;
    const owner_id = req.userId;
    const photosArray = Array.isArray(photos) ? photos : [];
    const data = await supabaseCall('items', 'POST', { owner_id, title, description, category, price, condition, listing_type, photos: photosArray });
    
    // Deduct one ad from monthly count
    await deductAd(req.userId);
    
    res.json(data[0] || data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/items/:id', requireAuth, async (req, res) => {
  try {
    if (await itemOwnerId(req.params.id) !== req.userId) return res.status(403).json({ error: 'Not your listing' });
    const allowed = ['title', 'description', 'category', 'price', 'condition', 'listing_type', 'photos', 'status', 'want_in_exchange', 'city', 'expires_at'];
    const updates = {};
    for (const k of allowed) { if (req.body && k in req.body) updates[k] = req.body[k]; }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });
    // Reposting an expired ad counts as a new post: check the limit and move it into this month.
    if (req.body && req.body.status === 'available') {
      const cur = await supabaseCall('items', 'GET', null, `?id=eq.${encodeURIComponent(req.params.id)}&select=status,expires_at`);
      if (cur[0] && effectiveItem(cur[0]).status !== 'available') {
        if (!(await canPostAd(req.userId))) return res.status(429).json({ error: 'Monthly ad limit reached. Upgrade your plan to repost.' });
        updates.created_at = new Date().toISOString();
      }
    }
    const data = await supabaseCall('items', 'PATCH', updates, `?id=eq.${encodeURIComponent(req.params.id)}`);
    res.json(data[0] || data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/items/:id', requireAuth, async (req, res) => {
  try {
    if (await itemOwnerId(req.params.id) !== req.userId) return res.status(403).json({ error: 'Not your listing' });
    await supabaseCall('items', 'DELETE', null, `?id=eq.${req.params.id}`);
    res.json({ message: 'Item deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============ TRADES (Proposals) ============
app.get('/trades', async (req, res) => {
  return res.status(410).json({ error: 'This endpoint is disabled' });
  try {
    const data = await supabaseCall('trades');
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/trades', async (req, res) => {
  return res.status(410).json({ error: 'This endpoint is disabled' });
  try {
    const { from_user_id, to_user_id, item_id, kind, status } = req.body;
    const data = await supabaseCall('trades', 'POST', { from_user_id, to_user_id, item_id, kind, status });
    res.json(data[0] || data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/trades/:id', async (req, res) => {
  return res.status(410).json({ error: 'This endpoint is disabled' });
  return res.status(410).json({ error: 'This endpoint is disabled' });
  try {
    const data = await supabaseCall('trades', 'PATCH', req.body, `?id=eq.${req.params.id}`);
    res.json(data[0] || data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============ MESSAGES ============
app.get('/messages/:tradeId', async (req, res) => {
  return res.status(410).json({ error: 'This endpoint is disabled' });
  try {
    const data = await supabaseCall('messages', 'GET', null, `?trade_id=eq.${req.params.tradeId}&order=created_at.asc`);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/messages', async (req, res) => {
  return res.status(410).json({ error: 'This endpoint is disabled' });
  return res.status(410).json({ error: 'This endpoint is disabled' });
  try {
    const { trade_id, sender_id, content, photo } = req.body;
    const data = await supabaseCall('messages', 'POST', { trade_id, sender_id, content, photo });
    res.json(data[0] || data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============ RATINGS ============
app.get('/ratings/:userId', async (req, res) => {
  return res.status(410).json({ error: 'This endpoint is disabled' });
  try {
    const data = await supabaseCall('ratings', 'GET', null, `?to_user_id=eq.${req.params.userId}`);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/ratings', async (req, res) => {
  return res.status(410).json({ error: 'This endpoint is disabled' });
  return res.status(410).json({ error: 'This endpoint is disabled' });
  try {
    const { from_user_id, to_user_id, trade_id, rating, review } = req.body;
    const data = await supabaseCall('ratings', 'POST', { from_user_id, to_user_id, trade_id, rating, review });
    res.json(data[0] || data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============ USERS ============
app.get('/users/:id', async (req, res) => {
  try {
    const data = await supabaseCall('users', 'GET', null, `?id=eq.${req.params.id}`);
    const u = data[0];
    if (!u) return res.json(null);
    if (u.deactivated && optionalUid(req) !== u.id) return res.json(null);
    const { password, ...rest } = u;
    const uid = optionalUid(req);
    if (uid && uid === u.id) return res.json(rest);
    if ((await blockedOtherIds(uid)).has(u.id)) return res.json(null);
    const { email, phone, date_of_birth, terms_accepted_at, ...pub } = rest;
    res.json(pub);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/users', async (req, res) => {
  return res.status(410).json({ error: 'This endpoint is disabled' });
  try {
    const { id, email, phone, name, city, bio } = req.body;
    const data = await supabaseCall('users', 'POST', { id, email, phone, name, city, bio });
    res.json(data[0] || data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/users/:id/change-password', requireAuth, async (req, res) => {
  try {
    if (req.userId !== req.params.id) return res.status(403).json({ error: 'Not allowed' });
    const { currentPassword, newPassword } = req.body || {};
    if (!await checkLoginLimit('pwchange:' + req.ip)) {
      return res.status(429).json({ error: 'Too many attempts, please wait a minute' });
    }
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (!validatePassword(newPassword)) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const rows = await supabaseCall('users', 'GET', null, `?id=eq.${encodeURIComponent(req.params.id)}`);
    const row = (rows || [])[0];
    if (!row || !await bcryptjs.compare(currentPassword, row.password || '')) {
      return res.status(403).json({ error: 'Current password is incorrect' });
    }
    const hashed = await bcryptjs.hash(newPassword, 10);
    await supabaseCall('users', 'PATCH', { password: hashed }, `?id=eq.${encodeURIComponent(req.params.id)}`);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/users/:id', requireAuth, async (req, res) => {
  try {
    if (req.userId !== req.params.id) return res.status(403).json({ error: 'Not allowed' });
    const allowed = ['name', 'city', 'bio', 'avatar', 'avatarPhoto'];
    const updates = {};
    for (const k of allowed) {
      if (req.body && k in req.body) updates[k] = req.body[k];
    }
    if (typeof updates.avatarPhoto === 'string' && updates.avatarPhoto.length > 300000) {
      return res.status(413).json({ error: 'Photo is too large' });
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    const data = await supabaseCall('users', 'PATCH', updates, `?id=eq.${req.params.id}`);
    const row = Array.isArray(data) ? data[0] : data;
    if (row) delete row.password;
    res.json(row || {});
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============ SUPPORT TICKETS ============
app.get('/support', async (req, res) => {
  return res.status(410).json({ error: 'This endpoint is disabled' });
  try {
    const data = await supabaseCall('support_tickets', 'GET', null, '?order=created_at.desc');
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/support', async (req, res) => {
  try {
    const h = req.headers.authorization || '';
    const uid = h.startsWith('Bearer ') ? verifyAuthToken(h.slice(7)) : '';
    const t = req.body && req.body.ticket;
    if (!t || typeof t !== 'object') return res.status(400).json({ error: 'Invalid ticket' });
    const message = String(t.message || '').slice(0, 5000);
    if (!message.trim()) return res.status(400).json({ error: 'Message is required' });
    const subject = String(t.subject || '').slice(0, 200);
    const category = String(t.category || '').slice(0, 100);
    const contact_email = String(t.contactEmail || '').slice(0, 200);
    await sbFetch('support_tickets', 'POST', { user_id: uid || null, contact_email, category, subject, message, status: 'open' });
    notifyTelegram([
      '📩 New support message on Baganto',
      'Category: ' + (category || '-'),
      'Subject: ' + (subject || '-'),
      ...(await userContactLines(uid)),
      'Ticket email: ' + (contact_email || '-'),
      'Message: ' + message.slice(0, 1000)
    ].join('\n'));
    res.json({ success: true });
  } catch (err) {
    console.error('POST /support error:', err.message);
    res.status(500).json({ error: 'Could not send message' });
  }
});

app.put('/support/:id', async (req, res) => {
  return res.status(410).json({ error: 'This endpoint is disabled' });
  try {
    const data = await supabaseCall('support_tickets', 'PATCH', req.body, `?id=eq.${req.params.id}`);
    res.json(data[0] || data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// GET /api/db
app.get('/api/db', async (req, res) => {
  try {
    const items = await supabaseCall('items');
    const users = ((await supabaseCall('users')) || []).map(u => {
      const { password, email, phone, date_of_birth, terms_accepted_at, ...safe } = u;
      return safe;
    });
    const hiddenOwners = await blockedOtherIds(optionalUid(req));
    const offIds = await deactivatedIds();
    const out = { items: (items || []).map(effectiveItem).filter(it => !hiddenOwners.has(it.owner_id) && !offIds.has(it.owner_id)), users };
    // If the caller is logged in, include their real monthly ad count so every device shows the true limit
    const h = req.headers.authorization || '';
    const uid = h.startsWith('Bearer ') ? verifyAuthToken(h.slice(7)) : '';
    if (uid) {
      try {
        const plan = await getUserPlan(uid);
        const today = new Date().toISOString().split('T')[0];
        const used = await countPostsThisMonth(uid);
        out.my_plan = { user_id: uid, plan_type: planTypeOf(plan), ads_used_this_month: used,
          plan_expires_at: plan.plan_expires_at || null, boosts_available: plan.boosts_available || 0,
          premium7_credits: plan.premium7_credits || 0, premium30_credits: plan.premium30_credits || 0 };
      } catch (e) { /* plan lookup failed; still return items */ }
    }
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/db
app.put('/api/db', async (req, res) => {
  res.json({ success: true });
});



// ===== AUTH ENDPOINTS =====

// POST /auth/signup - create a new user with a password
function makeSignupToken(email) {
  const exp = Date.now() + 15 * 60 * 1000;
  const payload = `${email}|${exp}`;
  const sig = require('crypto')
    .createHmac('sha256', process.env.service_role)
    .update('signup-token:' + payload)
    .digest('hex');
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}

function checkSignupToken(token, email) {
  try {
    const [b, sig] = String(token).split('.');
    const payload = Buffer.from(b, 'base64url').toString();
    const [tEmail, exp] = payload.split('|');
    const expect = require('crypto')
      .createHmac('sha256', process.env.service_role)
      .update('signup-token:' + payload)
      .digest('hex');
    if (!sig || sig.length !== expect.length) return false;
    if (!require('crypto').timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
    return tEmail === email && Date.now() < Number(exp);
  } catch (e) {
    return false;
  }
}

// True only if the date of birth (YYYY-MM-DD) gives an age of 18 or more.
function isAdult(dob) {
  if (typeof dob !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false;
  const b = new Date(dob + 'T00:00:00Z');
  if (isNaN(b.getTime())) return false;
  const t = new Date();
  let age = t.getUTCFullYear() - b.getUTCFullYear();
  const m = t.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && t.getUTCDate() < b.getUTCDate())) age--;
  return age >= 18 && age <= 120;
}

app.post('/auth/signup', async (req, res) => {
  try {
    const { email, phone, name, city, bio, password, dob } = req.body;
    if (!isAdult(dob)) {
      return res.status(403).json({ error: 'You must be 18 or older to create a Baganto account' });
    }
    if (req.body.acceptTerms !== true) {
      return res.status(400).json({ error: 'You must agree to the Terms and Conditions and Privacy Policy' });
    }
    // Validate input
    if (!validateString(name, 1, 100)) {
    return res.status(400).json({ error: 'name must be 1-100 characters' });
    }
    if (!validatePassword(password)) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
    }
    if (email && !validateEmail(email)) {
    return res.status(400).json({ error: 'invalid email format' });
    }
    if (!checkSignupToken(req.body.signupToken, email)) {
      return res.status(403).json({ error: 'Verify your email first' });
    }
    if (email) {
      const exE = await supabaseCall('users', 'GET', null, `?email=eq.${encodeURIComponent(email)}&select=id`);
      if (exE && exE.length) return res.status(409).json({ error: 'That email is already registered' });
    }
    if (phone) {
      const exP = await supabaseCall('users', 'GET', null, `?phone=eq.${encodeURIComponent(phone)}&select=id`);
      if (exP && exP.length) return res.status(409).json({ error: 'That phone number is already registered' });
    }
    const userId = require('crypto').randomUUID();
    const hashedPassword = await bcryptjs.hash(password, 10);
    const newUser = {
      id: userId,
      date_of_birth: dob,
      terms_accepted_at: new Date().toISOString(),
      email: email || null,
      phone: phone || null,
      name: name,
      city: city || null,
      bio: bio || null,
      password: hashedPassword
    };
    const created = await supabaseCall('users', 'POST', newUser);
    const user = Array.isArray(created) ? created[0] : created;
    delete user.password;
    res.json({ success: true, user: user, token: process.env.AUTH_SECRET ? makeAuthToken(user.id) : null });
  } catch (err) {
    console.error('POST /auth/signup error:', err.message);
    res.status(400).json({ error: err.message });
  }
});


// Rate limit for login endpoint - using Supabase for multi-instance support
async function checkLoginLimit(identifier) {
  try {
    const now = Date.now();
    console.log(`Rate limit check for: ${identifier}`);
    const oneMinuteAgo = now - 60 * 1000;
    const serviceRoleKey = process.env.service_role;
    
    // Query attempts in last 60 seconds
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/login_attempts?identifier=eq.${encodeURIComponent(identifier)}&attempted_at=gt.${oneMinuteAgo}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey
        }
      }
    );
    
    const data = await response.json();
    console.log(`Rate limit check - Status: ${response.status}, Data:`, data);
    
    if (Array.isArray(data) && data.length >= 5) {
      console.log(`BLOCKED: Too many attempts (${data.length})`);
      return false;
    }
    
    await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/login_attempts`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey
        },
        body: JSON.stringify({ identifier, attempted_at: now })
      }
    );
    
    return true;
  } catch (err) {
    console.error('Rate limit check error:', err.message);
    return true;
  }
}

// ---------- Email OTP (signup verification + password reset) ----------
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function otpHash(purpose, email, code) {
  return require('crypto')
    .createHmac('sha256', process.env.service_role)
    .update(`${purpose}:${email}:${code}`)
    .digest('hex');
}

async function sbFetch(path, method, body) {
  const key = process.env.service_role;
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'apikey': key,
      'Prefer': 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path} failed: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function sendOtpEmail(to, code, purpose) {
  const subject = purpose === 'reset'
    ? 'Your Baganto password reset code'
    : 'Your Baganto verification code';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.OTP_FROM || 'Baganto <onboarding@resend.dev>',
      to: [to],
      subject,
      html: `<p>Your code is <strong>${code}</strong>. It expires in 10 minutes.</p><p>If you did not request this, you can ignore this email.</p>`
    })
  });
  if (!r.ok) throw new Error(`Resend send failed: ${r.status}`);
}

// POST /auth/otp/send - body: { email, purpose: 'signup' | 'reset' }
app.post('/auth/otp/send', async (req, res) => {
  try {
    const { email, purpose } = req.body;
    if (!['signup', 'reset'].includes(purpose) || !validateEmail(email)) {
      return res.status(400).json({ error: 'valid email and purpose (signup or reset) required' });
    }
    if (!await checkLoginLimit('otp-send-email:' + String(email).toLowerCase())) {
      return res.status(429).json({ error: 'Too many codes sent to this email, please wait a minute' });
    }
    if (!await checkLoginLimit('otp-send:' + req.ip)) {
      return res.status(429).json({ error: 'Too many requests, please wait a minute' });
    }
    if (purpose === 'signup') {
      const existing = await sbFetch(`users?email=eq.${encodeURIComponent(email)}&select=id`, 'GET');
      if (existing.length) return res.status(409).json({ error: 'That email is already registered. Try logging in.' });
    }
    if (purpose === 'reset') {
      const users = await sbFetch(`users?email=eq.${encodeURIComponent(email)}&select=id`, 'GET');
      // Same response whether or not the account exists, so emails can't be probed
      if (!users.length) return res.status(404).json({ error: 'No account is registered with this email' });
    }
    // Invalidate older codes for this email and purpose
    await sbFetch(`otp_codes?purpose=eq.${purpose}&email=eq.${encodeURIComponent(email)}`, 'DELETE');
    const code = String(require('crypto').randomInt(100000, 1000000));
    await sbFetch('otp_codes', 'POST', {
      purpose,
      email,
      code_hash: otpHash(purpose, email, code),
      expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString()
    });
    await sendOtpEmail(email, code, purpose);
    res.json({ success: true });
  } catch (err) {
    console.error('POST /auth/otp/send error:', err.message);
    res.status(500).json({ error: 'Could not send code, please try again' });
  }
});

// POST /auth/otp/verify - body: { email, purpose, code, newPassword? }
app.post('/auth/otp/verify', async (req, res) => {
  try {
    const { email, purpose, code, newPassword } = req.body;
    if (!['signup', 'reset'].includes(purpose) || !validateEmail(email) || !/^\d{6}$/.test(String(code))) {
      return res.status(400).json({ error: 'valid email, purpose and 6-digit code required' });
    }
    const rows = await sbFetch(
      `otp_codes?purpose=eq.${purpose}&email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=1`,
      'GET'
    );
    const row = rows[0];
    if (!row || new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Code expired or not found, please request a new one' });
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(400).json({ error: 'Too many wrong attempts, please request a new code' });
    }
    const expected = Buffer.from(row.code_hash);
    const given = Buffer.from(otpHash(purpose, email, String(code)));
    const ok = expected.length === given.length && require('crypto').timingSafeEqual(expected, given);
    if (!ok) {
      await sbFetch(`otp_codes?id=eq.${row.id}`, 'PATCH', { attempts: row.attempts + 1 });
      return res.status(400).json({ error: 'Incorrect code' });
    }
    await sbFetch(`otp_codes?id=eq.${row.id}`, 'DELETE');

    if (purpose === 'reset') {
      if (!validatePassword(newPassword)) {
        return res.status(400).json({ error: 'password must be at least 8 characters' });
      }
      const hashed = await bcryptjs.hash(newPassword, 10);
      await sbFetch(`users?email=eq.${encodeURIComponent(email)}`, 'PATCH', { password: hashed });
    }
    res.json(purpose === 'signup'
      ? { success: true, signupToken: makeSignupToken(email) }
      : { success: true });
  } catch (err) {
    console.error('POST /auth/otp/verify error:', err.message);
    res.status(500).json({ error: 'Could not verify code, please try again' });
  }
});

// ---------- Deals, messages and ratings (only the two people in a deal) ----------
app.get('/social/mine', requireAuth, async (req, res) => {
  try {
    const serverTime = new Date().toISOString();
    const sinceRaw = typeof req.query.since === 'string' ? req.query.since : '';
    const since = sinceRaw && !isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : '';
    const me = encodeURIComponent(req.userId);
    const deals = await sbFetch(`deals?or=(user_a.eq.${me},user_b.eq.${me})&select=id,data`, 'GET');
    let messages = [];
    if (deals.length) {
      const list = deals.map(d => '"' + String(d.id).replace(/"/g, '') + '"').join(',');
      const sinceFilter = since ? `&created_at=gt.${encodeURIComponent(since)}` : '';
      messages = await sbFetch(`deal_messages?deal_id=in.(${encodeURIComponent(list)})${sinceFilter}&select=data&order=created_at.asc`, 'GET');
    }
    const ratings = await sbFetch('deal_ratings?select=data', 'GET');
    const notifs = await sbFetch(`notifications?user_id=eq.${me}&order=created_at.desc&limit=50&select=data,is_read`, 'GET');
    const blockRows = await sbFetch(`user_blocks?blocker_id=eq.${me}&select=blocked_id`, 'GET');
    const savedRows = await sbFetch(`saved_items?user_id=eq.${me}&select=item_id`, 'GET');
    res.json({ serverTime, deals: deals.map(d => d.data), messages: messages.map(m => m.data), ratings: ratings.map(r => r.data), blocked: blockRows.map(x => x.blocked_id), saved: savedRows.map(x => x.item_id), notifications: notifs.map(x => Object.assign({}, x.data, { read: !!x.is_read })) });
  } catch (err) {
    console.error('GET /social/mine error:', err.message);
    res.status(500).json({ error: 'Could not load chats' });
  }
});

app.post('/social/deal', requireAuth, async (req, res) => {
  try {
    const d = req.body && req.body.deal;
    if (!d || typeof d.id !== 'string' || !d.fromUserId || !d.toUserId) return res.status(400).json({ error: 'Invalid deal' });
    if (JSON.stringify(d).length > 200000) return res.status(413).json({ error: 'Deal too large' });
    delete d.typingUsers;
    const existing = await sbFetch(`deals?id=eq.${encodeURIComponent(d.id)}&select=user_a,user_b,data`, 'GET');
    if (existing.length) {
      const row = existing[0];
      if (row.user_a !== req.userId && row.user_b !== req.userId) return res.status(403).json({ error: 'Not your deal' });
      d.fromUserId = row.user_a;
      d.toUserId = row.user_b;
      const oldSt = (row.data && row.data.status) || 'pending';
      const newSt = d.status || 'pending';
      const rank = { pending: 0, accepted: 1, rejected: 2, withdrawn: 2, completed: 3 };
      if (newSt !== oldSt && rank[newSt] !== undefined && rank[oldSt] !== undefined) {
        let ok = rank[newSt] > rank[oldSt] || (newSt === 'pending' && (oldSt === 'rejected' || oldSt === 'withdrawn') && req.userId === row.user_a);
        if (ok && (newSt === 'accepted' || newSt === 'rejected') && req.userId !== row.user_b) ok = false;
        if (ok && newSt === 'withdrawn' && req.userId !== row.user_a) ok = false;
        if (ok && newSt === 'completed' && oldSt !== 'accepted') ok = false;
        if (!ok) d.status = oldSt;
      }
      const oldRead = (row.data && row.data.readAt) || {};
      const newRead = d.readAt || {};
      const mergedRead = Object.assign({}, oldRead);
      if (newRead[req.userId] !== undefined) mergedRead[req.userId] = Math.max(Number(oldRead[req.userId]) || 0, Number(newRead[req.userId]) || 0);
      d.readAt = mergedRead;
      const oldHidden = (row.data && row.data.hiddenFor) || {};
      const newHidden = d.hiddenFor || {};
      const mergedHidden = Object.assign({}, oldHidden);
      if (newHidden[req.userId] !== undefined) mergedHidden[req.userId] = Math.max(Number(oldHidden[req.userId]) || 0, Number(newHidden[req.userId]) || 0);
      d.hiddenFor = mergedHidden;
      await sbFetch(`deals?id=eq.${encodeURIComponent(d.id)}`, 'PATCH', { data: d, updated_at: new Date().toISOString() });
    } else {
      if (d.fromUserId !== req.userId) return res.status(403).json({ error: 'You can only start your own deals' });
      if (d.status === 'completed' || d.status === 'accepted') d.status = 'pending';
      await sbFetch('deals', 'POST', { id: d.id, user_a: d.fromUserId, user_b: d.toUserId, data: d });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('POST /social/deal error:', err.message);
    res.status(500).json({ error: 'Could not save deal' });
  }
});

app.post('/social/message', requireAuth, async (req, res) => {
  try {
    const m = req.body && req.body.message;
    if (!m || typeof m.id !== 'string' || typeof m.dealId !== 'string') return res.status(400).json({ error: 'Invalid message' });
    if (m.senderId !== req.userId) return res.status(403).json({ error: 'Not your message' });
    if (JSON.stringify(m).length > 3000000) return res.status(413).json({ error: 'Message too large' });
    const dl = await sbFetch(`deals?id=eq.${encodeURIComponent(m.dealId)}&select=user_a,user_b,data`, 'GET');
    if (!dl.length) return res.status(404).json({ error: 'Deal not found' });
    if (dl[0].user_a !== req.userId && dl[0].user_b !== req.userId) return res.status(403).json({ error: 'Not your deal' });
    const ex = await sbFetch(`deal_messages?id=eq.${encodeURIComponent(m.id)}&select=id`, 'GET');
    if (ex.length) return res.json({ success: true });
    const dst = dl[0].data && dl[0].data.status;
    if (dst === 'rejected' || dst === 'withdrawn') return res.status(403).json({ error: 'This chat is closed' });
    const otherId = dl[0].user_a === req.userId ? dl[0].user_b : dl[0].user_a;
    if (await isBlockedEither(req.userId, otherId)) return res.status(403).json({ error: 'You cannot message this user' });
    await sbFetch('deal_messages', 'POST', { id: m.id, deal_id: m.dealId, sender_id: req.userId, data: m });
    res.json({ success: true });
  } catch (err) {
    console.error('POST /social/message error:', err.message);
    res.status(500).json({ error: 'Could not save message' });
  }
});

app.post('/social/rating', requireAuth, async (req, res) => {
  try {
    const r = req.body && req.body.rating;
    if (!r || typeof r.id !== 'string' || typeof r.dealId !== 'string') return res.status(400).json({ error: 'Invalid rating' });
    if (r.fromUserId !== req.userId) return res.status(403).json({ error: 'Not your rating' });
    const dl = await sbFetch(`deals?id=eq.${encodeURIComponent(r.dealId)}&select=user_a,user_b`, 'GET');
    if (!dl.length) return res.status(404).json({ error: 'Deal not found' });
    const other = dl[0].user_a === req.userId ? dl[0].user_b : (dl[0].user_b === req.userId ? dl[0].user_a : null);
    if (!other || r.toUserId !== other) return res.status(403).json({ error: 'Not your deal' });
    const ex = await sbFetch(`deal_ratings?deal_id=eq.${encodeURIComponent(r.dealId)}&from_user=eq.${encodeURIComponent(req.userId)}&select=id`, 'GET');
    if (ex.length) return res.json({ success: true });
    await sbFetch('deal_ratings', 'POST', { id: r.id, deal_id: r.dealId, from_user: req.userId, to_user: other, data: r });
    res.json({ success: true });
  } catch (err) {
    console.error('POST /social/rating error:', err.message);
    res.status(500).json({ error: 'Could not save rating' });
  }
});

app.put('/social/rating/:id', requireAuth, async (req, res) => {
  try {
    const r = req.body && req.body.rating;
    if (!r || r.id !== req.params.id) return res.status(400).json({ error: 'Invalid rating' });
    if (r.fromUserId !== req.userId) return res.status(403).json({ error: 'Not your rating' });
    const ex = await sbFetch(`deal_ratings?id=eq.${encodeURIComponent(req.params.id)}&from_user=eq.${encodeURIComponent(req.userId)}&select=id`, 'GET');
    if (!ex.length) return res.status(404).json({ error: 'Rating not found' });
    await sbFetch(`deal_ratings?id=eq.${encodeURIComponent(req.params.id)}`, 'PATCH', { data: r });
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /social/rating error:', err.message);
    res.status(500).json({ error: 'Could not update rating' });
  }
});

app.delete('/social/rating/:id', requireAuth, async (req, res) => {
  try {
    await sbFetch(`deal_ratings?id=eq.${encodeURIComponent(req.params.id)}&from_user=eq.${encodeURIComponent(req.userId)}`, 'DELETE');
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /social/rating error:', err.message);
    res.status(500).json({ error: 'Could not delete rating' });
  }
});

async function isBlockedEither(a, b) {
  const rows = await sbFetch(`user_blocks?or=(and(blocker_id.eq.${encodeURIComponent(a)},blocked_id.eq.${encodeURIComponent(b)}),and(blocker_id.eq.${encodeURIComponent(b)},blocked_id.eq.${encodeURIComponent(a)}))&select=blocker_id`, 'GET');
  return rows.length > 0;
}

async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: String(text).slice(0, 3500) })
    });
  } catch (e) {
    console.error('Telegram alert failed:', e.message);
  }
}

async function userContactLines(uid) {
  if (!uid) return ['Account: guest'];
  try {
    const rows = await sbFetch(`users?id=eq.${encodeURIComponent(uid)}&select=name,email,phone`, 'GET');
    const u = rows[0] || {};
    return ['Name: ' + (u.name || '-'), 'Email: ' + (u.email || '-'), 'Phone: ' + (u.phone || '-')];
  } catch (e) {
    return ['Account ID: ' + uid];
  }
}

app.post('/saved', requireAuth, async (req, res) => {
  try {
    const itemId = req.body && req.body.itemId;
    if (typeof itemId !== 'string' || !itemId) return res.status(400).json({ error: 'Invalid item' });
    const ex = await sbFetch(`saved_items?user_id=eq.${encodeURIComponent(req.userId)}&item_id=eq.${encodeURIComponent(itemId)}&select=item_id`, 'GET');
    if (!ex.length) await sbFetch('saved_items', 'POST', { user_id: req.userId, item_id: itemId });
    res.json({ success: true });
  } catch (err) {
    console.error('POST /saved error:', err.message);
    res.status(500).json({ error: 'Could not save ad' });
  }
});

app.delete('/saved/:itemId', requireAuth, async (req, res) => {
  try {
    await sbFetch(`saved_items?user_id=eq.${encodeURIComponent(req.userId)}&item_id=eq.${encodeURIComponent(req.params.itemId)}`, 'DELETE');
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /saved error:', err.message);
    res.status(500).json({ error: 'Could not remove saved ad' });
  }
});

// ============ PAYMENTS (Razorpay) ============
// Prices live here on the server, in paise (₹1 = 100 paise). The app only sends a product id.
const PAY_CATALOG = {
  growth:       { type: 'plan',    name: 'Growth plan (30 days)',       paise: 19900, plan: 'growth',       premium7: 2 },
  professional: { type: 'plan',    name: 'Professional plan (30 days)', paise: 49900, plan: 'professional', premium7: 4 },
  business:     { type: 'plan',    name: 'Business plan (30 days)',     paise: 89900, plan: 'business',     premium7: 8 },
  prem7:        { type: 'premium', name: 'Premium Listing (7 days)',    paise: 4900,  days: 7 },
  prem30:       { type: 'premium', name: 'Premium Listing (30 days)',   paise: 14900, days: 30 }
};
const PLAN_DAYS = 30;

// A paid plan whose end date has passed counts as Free.
function planTypeOf(plan) {
  if (!plan || !plan.plan_type) return 'free';
  if (plan.plan_type !== 'free' && plan.plan_expires_at && new Date(plan.plan_expires_at) < new Date()) return 'free';
  return plan.plan_type;
}

async function razorpay(path, method = 'GET', body = null) {
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) throw new Error('Payments are not set up');
  const options = {
    method,
    headers: {
      'Authorization': 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
      'Content-Type': 'application/json'
    }
  };
  if (body) options.body = JSON.stringify(body);
  const r = await fetch('https://api.razorpay.com/v1' + path, options);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.description) || ('Razorpay error ' + r.status));
  return j;
}

// Add what was bought to the buyer's account. Runs once per paid order.
async function grantPurchase(userId, productId) {
  const p = PAY_CATALOG[productId];
  const plan = await getUserPlan(userId);
  const updates = {};
  if (p.type === 'plan') {
    const now = Date.now();
    const sameAndActive = planTypeOf(plan) === p.plan && plan.plan_expires_at && new Date(plan.plan_expires_at).getTime() > now;
    const from = sameAndActive ? new Date(plan.plan_expires_at).getTime() : now;
    updates.plan_type = p.plan;
    updates.plan_expires_at = new Date(from + PLAN_DAYS * 86400000).toISOString();
    updates.premium7_credits = (plan.premium7_credits || 0) + p.premium7;
  } else if (p.type === 'premium') {
    const col = p.days === 30 ? 'premium30_credits' : 'premium7_credits';
    updates[col] = (plan[col] || 0) + 1;
  }
  await supabaseCall('user_plans', 'PATCH', updates, `?user_id=eq.${encodeURIComponent(userId)}`);
}

// Step 1: the app asks for an order. The server sets the price.
app.post('/payments/order', requireAuth, async (req, res) => {
  try {
    const productId = req.body && req.body.productId;
    const p = PAY_CATALOG[productId];
    if (!p) return res.status(400).json({ error: 'Unknown product' });
    const receipt = 'bg_' + require('crypto').randomBytes(8).toString('hex');
    const order = await razorpay('/orders', 'POST', {
      amount: p.paise, currency: 'INR', receipt,
      notes: { user_id: req.userId, product_id: productId }
    });
    await supabaseCall('payments', 'POST', {
      user_id: req.userId, product_id: productId, product_type: p.type,
      amount_paise: p.paise, razorpay_order_id: order.id, status: 'created'
    });
    // The buyer's own details, so the payment window never shows anything remembered in the browser.
    let prefill = {};
    try {
      const me = await supabaseCall('users', 'GET', null, `?id=eq.${encodeURIComponent(req.userId)}&select=name,email,phone`);
      if (me && me[0]) prefill = { name: me[0].name || '', email: me[0].email || '', contact: me[0].phone || '' };
    } catch (e) { /* the window still opens without prefill */ }
    res.json({ orderId: order.id, amount: p.paise, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID, name: p.name, prefill });
  } catch (err) {
    console.error('payments/order error:', err.message);
    const notSetUp = err.message === 'Payments are not set up';
    res.status(notSetUp ? 503 : 500).json({ error: notSetUp ? err.message : 'Could not start the payment. Try again.' });
  }
});

// Step 2: after Razorpay's window closes, the app sends the result. The server checks it before granting anything.
app.post('/payments/verify', requireAuth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return res.status(400).json({ error: 'Missing payment details' });
    const rows = await supabaseCall('payments', 'GET', null,
      `?razorpay_order_id=eq.${encodeURIComponent(razorpay_order_id)}&user_id=eq.${encodeURIComponent(req.userId)}`);
    const row = rows && rows[0];
    if (!row) return res.status(404).json({ error: 'Payment not found' });
    if (row.status === 'paid') return res.json({ success: true, already: true });

    // The signature proves the result came from Razorpay and was not edited.
    const expected = require('crypto').createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(razorpay_order_id + '|' + razorpay_payment_id).digest('hex');
    const sigOk = typeof razorpay_signature === 'string' && razorpay_signature.length === expected.length &&
      require('crypto').timingSafeEqual(Buffer.from(razorpay_signature), Buffer.from(expected));
    if (!sigOk) return res.status(400).json({ error: 'Payment could not be verified' });

    // Double-check with Razorpay: right order, right amount, money captured.
    let pay = await razorpay('/payments/' + encodeURIComponent(razorpay_payment_id));
    if (pay.order_id !== razorpay_order_id || pay.amount !== row.amount_paise || pay.currency !== 'INR') {
      return res.status(400).json({ error: 'Payment does not match the order' });
    }
    if (pay.status === 'authorized') {
      pay = await razorpay('/payments/' + encodeURIComponent(razorpay_payment_id) + '/capture', 'POST', { amount: row.amount_paise, currency: 'INR' });
    }
    if (pay.status !== 'captured') return res.status(400).json({ error: 'Payment was not completed' });

    // Mark paid only if still unpaid, so a repeated request can never grant twice.
    const marked = await supabaseCall('payments', 'PATCH',
      { status: 'paid', razorpay_payment_id, paid_at: new Date().toISOString() },
      `?razorpay_order_id=eq.${encodeURIComponent(razorpay_order_id)}&status=eq.created`);
    if (!marked || !marked.length) return res.json({ success: true, already: true });

    await grantPurchase(req.userId, row.product_id);
    notifyTelegram(`💰 Payment received: ${PAY_CATALOG[row.product_id].name}, ₹${row.amount_paise / 100} (user ${req.userId})`).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    console.error('payments/verify error:', err.message);
    res.status(500).json({ error: 'Could not confirm the payment. If money was taken, contact support.' });
  }
});

// Use one premium credit (7 or 30 days) on one of your own live ads.
app.post('/items/:id/premium', requireAuth, async (req, res) => {
  try {
    const days = Number(req.body && req.body.days) === 30 ? 30 : 7;
    const col = days === 30 ? 'premium30_credits' : 'premium7_credits';
    const cur = await supabaseCall('items', 'GET', null, `?id=eq.${encodeURIComponent(req.params.id)}`);
    const it = cur && cur[0];
    if (!it || it.owner_id !== req.userId) return res.status(403).json({ error: 'Not your listing' });
    if (effectiveItem(it).status !== 'available') return res.status(400).json({ error: 'Only live ads can be made premium' });
    const plan = await getUserPlan(req.userId);
    if ((plan[col] || 0) < 1) return res.status(402).json({ error: 'No premium credits left' });
    await supabaseCall('user_plans', 'PATCH', { [col]: plan[col] - 1 }, `?user_id=eq.${encodeURIComponent(req.userId)}`);
    const base = it.premium_until && new Date(it.premium_until) > new Date() ? new Date(it.premium_until).getTime() : Date.now();
    const until = new Date(base + days * 86400000).toISOString();
    const data = await supabaseCall('items', 'PATCH', { premium_until: until, premium_started_at: new Date().toISOString() }, `?id=eq.${encodeURIComponent(req.params.id)}`);
    res.json({ success: true, premium_until: until, item: data[0] || null });
  } catch (err) {
    console.error('premium error:', err.message);
    res.status(500).json({ error: 'Could not make the ad premium' });
  }
});

// ---- Ad stats ----
// One view per viewer per ad per day. Signed-in users count by account, others by IP.
app.post('/items/:id/view', async (req, res) => {
  try {
    const itemId = req.params.id;
    const viewer = optionalUid(req) || ('ip:' + req.ip);
    const day = new Date().toISOString().slice(0, 10);
    try {
      await supabaseCall('item_views', 'POST', { item_id: itemId, viewer, day });
    } catch (e) {
      return res.json({ counted: false });
    }
    const rows = await supabaseCall('items', 'GET', null, `?id=eq.${encodeURIComponent(itemId)}&select=views`);
    const views = ((rows && rows[0] && rows[0].views) || 0) + 1;
    await supabaseCall('items', 'PATCH', { views }, `?id=eq.${encodeURIComponent(itemId)}`);
    res.json({ counted: true, views });
  } catch (err) {
    res.json({ counted: false });
  }
});

// Saves and enquiries for your own ad. Paid plans only.
app.get('/items/:id/stats', requireAuth, async (req, res) => {
  try {
    const itemId = req.params.id;
    const rows = await supabaseCall('items', 'GET', null, `?id=eq.${encodeURIComponent(itemId)}&select=owner_id,views`);
    const it = rows && rows[0];
    if (!it || it.owner_id !== req.userId) return res.status(403).json({ error: 'Not your listing' });
    const plan = await getUserPlan(req.userId);
    if (planTypeOf(plan) === 'free') return res.status(403).json({ error: 'Ad stats are included in paid plans' });
    const saves = await sbFetch(`saved_items?item_id=eq.${encodeURIComponent(itemId)}&select=user_id`, 'GET');
    const mine = await sbFetch(`deals?or=(user_a.eq.${encodeURIComponent(req.userId)},user_b.eq.${encodeURIComponent(req.userId)})&select=data`, 'GET');
    const enquiries = mine.filter(d => d.data && d.data.itemId === itemId).length;
    res.json({ views: it.views || 0, saves: saves.length, enquiries });
  } catch (err) {
    console.error('stats error:', err.message);
    res.status(500).json({ error: 'Could not load stats' });
  }
});

// ---- Refund requests ----
// Every request is saved and sent to the owner with the reason. The checks only decide the message shown.
app.post('/payments/refund-request', requireAuth, async (req, res) => {
  try {
    const reason = String((req.body && req.body.reason) || '').trim().slice(0, 1000);
    if (reason.length < 10) return res.status(400).json({ error: 'Please explain your reason (at least 10 characters).' });
    const rows = await supabaseCall('payments', 'GET', null,
      `?user_id=eq.${encodeURIComponent(req.userId)}&status=eq.paid&order=paid_at.desc&limit=1`);
    const pay = rows && rows[0];
    if (!pay) return res.status(404).json({ error: 'No paid payment found on your account.' });
    const since = encodeURIComponent(pay.paid_at);
    const notes = [];
    if ((Date.now() - new Date(pay.paid_at).getTime()) > 24 * 3600000) notes.push('over 24 hours since paying');
    const posted = await supabaseCall('items', 'GET', null,
      `?owner_id=eq.${encodeURIComponent(req.userId)}&created_at=gte.${since}&select=id&limit=1`);
    if (posted && posted.length) notes.push('ad posted since paying');
    const premium = await supabaseCall('items', 'GET', null,
      `?owner_id=eq.${encodeURIComponent(req.userId)}&premium_started_at=gte.${since}&select=id&limit=1`);
    if (premium && premium.length) notes.push('premium listing used since paying');
    const eligible = notes.length === 0;
    const refundPaise = Math.round(pay.amount_paise * 0.98);

    await supabaseCall('refund_requests', 'POST', {
      user_id: req.userId, razorpay_order_id: pay.razorpay_order_id,
      amount_paise: pay.amount_paise, refund_paise: refundPaise,
      eligible, reason, status: 'pending'
    });
    const product = PAY_CATALOG[pay.product_id] ? PAY_CATALOG[pay.product_id].name : pay.product_id;
    notifyTelegram(
      `↩️ Refund request (${eligible ? 'ELIGIBLE: nothing used, within 24 hours' : 'NOT AUTO-ELIGIBLE: ' + notes.join(', ')})\n` +
      `${product}, paid ₹${pay.amount_paise / 100}, refund ₹${refundPaise / 100} after 2% fee\n` +
      `User: ${req.userId}\nPayment: ${pay.razorpay_payment_id || pay.razorpay_order_id}\n` +
      `Reason: ${reason}`
    ).catch(() => {});

    res.json({
      eligible,
      message: eligible
        ? 'Request received. If approved, you will get ₹' + (refundPaise / 100) + ' (the amount minus a 2% service fee) within 7 working days.'
        : 'Request received. Because you have already used this payment or passed 24 hours, our team will read your reason and email you the decision.'
    });
  } catch (err) {
    console.error('refund request error:', err.message);
    res.status(500).json({ error: 'Could not send the request. Try again.' });
  }
});

app.post('/users/me/deactivate', requireAuth, async (req, res) => {
  try {
    await supabaseCall('users', 'PATCH', { deactivated: true }, `?id=eq.${encodeURIComponent(req.userId)}`);
    res.json({ success: true });
  } catch (err) {
    console.error('deactivate error:', err.message);
    res.status(500).json({ error: 'Could not deactivate account' });
  }
});

app.post('/social/block', requireAuth, async (req, res) => {
  try {
    const userId = req.body && req.body.userId;
    if (typeof userId !== 'string' || !userId || userId === req.userId) return res.status(400).json({ error: 'Invalid user' });
    const ex = await sbFetch(`user_blocks?blocker_id=eq.${encodeURIComponent(req.userId)}&blocked_id=eq.${encodeURIComponent(userId)}&select=blocker_id`, 'GET');
    if (!ex.length) await sbFetch('user_blocks', 'POST', { blocker_id: req.userId, blocked_id: userId });
    res.json({ success: true });
  } catch (err) {
    console.error('POST /social/block error:', err.message);
    res.status(500).json({ error: 'Could not block user' });
  }
});

app.delete('/social/block/:id', requireAuth, async (req, res) => {
  try {
    await sbFetch(`user_blocks?blocker_id=eq.${encodeURIComponent(req.userId)}&blocked_id=eq.${encodeURIComponent(req.params.id)}`, 'DELETE');
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /social/block error:', err.message);
    res.status(500).json({ error: 'Could not unblock user' });
  }
});

app.post('/social/report', requireAuth, async (req, res) => {
  try {
    const r = req.body && req.body.report;
    if (!r || typeof r.id !== 'string' || !r.id) return res.status(400).json({ error: 'Invalid report' });
    if (JSON.stringify(r).length > 20000) return res.status(413).json({ error: 'Report too large' });
    const ex = await sbFetch(`reports?id=eq.${encodeURIComponent(r.id)}&select=id`, 'GET');
    if (!ex.length) {
      await sbFetch('reports', 'POST', { id: r.id, reporter_id: req.userId, data: Object.assign({}, r, { reportedBy: req.userId }) });
      notifyTelegram([
        '🚩 New report on Baganto',
        'Type: ' + (r.type || 'ad'),
        'Reason: ' + (r.reason || '-'),
        'Details: ' + String(r.details || '-').slice(0, 500),
        ...(await userContactLines(req.userId)),
        'Reporter ID: ' + req.userId,
        'Target: ' + (r.targetUserId || r.itemId || '-'),
        'Report ID: ' + r.id
      ].join('\n'));
    }
    res.json({ success: true });
  } catch (err) {
    console.error('POST /social/report error:', err.message);
    res.status(500).json({ error: 'Could not submit report' });
  }
});

app.post('/social/notify', requireAuth, async (req, res) => {
  try {
    const n = req.body && req.body.notification;
    if (!n || typeof n.id !== 'string' || typeof n.userId !== 'string' || typeof n.dealId !== 'string') return res.status(400).json({ error: 'Invalid notification' });
    if (n.fromUserId !== req.userId) return res.status(403).json({ error: 'Not your notification' });
    const dl = await sbFetch(`deals?id=eq.${encodeURIComponent(n.dealId)}&select=user_a,user_b`, 'GET');
    if (!dl.length) return res.status(404).json({ error: 'Deal not found' });
    const pair = [dl[0].user_a, dl[0].user_b];
    if (pair.indexOf(req.userId) === -1 || pair.indexOf(n.userId) === -1) return res.status(403).json({ error: 'Not your deal' });
    const ex = await sbFetch(`notifications?id=eq.${encodeURIComponent(n.id)}&select=id`, 'GET');
    if (ex.length) return res.json({ success: true });
    const clean = { id: n.id, userId: n.userId, fromUserId: req.userId, type: String(n.type || 'deal').slice(0, 40), text: String(n.text || '').slice(0, 300), itemId: n.itemId || null, dealId: n.dealId, read: false, createdAt: Number(n.createdAt) || Date.now() };
    await sbFetch('notifications', 'POST', { id: n.id, user_id: n.userId, data: clean });
    res.json({ success: true });
  } catch (err) {
    console.error('POST /social/notify error:', err.message);
    res.status(500).json({ error: 'Could not save notification' });
  }
});

app.post('/social/notify-read', requireAuth, async (req, res) => {
  try {
    const me = encodeURIComponent(req.userId);
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.filter(x => typeof x === 'string').slice(0, 200) : null;
    let path = `notifications?user_id=eq.${me}`;
    if (ids && ids.length) path += `&id=in.(${encodeURIComponent(ids.map(x => '"' + x.replace(/"/g, '') + '"').join(','))})`;
    await sbFetch(path, 'PATCH', { is_read: true });
    res.json({ success: true });
  } catch (err) {
    console.error('POST /social/notify-read error:', err.message);
    res.status(500).json({ error: 'Could not mark read' });
  }
});

app.delete('/users/me', requireAuth, async (req, res) => {
  try {
    const me = encodeURIComponent(req.userId);
    const rows = await sbFetch(`users?id=eq.${me}&select=email`, 'GET');
    const fbReason = (req.body && typeof req.body.reason === 'string') ? req.body.reason.slice(0, 100) : '';
    const fbDetails = (req.body && typeof req.body.details === 'string') ? req.body.details.slice(0, 1000) : '';
    if (fbReason) {
      try { await sbFetch('account_deletion_feedback', 'POST', { reason: fbReason, details: fbDetails || null }); }
      catch (e) { console.error('deletion feedback save failed:', e.message); }
    }
    await sbFetch(`deals?or=(user_a.eq.${me},user_b.eq.${me})`, 'DELETE');
    await sbFetch(`deal_ratings?or=(from_user.eq.${me},to_user.eq.${me})`, 'DELETE');
    await sbFetch(`notifications?user_id=eq.${me}`, 'DELETE');
    await sbFetch(`items?owner_id=eq.${me}`, 'DELETE');
    if (rows[0] && rows[0].email) await sbFetch(`otp_codes?email=eq.${encodeURIComponent(rows[0].email)}`, 'DELETE');
    await sbFetch(`users?id=eq.${me}`, 'DELETE');
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /users/me error:', err.message);
    res.status(500).json({ error: 'Could not delete account' });
  }
});

// POST /auth/login - check email/phone + password
app.post('/auth/login', async (req, res) => {
  try {
    const { email, phone, password } = req.body;
    const identifier = 'ip:' + req.ip;
    if (!await checkLoginLimit(identifier)) {
      return res.status(429).json({ error: "Too many login attempts, please try again later" });
    }
    if (!password || (!email && !phone)) {
      return res.status(400).json({ error: 'email or phone, plus password, are required' });
    }
    const filter = email
      ? `?email=eq.${encodeURIComponent(email)}`
      : `?phone=eq.${encodeURIComponent(phone)}`;
    const users = await supabaseCall('users', 'GET', null, filter);
    const match = (users || [])[0];
    if (!match || !await bcryptjs.compare(password, match.password || '')) {
      return res.status(401).json({ error: 'Incorrect email/phone or password' });
    }
    delete match.password;
    if (match.deactivated) {
      await supabaseCall('users', 'PATCH', { deactivated: false }, `?id=eq.${encodeURIComponent(match.id)}`);
      match.deactivated = false;
    }
    res.json({ success: true, user: match, token: process.env.AUTH_SECRET ? makeAuthToken(match.id) : null });
  } catch (err) {
    console.error('POST /auth/login error:', err.message);
    res.status(400).json({ error: err.message });
  }
});


// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✓ Backend running on http://localhost:${PORT}`);
  console.log(`\n📍 API Endpoints:`);
  console.log(`   Health: GET /health`);
  console.log(`   Items: GET/POST /items, GET/PUT/DELETE /items/:id`);
  console.log(`   Trades: GET/POST /trades, PUT /trades/:id`);
  console.log(`   Messages: GET /messages/:tradeId, POST /messages`);
  console.log(`   Ratings: GET /ratings/:userId, POST /ratings`);
  console.log(`   Users: GET/POST /users/:id, PUT /users/:id`);
  console.log(`   Support: GET/POST /support, PUT /support/:id\n`);
});

// Image upload endpoint
const uploadHits = new Map();
function uploadAllowed(uid) {
  const now = Date.now();
  const recent = (uploadHits.get(uid) || []).filter(t => now - t < 60000);
  if (recent.length >= 30) { uploadHits.set(uid, recent); return false; }
  recent.push(now);
  uploadHits.set(uid, recent);
  return true;
}
function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

app.post('/items/upload', requireAuth, async (req, res) => {
  try {
    const { file, filename } = req.body;
    if (!file || !filename) return res.status(400).json({ error: 'Missing file or filename' });
    
    if (!uploadAllowed(req.userId)) return res.status(429).json({ error: 'Too many uploads, please wait a minute' });
    const buffer = Buffer.from(file.split(',')[1] || file, 'base64');
    if (buffer.length > 3 * 1024 * 1024) return res.status(413).json({ error: 'Photo is too large (max 3 MB)' });
    const kind = detectImageType(buffer);
    if (!kind) return res.status(415).json({ error: 'Only JPEG, PNG or WebP photos are allowed' });
    // Sanitize filename - remove spaces and special characters
    const sanitized = filename
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, '_')
      .substring(0, 50);
    const storagePath = `${Date.now()}-${sanitized}`;
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/item-photos/${storagePath}`;
    
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${process.env.service_role}`,
        'apikey': process.env.service_role,
        'Content-Type': kind.mime
      },
      body: buffer
    });
    
    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error('Supabase error:', uploadRes.status, errText);
      return res.status(uploadRes.status).json({ error: errText, status: uploadRes.status });
    }
    
    res.json({ url: `${SUPABASE_URL}/storage/v1/object/public/item-photos/${storagePath}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

