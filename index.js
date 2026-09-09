const express = require('express');
require('dotenv').config();
const cors = require('cors');

const app = express();
app.use(cors());
const bcrypt = require('bcrypt');

app.use(express.json());
app.set('etag', false);

// Supabase REST API config
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

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

app.post('/items', async (req, res) => {
  try {
    const { owner_id, title, description, category, price, condition, listing_type, photos } = req.body;
    const data = await supabaseCall('items', 'POST', { owner_id, title, description, category, price, condition, listing_type, photos });
    res.json(data[0] || data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/items/:id', async (req, res) => {
  try {
    const data = await supabaseCall('items', 'PATCH', req.body, `?id=eq.${req.params.id}`);
    res.json(data[0] || data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/items/:id', async (req, res) => {
  try {
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
  try {
    const { id, email, phone, name, city, bio } = req.body;
    const data = await supabaseCall('users', 'POST', { id, email, phone, name, city, bio });
    res.json(data[0] || data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/users/:id', async (req, res) => {
  try {
    const data = await supabaseCall('users', 'PATCH', req.body, `?id=eq.${req.params.id}`);
    res.json(data[0] || data);
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
    const users = await supabaseCall('users');
    res.json({ items: items || [], users: users || [] });
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
app.post('/auth/signup', async (req, res) => {
  try {
    const { email, phone, name, city, bio, password } = req.body;
    if (!password || !name) {
      return res.status(400).json({ error: 'name and password are required' });
    }
    const userId = require('crypto').randomUUID();
    const hashedPassword = await bcrypt.hash(password, 10);
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
    res.json({ success: true, user: user });
  } catch (err) {
    console.error('POST /auth/signup error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /auth/login - check email/phone + password
app.post('/auth/login', async (req, res) => {
  try {
    const { email, phone, password } = req.body;
    if (!password || (!email && !phone)) {
      return res.status(400).json({ error: 'email or phone, plus password, are required' });
    }
    const filter = email
      ? `?email=eq.${encodeURIComponent(email)}`
      : `?phone=eq.${encodeURIComponent(phone)}`;
    const users = await supabaseCall('users', 'GET', null, filter);
    const match = (users || [])[0];
    if (!match || !await bcrypt.compare(password, match.password || '')) {
      return res.status(401).json({ error: 'Incorrect email/phone or password' });
    }
    delete match.password;
    res.json({ success: true, user: match });
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
