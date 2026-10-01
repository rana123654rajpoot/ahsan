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
const bad = (message,status=404) => json({error:message},status);
const escHtml = (v) => text(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sendOrderEmail = async (order, type) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const recipient = text(order.email).trim();
  if (!apiKey || !from || !recipient.includes('@')) return { sent:false, skipped:true };

  const items = (() => { try { return JSON.parse(order.items || '[]'); } catch { return []; } })();
  const rows = items.length
    ? items.map(i => `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb">${escHtml(i.product)}<br><small>${escHtml(i.option || '')}</small></td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center">${Number(i.quantity)||1}</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">Rs. ${Number(i.unit_price||0).toLocaleString('en-PK')}</td></tr>`).join('')
    : `<tr><td colspan="3" style="padding:8px">${escHtml(order.product)} — ${escHtml(order.option)}</td></tr>`;

  const messages = {
    placed: {
      subject: `AL NAFAY Order #${order.id} Received`,
      title: 'Your Order Has Been Placed',
      intro: `Your AL NAFAY order <b>#${order.id}</b> has been received successfully.`,
      closing: 'We have received your order and will contact you when it is confirmed.'
    },
    confirmed: {
      subject: `AL NAFAY Order #${order.id} Confirmed`,
      title: 'Your Order Has Been Confirmed',
      intro: `Your AL NAFAY order <b>#${order.id}</b> has been confirmed successfully.`,
      closing: 'Your order will now be processed for delivery. We will contact you if any further information is needed.'
    },
    completed: {
      subject: `AL NAFAY Order #${order.id} Completed`,
      title: 'Your Order Has Been Completed',
      intro: `Your AL NAFAY order <b>#${order.id}</b> has been completed.`,
      closing: 'Thank you for shopping with AL NAFAY.'
    },
    cancelled: {
      subject: `AL NAFAY Order #${order.id} Cancelled`,
      title: 'Your Order Has Been Cancelled',
      intro: `Your AL NAFAY order <b>#${order.id}</b> has been cancelled.`,
      closing: 'If you have any questions about this cancellation, please contact AL NAFAY.'
    }
  };
  const m = messages[type] || messages.confirmed;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f7f6;font-family:Arial,sans-serif;color:#123638"><div style="max-width:650px;margin:30px auto;background:#fff;border:1px solid #d7e8e4"><div style="background:#042f32;color:#fff;padding:28px;text-align:center"><div style="font-size:25px;letter-spacing:3px;font-weight:700">AL NAFAY</div><div style="margin-top:6px;color:#d6ffcb">GENTS UNSTITCHED</div></div><div style="padding:30px"><h2 style="margin-top:0">${m.title}</h2><p>Assalam-o-Alaikum ${escHtml(order.name)},</p><p>${m.intro}</p><table style="width:100%;border-collapse:collapse;margin:22px 0"><thead><tr><th style="padding:8px;text-align:left;background:#f3f7f6">Product</th><th style="padding:8px;background:#f3f7f6">Qty</th><th style="padding:8px;text-align:right;background:#f3f7f6">Price</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="2" style="padding:12px 8px;font-weight:700">Total Amount</td><td style="padding:12px 8px;text-align:right;font-weight:700">Rs. ${Number(order.total||0).toLocaleString('en-PK')}</td></tr></tfoot></table><p><b>Delivery City:</b> ${escHtml(order.city)}</p><p><b>Delivery Address:</b> ${escHtml(order.address)}</p>${order.note?`<p><b>Order Note:</b> ${escHtml(order.note)}</p>`:''}<p>${m.closing}</p><p style="margin-top:28px"><b>AL NAFAY</b><br>Quality · Comfort · Style</p></div></div></body></html>`;
  const r = await fetch('https://api.resend.com/emails', {method:'POST', headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'}, body:JSON.stringify({from,to:[recipient],subject:m.subject,html})});
  if (!r.ok) { let detail='Email service error'; try { const e=await r.json(); detail=e.message||detail; } catch {} throw new Error(detail); }
  return { sent:true };
};


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
      await s.setJSON(key('orders',id),row);
      let email = {sent:false, skipped:true};
      try { email = await sendOrderEmail(row, 'placed'); } catch (e) { email = {sent:false, skipped:false, error:text(e.message)}; }
      return json({...row, email},201);
    }
    if (!adminOnly(req)) return json({error:'Login required'},401);
    if (method === 'GET' && !idPart) return json((await listAll('orders')).reverse());
    if (id && method === 'PUT') {
      const d = await readJson(req), status = text(d.status) || 'Pending';
      if (!ORDER_STATUSES.includes(status)) return bad('Invalid status',400);
      const row = await s.get(key('orders',id),{type:'json'});
      if (!row) return bad('Order not found',404);
      const previousStatus = row.status;
      row.status = status;
      await s.setJSON(key('orders',id),row);
      let email = {sent:false, skipped:true};
      const emailType = status === 'Confirmed' ? 'confirmed' : status === 'Completed' ? 'completed' : status === 'Cancelled' ? 'cancelled' : null;
      if (emailType && previousStatus !== status) {
        try { email = await sendOrderEmail(row, emailType); }
        catch (e) { email = {sent:false, skipped:false, error:text(e.message)}; }
      }
      return json({...row, email});
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
