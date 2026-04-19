export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Missing code' });

  const cleanCode = code.trim().toUpperCase();

  try {
    // Look up the code in Supabase
    const lookupRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/unlock_codes?code=eq.${encodeURIComponent(cleanCode)}&select=*`,
      {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
        }
      }
    );

    const rows = await lookupRes.json();

    if (!rows || rows.length === 0) {
      return res.status(200).json({ valid: false, reason: 'Code not found' });
    }

    const record = rows[0];

    if (record.used && record.product_type === 'single') {
      return res.status(200).json({ valid: false, reason: 'Code already used' });
    }

    // For bundle: track usage count separately
    if (record.product_type === 'bundle') {
      const usageCount = record.usage_count || 0;
      if (usageCount >= 3) {
        return res.status(200).json({ valid: false, reason: 'Bundle limit reached (3/3 documents used)' });
      }
      // Increment usage count
      await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/unlock_codes?id=eq.${record.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': process.env.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            usage_count: usageCount + 1,
            used: usageCount + 1 >= 3
          })
        }
      );
      const remaining = 3 - (usageCount + 1);
      return res.status(200).json({ valid: true, product_type: 'bundle', remaining });
    }

    // Single: mark as used
    await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/unlock_codes?id=eq.${record.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ used: true })
      }
    );

    return res.status(200).json({ valid: true, product_type: 'single', remaining: 0 });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
