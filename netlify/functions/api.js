import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const ORDER_STATUSES = ['Pending', 'Confirmed', 'Completed', 'Cancelled'];
const DEFAULT_SETTINGS = { id: 1, name: 'AL NAFAY', tagline: 'Quality · Comfort · Style', wa: '', phone: '', ig: '' };
const DEFAULT_PASSWORD = process.env.ALNAFAY_ADMIN_PASSWORD || 'ALNAFAY2026';
const SEED_PRODUCT = {
  name: 'Premium Black', code: 'AN-SC-BLK-001', fabric: 'Premium Gents Unstitched', color: 'Black',
  thaan: 3843, suit: 5243, sale_thaan: 0, sale_suit: 0,
  image: JSON.stringify(['/media/fabric_1.png','/media/fabric_2.png','/media/fabric_3.png','/media/fabric_4.png']),
  description: 'Premium black fabric. Four product views are shown on the card and product page.',
  sale_on: false, new_arrival: true, stock: true
};
const store = () => getStore({ name: 'alnafay', consistency: 'strong' });
const json = (obj, status = 200, extra = {}) => Response.json(obj, { status, headers: extra });
const text = (v) => v == null ? '' : String(v);
const num = (v) => Number(v) || 0;
const now = () => new Date().toISOString().slice(0,19).replace('T',' ');
const key = (kind,id) => `${kind}/${String(id).padStart(10,'0')}`;
const readJson = async (req) => { try { return await req.json(); } catch { return {}; } };
const listAll = async (kind) => {
  const s = store();
  const { blobs } = await s.list({ prefix: `${kind}/` });
  const rows = await Promise.all(blobs.map(b => s.get(b.key, { type: 'json' })));
  return rows.filter(Boolean).sort((a,b) => (a.id||0)-(b.id||0));
};
const nextId = async (kind) => {
  const s = store();
  const current = Number((await s.get(`counters/${kind}`, { type:'json' })) || 0);
  const id = current + 1;
  await s.setJSON(`counters/${kind}`, id);
  return id;
};
const ensureSeeded = async () => {
  const s = store();
  if (await s.get('meta/seeded')) return;
  const id = await nextId('products');
  await s.setJSON(key('products', id), { id, ...SEED_PRODUCT });
  await s.setJSON('settings', DEFAULT_SETTINGS);
  await s.set('meta/seeded', '1');
};
const productValues = (d) => ({
  name: text(d.name) || 'Unnamed Product', code: text(d.code), fabric: text(d.fabric), color: text(d.color),
  thaan: num(d.thaan), suit: num(d.suit), sale_thaan: num(d.sale_thaan), sale_suit: num(d.sale_suit),
  image: text(d.image), description: text(d.description), sale_on: !!d.sale_on, new_arrival: !!d.new_arrival,
  stock: d.stock === undefined ? true : !!d.stock
});
const secret = () => crypto.createHash('sha256').update(DEFAULT_PASSWORD).digest('hex');
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('hex');
const makeCookie = () => {
  const exp = Date.now() + 7*24*60*60*1000;
  const payload = String(exp);
  const token = `${payload}.${sign(payload)}`;
  return `an_admin=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${7*24*60*60}`;
};
const validCookie = (req) => {
  const raw = req.headers.get('cookie') || '';
  const match = raw.split(';').map(x=>x.trim()).find(x=>x.startsWith('an_admin='));
  if (!match) return false;
  const token = match.slice('an_admin='.length);
  const [exp,sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(exp)));
};
const adminOnly = (req) => validCookie(req);
const esc = (v) => text(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const resendFrom = () => {
  const from = text(process.env.RESEND_FROM_EMAIL).trim();
  // Resend cannot send from free mailbox domains (gmail.com etc.) — fall back to its test sender.
  if (!from || /@(gmail|yahoo|hotmail|outlook|live|icloud)\.com>?$/i.test(from)) return 'AL NAFAY <onboarding@resend.dev>';
  return from;
};
const sendConfirmationEmail = async (row) => {
  const apiKey = process.env.RESEND_API_KEY;
  const to = text(row.email).trim();
  if (!apiKey) { console.log('Email skipped: RESEND_API_KEY not set'); return { sent:false, reason:'not_configured' }; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { console.log(`Email skipped for order ${row.id}: no valid customer email`); return { sent:false, reason:'no_email' }; }
  let items = [];
  try { items = JSON.parse(row.items || '[]'); } catch {}
  const lines = items.map(i => `<tr><td>${esc(i.product)}${i.tone?' ('+esc(i.tone)+')':''}${i.option?' - '+esc(i.option):''}</td><td align="center">${i.quantity}</td><td align="right">Rs ${Number(i.unit_price*i.quantity).toLocaleString()}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
<h2>AL NAFAY - Order Confirmed</h2>
<p>Dear ${esc(row.name)},</p>
<p>Your order <b>#${row.id}</b> has been confirmed. Thank you for shopping with AL NAFAY!</p>
<table width="100%" cellpadding="6" style="border-collapse:collapse;border:1px solid #ddd">
<tr style="background:#f5f5f5"><th align="left">Item</th><th>Qty</th><th align="right">Amount</th></tr>${lines}
<tr><td colspan="2"><b>Total</b></td><td align="right"><b>Rs ${Number(row.total).toLocaleString()}</b></td></tr></table>
<p>Delivery to: ${esc(row.address)}${row.city?', '+esc(row.city):''}<br>Phone: ${esc(row.phone)}</p>
<p>Regards,<br>AL NAFAY</p></div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{ Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ from: resendFrom(), to:[to], subject:`Your AL NAFAY order #${row.id} is confirmed`, html })
    });
    const body = await res.text();
    if (!res.ok) { console.error(`Resend error for order ${row.id} (${res.status}): ${body}`); return { sent:false, reason:'provider_error', status:res.status, detail:body.slice(0,300) }; }
    console.log(`Confirmation email sent for order ${row.id}`);
    return { sent:true };
  } catch (e) { console.error(`Email send failed for order ${row.id}:`, e); return { sent:false, reason:'network_error' }; }
};
const bad = (message,status=404) => json({error:message},status);

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/,'');
  const parts = path.split('/');
  const resource = parts[2] || '';
  const idPart = parts[3];
  const id = idPart ? parseInt(idPart,10) : undefined;
  const method = req.method;
  const s = store();

  if (resource === 'admin' && idPart === 'login' && method === 'POST') {
    const d = await readJson(req);
    if (text(d.password) !== DEFAULT_PASSWORD) return json({error:'Wrong password'},401);
    return json({ok:true},200,{'Set-Cookie':makeCookie()});
  }
  if (resource === 'admin' && idPart === 'logout' && method === 'POST') {
    return json({ok:true},200,{'Set-Cookie':'an_admin=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0'});
  }
  if (resource === 'admin' && idPart === 'me' && method === 'GET') return json({admin:adminOnly(req)});

  await ensureSeeded();

  if (resource === 'products') {
    if (method === 'GET' && !idPart) return json(await listAll('products'));
    if (!adminOnly(req)) return json({error:'Login required'},401);
    if (method === 'POST' && !idPart) {
      const id = await nextId('products');
      const row = {id, ...productValues(await readJson(req))};
      await s.setJSON(key('products',id),row); return json(row,201);
    }
    if (id && method === 'PUT') {
      if (!(await s.get(key('products',id)))) return bad('Product not found',404);
      const row = {id, ...productValues(await readJson(req))};
      await s.setJSON(key('products',id),row); return json(row);
    }
    if (id && method === 'DELETE') { await s.delete(key('products',id)); return json({ok:true}); }
  }

  if (resource === 'orders') {
    if (method === 'POST' && !idPart) {
      const d = await readJson(req);
      const name = text(d.name).trim(), phone = text(d.phone).trim();
      if (!name || !phone) return bad('Name and phone are required',400);
      const items = Array.isArray(d.items) ? d.items.slice(0,50) : [];
      if (!items.length) return bad('No items in order',400);
      const products = await listAll('products');
      const clean = items.map(i => {
        const p = products.find(x => Number(x.id) === Number(i.product_id));
        const opt = text(i.option);
        const isSuit = opt.toLowerCase().includes('suit');
        const regular = p ? Number(isSuit ? p.suit : p.thaan) : num(i.unit_price);
        const sale = p ? Number(isSuit ? p.sale_suit : p.sale_thaan) : 0;
        const unit = p && p.sale_on && sale > 0 ? sale : regular;
        return {product_id:num(i.product_id),product:text(i.product || (p&&p.name)),tone:text(i.tone),option:opt,unit_price:unit,quantity:Math.max(1,Math.trunc(num(i.quantity))||1)};
      });
      const total = clean.reduce((a,i)=>a+i.unit_price*i.quantity,0);
      const qty = clean.reduce((a,i)=>a+i.quantity,0);
      const id = await nextId('orders');
      const row = {id,created_at:now(),product_id:clean[0].product_id,product:[...new Set(clean.map(i=>i.product))].join(', '),tone:clean[0].tone,option:clean.length===1?clean[0].option:'',unit_price:clean.length===1?clean[0].unit_price:0,quantity:qty,total,name,email:text(d.email),phone,city:text(d.city),address:text(d.address),note:text(d.note),status:'Pending',items:JSON.stringify(clean)};
      await s.setJSON(key('orders',id),row); return json(row,201);
    }
    if (!adminOnly(req)) return json({error:'Login required'},401);
    if (method === 'GET' && !idPart) return json((await listAll('orders')).reverse());
    if (id && method === 'PUT') {
      const d = await readJson(req), status = text(d.status) || 'Pending';
      if (!ORDER_STATUSES.includes(status)) return bad('Invalid status',400);
      const row = await s.get(key('orders',id),{type:'json'});
      if (!row) return bad('Order not found',404);
      const wasConfirmed = row.status === 'Confirmed';
      row.status = status; await s.setJSON(key('orders',id),row);
      const email = status === 'Confirmed' && !wasConfirmed ? await sendConfirmationEmail(row) : undefined;
      return json(email ? { ...row, email_result: email } : row);
    }
  }

  if (resource === 'customers' && method === 'GET' && !idPart) {
    if (!adminOnly(req)) return json({error:'Login required'},401);
    const groups = new Map();
    for (const o of await listAll('orders')) {
      if (!o.name) continue;
      const k = JSON.stringify([o.name,o.phone,o.email,o.city,o.address]);
      const g = groups.get(k);
      if (g) { g.order_count++; if (o.created_at > g.last_order_at) g.last_order_at=o.created_at; }
      else groups.set(k,{name:o.name,phone:o.phone,email:o.email,city:o.city,address:o.address,order_count:1,last_order_at:o.created_at});
    }
    return json([...groups.values()].sort((a,b)=>String(b.last_order_at).localeCompare(String(a.last_order_at))));
  }

  if (resource === 'settings' && !idPart) {
    if (method === 'GET') return json((await s.get('settings',{type:'json'})) || DEFAULT_SETTINGS);
    if (!adminOnly(req)) return json({error:'Login required'},401);
    if (method === 'POST') {
      const d = await readJson(req);
      const row = {id:1,name:text(d.name)||DEFAULT_SETTINGS.name,tagline:text(d.tagline)||DEFAULT_SETTINGS.tagline,wa:text(d.wa),phone:text(d.phone),ig:text(d.ig)};
      await s.setJSON('settings',row); return json(row);
    }
  }
  return bad('Not found',404);
};

export const config = { path: '/api/*' };
