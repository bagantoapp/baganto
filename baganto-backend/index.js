const express = require('express');
require('dotenv').config();
const cors = require('cors');

const app = express();
app.use(cors({ origin: 'https://baganto.com' }));
const bcryptjs = require('bcryptjs');
app.set('trust proxy', 1);

const rateLimit = require('express-rate-limit');

app.use(express.json({ limit: '50mb' }));
app.set('etag', false);

// Supabase REST API config
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.anon_public;

// Helper function for Supabase REST API calls
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

app.post('/items', requireAuth, async (req, res) => {
  try {
    const { title, description, category, price, condition, listing_type, photos } = req.body;
    const owner_id = req.userId;
    const photosArray = Array.isArray(photos) ? photos : [];
    const data = await supabaseCall('items', 'POST', { owner_id, title, description, category, price, condition, listing_type, photos: photosArray });
    res.json(data[0] || data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/items/:id', requireAuth, async (req, res) => {
  try {
    if (await itemOwnerId(req.params.id) !== req.userId) return res.status(403).json({ error: 'Not your listing' });
    const allowed = ['title', 'description', 'category', 'price', 'condition', 'listing_type', 'photos', 'status', 'want_in_exchange', 'city'];
    const updates = {};
    for (const k of allowed) { if (req.body && k in req.body) updates[k] = req.body[k]; }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });
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
      const { password, ...safe } = u;
      return safe;
    });
    res.json({ items: items || [], users });
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

