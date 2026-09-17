const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.anon_public);

async function uploadBase64Image(base64Data, fileName) {
  if (!base64Data || !base64Data.startsWith('data:')) return null;
  
  try {
    const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) return null;
    
    const mimeType = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    const ext = mimeType.split('/')[1] || 'jpg';
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(9)}.${ext}`;
    
    const { data, error } = await supabase.storage
      .from('item-photos')
      .upload(uniqueName, buffer, { contentType: mimeType });
    
    if (error) throw error;
    
    const { data: publicUrl } = supabase.storage
      .from('item-photos')
      .getPublicUrl(uniqueName);
    
    return publicUrl.publicUrl;
  } catch (err) {
    console.error('Image upload failed:', err.message);
    return null;
  }
}

module.exports = { uploadBase64Image };
