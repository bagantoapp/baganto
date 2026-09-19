app.post('/items/upload', async (req, res) => {
  try {
    const { file, filename } = req.body;
    if (!file || !filename) return res.status(400).json({ error: 'Missing file or filename' });
    
    const buffer = Buffer.from(file.split(',')[1] || file, 'base64');
    const storagePath = `${Date.now()}-${filename}`;
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/item-photos/${storagePath}`;
    
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
        'Content-Type': 'image/jpeg'
      },
      body: buffer
    });
    
    if (!uploadRes.ok) return res.status(500).json({ error: 'Upload failed' });
    
    res.json({ url: `${SUPABASE_URL}/storage/v1/object/public/item-photos/${storagePath}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
