import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'IMMI-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  code += '-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  code += '-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function storeCode(code, orderId, productType) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/unlock_codes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ code, order_id: orderId, product_type: productType, used: false })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Supabase insert failed: ' + err);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = await getRawBody(req);
  const signature = req.headers['x-signature'];
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

  if (secret) {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody);
    const digest = hmac.digest('hex');
    if (digest !== signature) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventName = payload.meta?.event_name;
  if (eventName !== 'order_created') {
    return res.status(200).json({ received: true });
  }

  const order = payload.data?.attributes;
  if (!order || order.status !== 'paid') {
    return res.status(200).json({ received: true });
  }

  const orderId = String(payload.data?.id);
  const productName = order.first_order_item?.product_name || '';
  const productType = productName.toLowerCase().includes('bundle') ? 'bundle' : 'single';
  const customerEmail = order.user_email;
  const code = generateCode();

  try {
    await storeCode(code, orderId, productType);
  } catch (err) {
    console.error('Store code error:', err);
    return res.status(500).json({ error: err.message });
  }

  // Send email via Resend (optional - set RESEND_API_KEY in Vercel env vars)
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey && customerEmail) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendKey}`
        },
        body: JSON.stringify({
          from: 'ImmiDocs <noreply@immidocs.ca>',
          to: customerEmail,
          subject: 'Your ImmiDocs unlock code',
          html: `
            <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:2rem">
              <h2 style="color:#1A2B4A">Your document is ready</h2>
              <p>Thank you for your purchase. Here is your unlock code:</p>
              <div style="background:#EEF1F6;border-radius:8px;padding:1.5rem;text-align:center;margin:1.5rem 0">
                <span style="font-family:monospace;font-size:24px;font-weight:700;color:#1A2B4A;letter-spacing:0.1em">${code}</span>
              </div>
              <p>Go back to <a href="https://immidocs.ca" style="color:#CC0000">immidocs.ca</a>, generate your document preview, and enter this code to unlock the full version.</p>
              ${productType === 'bundle' ? '<p><strong>Bundle customers:</strong> This code unlocks 3 documents total. Each time you generate a new document, enter the same code — it will work up to 3 times.</p>' : ''}
              <p style="color:#718096;font-size:12px;margin-top:2rem">ImmiDocs.ai — Not affiliated with IRCC or the Government of Canada</p>
            </div>
          `
        })
      });
    } catch (emailErr) {
      console.error('Email send error:', emailErr);
    }
  }

  return res.status(200).json({ success: true, code });
}
