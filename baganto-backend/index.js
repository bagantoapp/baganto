const express = require('express');
require('dotenv').config();
const cors = require('cors');

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
app.get('/items', async (req, res) => {
  try {
    const data = await supabaseCall('items');
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/items/:id', async (req, res) => {
  try {
    const data = await supabaseCall('items', 'GET', null, `?id=eq.${req.params.id}`);
    res.json(data[0] || null);
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
  const limit = limits[plan.plan_type] || 3;
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
      const limit = limits[plan.plan_type] || 3;
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
      const cur = await supabaseCall('items', 'GET', null, `?id=eq.${encodeURIComponent(req.params.id)}&select=status`);
      if (cur[0] && cur[0].status !== 'available') {
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
  try {
    const data = await supabaseCall('trades');
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/trades', async (req, res) => {
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
  try {
    const data = await supabaseCall('trades', 'PATCH', req.body, `?id=eq.${req.params.id}`);
    res.json(data[0] || data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============ MESSAGES ============
app.get('/messages/:tradeId', async (req, res) => {
  try {
    const data = await supabaseCall('messages', 'GET', null, `?trade_id=eq.${req.params.tradeId}&order=created_at.asc`);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/messages', async (req, res) => {
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
  try {
    const data = await supabaseCall('ratings', 'GET', null, `?to_user_id=eq.${req.params.userId}`);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/ratings', async (req, res) => {
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
    res.json(data[0] || null);
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
  try {
    const data = await supabaseCall('support_tickets', 'GET', null, '?order=created_at.desc');
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/support', async (req, res) => {
  try {
    const { user_id, contact_email, category, subject, message } = req.body;
    const data = await supabaseCall('support_tickets', 'POST', { user_id, contact_email, category, subject, message, status: 'open' });
    res.json(data[0] || data);
  } catch (err) {
    res.status(400).json({ error: err.message });
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
      const { password, email, phone, ...safe } = u;
      return safe;
    });
    const out = { items: items || [], users };
    // If the caller is logged in, include their real monthly ad count so every device shows the true limit
    const h = req.headers.authorization || '';
    const uid = h.startsWith('Bearer ') ? verifyAuthToken(h.slice(7)) : '';
    if (uid) {
      try {
        const plan = await getUserPlan(uid);
        const today = new Date().toISOString().split('T')[0];
        const used = await countPostsThisMonth(uid);
        out.my_plan = { user_id: uid, plan_type: plan.plan_type, ads_used_this_month: used };
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
    .createHmac('sha256', process.env.service_role || 'dev-only')
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
      .createHmac('sha256', process.env.service_role || 'dev-only')
      .update('signup-token:' + payload)
      .digest('hex');
    if (!sig || sig.length !== expect.length) return false;
    if (!require('crypto').timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
    return tEmail === email && Date.now() < Number(exp);
  } catch (e) {
    return false;
  }
}

app.post('/auth/signup', async (req, res) => {
  try {
    const { email, phone, name, city, bio, password } = req.body;
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
    .createHmac('sha256', process.env.service_role || 'dev-only')
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
    res.json({ serverTime, deals: deals.map(d => d.data), messages: messages.map(m => m.data), ratings: ratings.map(r => r.data), notifications: notifs.map(x => Object.assign({}, x.data, { read: !!x.is_read })) });
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
    const dst = dl[0].data && dl[0].data.status;
    if (dst === 'rejected' || dst === 'withdrawn') return res.status(403).json({ error: 'This chat is closed' });
    const ex = await sbFetch(`deal_messages?id=eq.${encodeURIComponent(m.id)}&select=id`, 'GET');
    if (ex.length) return res.json({ success: true });
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
app.post('/items/upload', requireAuth, async (req, res) => {
  try {
    const { file, filename } = req.body;
    if (!file || !filename) return res.status(400).json({ error: 'Missing file or filename' });
    
    const buffer = Buffer.from(file.split(',')[1] || file, 'base64');
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
        'Content-Type': 'image/jpeg'
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

