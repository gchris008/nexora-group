import 'node:process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.env.PORT || 3000);
const sessionCookie = process.env.SESSION_COOKIE_NAME || 'nexora_session';
const sessionHours = Number(process.env.SESSION_TTL_HOURS || 8);
const isProd = process.env.NODE_ENV === 'production';

const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: true } : false,
  max: 10,
  idleTimeoutMillis: 30000
}) : null;

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProd ? [] : null
    }
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

const contactLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Trop de demandes. Réessayez plus tard.' } });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez plus tard.' }
});

function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function safeText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function validName(value) { return /^[\p{L}]+(?:[ '\u2019-][\p{L}]+){1,5}$/u.test(value); }
function validUsername(value) { return /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{2,29})$/.test(value); }
function parseBoolean(value) { if (value === true || value === false) return value; if (value === 'true') return true; if (value === 'false') return false; return null; }
async function audit(req, action, entity, entityId = null) { if (!pool) return; await pool.query('INSERT INTO audit_logs(admin_id,action,entity,entity_id,ip_address) VALUES($1,$2,$3,$4,$5)', [req.auth?.admin_id ?? null, action, entity, entityId == null ? null : String(entityId), req.ip]); }

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}
function verifyPassword(password, encoded) {
  const [scheme,N,r,p,saltB64,keyB64] = String(encoded).split('$');
  if (scheme !== 'scrypt') return false;
  const derived = crypto.scryptSync(password, Buffer.from(saltB64, 'base64url'), 64, { N:Number(N), r:Number(r), p:Number(p) });
  return crypto.timingSafeEqual(derived, Buffer.from(keyB64, 'base64url'));
}

async function auth(req, res, next) {
  try {
    const raw = req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith(sessionCookie+'='))?.slice(sessionCookie.length+1);
    if (!raw) return res.status(401).json({ error: 'Authentification requise.' });
    const result = await pool.query(
      'SELECT s.id,s.csrf_hash,s.expires_at,a.id AS admin_id,a.email,a.role FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token_hash=$1 AND s.expires_at>NOW()',
      [sha256(raw)]
    );
    if (!result.rowCount) return res.status(401).json({ error: 'Session invalide ou expirée.' });
    req.auth = result.rows[0];
    req.rawSession = raw;
    next();
  } catch (e) { next(e); }
}

function requireRole(...roles) {
  return (req,res,next) => roles.includes(req.auth.role) ? next() : res.status(403).json({error:'Accès interdit.'});
}

function csrf(req,res,next) {
  const token = req.get('x-csrf-token');
  if (!token || sha256(token) !== req.auth.csrf_hash) return res.status(403).json({error:'Jeton CSRF invalide.'});
  next();
}

app.get('/api/products', async (_req,res,next)=>{
  try { const r=await pool.query('SELECT id,name,description,price_cents,currency,sku,category,image_url,stock_quantity FROM products WHERE active=TRUE ORDER BY created_at DESC'); res.json(r.rows); } catch(e){next(e);}
});

app.get('/api/site', async (_req,res,next)=>{
  try {
    const r=await pool.query('SELECT company_name,tagline,hero_text,contact_email FROM site_content WHERE id=1');
    res.json(r.rows[0]);
  } catch(e){next(e);}
});

app.post('/api/orders', async (req,res,next)=>{
  const client=await pool.connect();
  try {
    const name=safeText(req.body.customer?.name,120), email=safeText(req.body.customer?.email,160).toLowerCase();
    const phone=safeText(req.body.customer?.phone,40), address=safeText(req.body.customer?.address,240), city=safeText(req.body.customer?.city,120), country=safeText(req.body.customer?.country,120);
    const items=Array.isArray(req.body.items)?req.body.items.slice(0,50):[];
    if(!validName(name)||!validEmail(email)||!address||!city||!country||!items.length) return res.status(400).json({error:'Informations de commande invalides.'});
    const ids=[...new Set(items.map(x=>Number(x.product_id)).filter(Number.isInteger))];
    if(!ids.length)return res.status(400).json({error:'Panier invalide.'});
    await client.query('BEGIN');
    const products=(await client.query('SELECT id,name,price_cents,currency,stock_quantity FROM products WHERE id=ANY($1::bigint[]) AND active=TRUE FOR UPDATE',[ids])).rows;
    const map=new Map(products.map(p=>[Number(p.id),p]));
    let total=0,currency=null,lines=[];
    for(const item of items){const id=Number(item.product_id),qty=Number(item.quantity),p=map.get(id);if(!p||!Number.isInteger(qty)||qty<1||qty>99)throw Object.assign(new Error('Panier invalide.'),{statusCode:400});if(qty>p.stock_quantity)throw Object.assign(new Error(`Stock insuffisant pour ${p.name}.`),{statusCode:409});if(currency&&currency!==p.currency)throw Object.assign(new Error('Les produits doivent utiliser la même devise.'),{statusCode:400});currency=p.currency;const line=p.price_cents*qty;total+=line;lines.push({p,qty,line});}
    if(total>2147483647)throw Object.assign(new Error('Commande trop élevée.'),{statusCode:400});
    const customer=(await client.query('INSERT INTO customers(name,email,phone,address,city,country) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone,address=EXCLUDED.address,city=EXCLUDED.city,country=EXCLUDED.country,updated_at=NOW() RETURNING id',[name,email,phone,address,city,country])).rows[0];
    const order=(await client.query('INSERT INTO orders(customer_id,currency,total_cents) VALUES($1,$2,$3) RETURNING id,status,total_cents,currency,created_at',[customer.id,currency,total])).rows[0];
    for(const l of lines){await client.query('UPDATE products SET stock_quantity=stock_quantity-$1,updated_at=NOW() WHERE id=$2',[l.qty,l.p.id]);await client.query('INSERT INTO order_items(order_id,product_id,product_name,unit_price_cents,quantity,line_total_cents) VALUES($1,$2,$3,$4,$5,$6)',[order.id,l.p.id,l.p.name,l.p.price_cents,l.qty,l.line]);}
    await client.query('COMMIT');
    res.status(201).json({order});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});res.status(e.statusCode||500).json({error:e.statusCode?e.message:'Impossible de créer la commande.'});}finally{client.release();}
});


app.get('/api/payments/methods',(_req,res)=>res.json([{id:'card',label:'Carte Visa / Mastercard',available:Boolean(process.env.SOLUTIONSPAYMENTS_API_URL)},{id:'moncash',label:'MonCash',available:Boolean(process.env.MONCASH_API_URL)},{id:'natcash',label:'NatCash',available:Boolean(process.env.NATCASH_API_URL)},{id:'binance_pay',label:'Binance Pay',available:Boolean(process.env.BINANCE_PAY_API_KEY&&process.env.BINANCE_PAY_SECRET_KEY)}]));
app.post('/api/payments/create',async(req,res,next)=>{const c=await pool.connect();try{const orderId=Number(req.body.order_id),method=safeText(req.body.method,20);if(!Number.isInteger(orderId)||!['card','moncash','natcash','binance_pay'].includes(method))return res.status(400).json({error:'Méthode de paiement invalide.'});await c.query('BEGIN');const r=await c.query('SELECT id,total_cents,currency,payment_status FROM orders WHERE id=$1 FOR UPDATE',[orderId]);if(!r.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'Commande introuvable.'});}const o=r.rows[0];const env={card:'SOLUTIONSPAYMENTS_API_URL',moncash:'MONCASH_API_URL',natcash:'NATCASH_API_URL',binance_pay:'BINANCE_PAY_API_KEY'}[method];if(!process.env[env]){await c.query('ROLLBACK');return res.status(503).json({error:'Ce moyen de paiement sera activé après configuration du compte marchand.'});}await c.query("INSERT INTO payments(order_id,method,provider,amount_cents,currency) VALUES($1,$2,$2,$3,$4)",[o.id,method,o.total_cents,o.currency]);await c.query("UPDATE orders SET payment_status='pending',payment_method=$1,updated_at=NOW() WHERE id=$2",[method,o.id]);await c.query('COMMIT');res.status(201).json({message:'Paiement préparé. Le connecteur du prestataire sera finalisé avec les clés marchandes.',checkout_url:null});}catch(e){await c.query('ROLLBACK').catch(()=>{});next(e)}finally{c.release()}});

app.post('/api/contact', contactLimiter, async (req,res,next)=>{
  try {
    const name=safeText(req.body.name,80), email=safeText(req.body.email,160).toLowerCase(), message=safeText(req.body.message,2000);
    if(!name || !validEmail(email) || !message) return res.status(400).json({error:'Informations de contact invalides.'});
    await pool.query('INSERT INTO contact_messages(name,email,message) VALUES($1,$2,$3)',[name,email,message]);
    res.status(201).json({message:'Votre demande a été enregistrée.'});
  }catch(e){next(e);}
});


const customerAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez plus tard.' }
});

async function customerAuth(req, res, next) {
  try {
    const raw = req.headers.cookie?.split(';').map(v => v.trim())
      .find(v => v.startsWith('nexora_customer_session='))
      ?.slice('nexora_customer_session='.length);
    if (!raw) return res.status(401).json({ error: 'Connexion requise.' });
    const r = await pool.query(
      'SELECT s.id,s.customer_id,c.name,c.username,c.email,c.phone,c.address,c.city,c.country,c.balance_cents,c.active FROM customer_sessions s JOIN customers c ON c.id=s.customer_id WHERE s.token_hash=$1 AND s.expires_at>NOW()',
      [sha256(raw)]
    );
    if (!r.rowCount) return res.status(401).json({ error: 'Session invalide ou expirée.' });
    req.customer = r.rows[0];
    req.rawCustomerSession = raw;
    next();
  } catch (e) { next(e); }
}

app.post('/api/customer/register', customerAuthLimiter, async (req,res,next)=>{
  try {
    const name=safeText(req.body.name,120), username=safeText(req.body.username,30).toLowerCase(), email=safeText(req.body.email,160).toLowerCase();
    const password=typeof req.body.password==='string'?req.body.password:'';
    if(!validName(name)||!validUsername(username)||!validEmail(email)||password.length<12||password.length>200)
      return res.status(400).json({error:'Nom, nom d’utilisateur, e-mail ou mot de passe invalide. Le nom doit contenir au moins deux mots et le nom d’utilisateur 3 à 30 caractères.'});
    const existing=await pool.query('SELECT id,password_hash FROM customers WHERE email=$1 OR LOWER(username)=LOWER($2)',[email,username]);
    if(existing.rowCount && existing.rows[0].password_hash)
      return res.status(409).json({error:'Cet e-mail ou ce nom d’utilisateur est déjà utilisé.'});
    const hash=hashPassword(password);
    const r=await pool.query(
      `INSERT INTO customers(name,username,email,password_hash) VALUES($1,$2,$3,$4)
       ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,username=EXCLUDED.username,password_hash=EXCLUDED.password_hash,updated_at=NOW()
       RETURNING id,name,username,email`,
      [name,username,email,hash]
    );
    const raw=randomToken(), expires=new Date(Date.now()+sessionHours*3600000);
    await pool.query('INSERT INTO customer_sessions(token_hash,customer_id,expires_at) VALUES($1,$2,$3)',[sha256(raw),r.rows[0].id,expires]);
    res.setHeader('Set-Cookie',`nexora_customer_session=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionHours*3600}${isProd?'; Secure':''}`);
    res.status(201).json({customer:r.rows[0]});
  } catch(e){next(e);}
});

app.post('/api/customer/login', customerAuthLimiter, async(req,res,next)=>{
  try {
    const identifier=safeText(req.body.identifier||req.body.email,160).toLowerCase(), password=typeof req.body.password==='string'?req.body.password:'';
    if(!identifier||password.length<12)return res.status(400).json({error:'Identifiants invalides.'});
    const r=await pool.query('SELECT id,name,username,email,password_hash,active FROM customers WHERE LOWER(email)=LOWER($1) OR LOWER(username)=LOWER($1)',[identifier]);
    if(!r.rowCount||!r.rows[0].active||!r.rows[0].password_hash||!verifyPassword(password,r.rows[0].password_hash))
      return res.status(401).json({error:'E-mail ou mot de passe incorrect.'});
    const raw=randomToken(),expires=new Date(Date.now()+sessionHours*3600000);
    await pool.query('INSERT INTO customer_sessions(token_hash,customer_id,expires_at) VALUES($1,$2,$3)',[sha256(raw),r.rows[0].id,expires]);
    res.setHeader('Set-Cookie',`nexora_customer_session=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionHours*3600}${isProd?'; Secure':''}`);
    res.json({customer:{id:r.rows[0].id,name:r.rows[0].name,username:r.rows[0].username,email:r.rows[0].email}});
  } catch(e){next(e);}
});


app.get('/api/customer/transactions',customerAuth,async(req,res,next)=>{
  try{
    const r=await pool.query(
      `SELECT o.id AS order_id,o.created_at,o.currency,o.total_cents,o.status,o.payment_status,o.payment_method,
              COALESCE(p.status,'pending') AS transaction_status,
              p.provider_reference
       FROM orders o LEFT JOIN LATERAL (
         SELECT status,provider_reference FROM payments WHERE order_id=o.id ORDER BY created_at DESC LIMIT 1
       ) p ON TRUE
       WHERE o.customer_id=$1 ORDER BY o.created_at DESC LIMIT 500`,[req.customer.customer_id]);
    res.json(r.rows);
  }catch(e){next(e);}
});
app.post('/api/customer/logout',customerAuth,async(req,res,next)=>{
  try{
    await pool.query('DELETE FROM customer_sessions WHERE id=$1',[req.customer.id]);
    res.setHeader('Set-Cookie','nexora_customer_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    res.json({message:'Déconnexion effectuée.'});
  }catch(e){next(e);}
});

app.get('/api/customer/me',customerAuth,(req,res)=>res.json({customer:req.customer}));

app.get('/api/customer/orders',customerAuth,async(req,res,next)=>{
  try{
    const orders=(await pool.query(
      `SELECT o.id,o.status,o.currency,o.total_cents,o.payment_status,o.payment_method,o.created_at,
              COALESCE(json_agg(json_build_object('name',oi.product_name,'quantity',oi.quantity,'unit_price_cents',oi.unit_price_cents,'line_total_cents',oi.line_total_cents) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL),'[]') AS items
       FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id
       WHERE o.customer_id=$1 GROUP BY o.id ORDER BY o.created_at DESC`,
      [req.customer.customer_id]
    )).rows;
    res.json(orders);
  }catch(e){next(e);}
});

app.post('/api/admin/login', loginLimiter, async (req,res,next)=>{
  try {
    const email=safeText(req.body.email,160).toLowerCase(), password=typeof req.body.password==='string'?req.body.password:'';
    if(!validEmail(email) || password.length<12) return res.status(400).json({error:'Identifiants invalides.'});
    const r=await pool.query('SELECT id,email,password_hash,role FROM admins WHERE email=$1',[email]);
    if(!r.rowCount || !verifyPassword(password,r.rows[0].password_hash)) return res.status(401).json({error:'E-mail ou mot de passe incorrect.'});
    const raw=randomToken(), csrfToken=randomToken(), expires=new Date(Date.now()+sessionHours*3600000);
    await pool.query('INSERT INTO sessions(token_hash,admin_id,csrf_hash,expires_at) VALUES($1,$2,$3,$4)',[sha256(raw),r.rows[0].id,sha256(csrfToken),expires]);
    await pool.query('UPDATE admins SET last_login_at=NOW() WHERE id=$1',[r.rows[0].id]);
    res.setHeader('Set-Cookie',`${sessionCookie}=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionHours*3600}${isProd?'; Secure':''}`);
    res.json({email:r.rows[0].email,role:r.rows[0].role,csrfToken});
  }catch(e){next(e);}
});

app.post('/api/admin/logout',auth,csrf,async(req,res,next)=>{
  try{await pool.query('DELETE FROM sessions WHERE id=$1',[req.auth.id]);res.setHeader('Set-Cookie',`${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isProd?'; Secure':''}`);res.json({message:'Déconnexion effectuée.'});}catch(e){next(e);}
});

app.get('/api/admin/me',auth,(req,res)=>{ const csrfToken=randomToken(); pool.query('UPDATE sessions SET csrf_hash=$1 WHERE id=$2',[sha256(csrfToken),req.auth.id]).then(()=>res.json({email:req.auth.email,role:req.auth.role,csrfToken})).catch(()=>res.status(500).json({error:'Session indisponible.'})); });

app.get('/api/admin/site',auth,async(req,res,next)=>{
  try{const r=await pool.query('SELECT * FROM site_content WHERE id=1');res.json(r.rows[0]);}catch(e){next(e);}
});

app.put('/api/admin/site',auth,csrf,requireRole('admin','editor'),async(req,res,next)=>{
  try{
    const company=safeText(req.body.company_name,120),tagline=safeText(req.body.tagline,240),hero=safeText(req.body.hero_text,1000),email=safeText(req.body.contact_email,160).toLowerCase();
    if(!company||!tagline||!hero||!validEmail(email)) return res.status(400).json({error:'Données invalides.'});
    const r=await pool.query('UPDATE site_content SET company_name=$1,tagline=$2,hero_text=$3,contact_email=$4,updated_at=NOW() WHERE id=1 RETURNING *',[company,tagline,hero,email]);
    await audit(req,'update','site','1'); res.json(r.rows[0]);
  }catch(e){next(e);}
});

app.get('/api/admin/products',auth,async(req,res,next)=>{
  try{const r=await pool.query('SELECT * FROM products ORDER BY created_at DESC');res.json(r.rows);}catch(e){next(e);}
});

app.post('/api/admin/products',auth,csrf,requireRole('admin','manager'),async(req,res,next)=>{
  try{
    const name=safeText(req.body.name,160),description=safeText(req.body.description,2000),currency=safeText(req.body.currency,3).toUpperCase(),price=Number(req.body.price_cents),stock=Number(req.body.stock_quantity),sku=safeText(req.body.sku,80),category=safeText(req.body.category,100),imageUrl=safeText(req.body.image_url,500);
    if(!name||!Number.isInteger(price)||price<0||!Number.isInteger(stock)||stock<0||!/^[A-Z]{3}$/.test(currency)|| (imageUrl && !/^https:\/\//i.test(imageUrl))) return res.status(400).json({error:'Produit invalide.'});
    const r=await pool.query('INSERT INTO products(name,description,price_cents,currency,sku,category,image_url,stock_quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[name,description,price,currency,sku||null,category,imageUrl,stock]);await audit(req,'create','product',r.rows[0].id); res.status(201).json(r.rows[0]);
  }catch(e){next(e);}
});

app.put('/api/admin/products/:id',auth,csrf,requireRole('admin','manager'),async(req,res,next)=>{
  try{
    const id=Number(req.params.id),name=safeText(req.body.name,160),description=safeText(req.body.description,2000),currency=safeText(req.body.currency,3).toUpperCase(),price=Number(req.body.price_cents),active=parseBoolean(req.body.active),stock=Number(req.body.stock_quantity),sku=safeText(req.body.sku,80),category=safeText(req.body.category,100),imageUrl=safeText(req.body.image_url,500);
    if(!Number.isInteger(id)||!name||!Number.isInteger(price)||price<0||active===null||!Number.isInteger(stock)||stock<0||!/^[A-Z]{3}$/.test(currency)||(imageUrl&&!/^https:\/\//i.test(imageUrl))) return res.status(400).json({error:'Produit invalide.'});
    const r=await pool.query('UPDATE products SET name=$1,description=$2,price_cents=$3,currency=$4,sku=$5,category=$6,image_url=$7,stock_quantity=$8,active=$9,updated_at=NOW() WHERE id=$10 RETURNING *',[name,description,price,currency,sku||null,category,imageUrl,stock,active,id]);
    if(!r.rowCount)return res.status(404).json({error:'Produit introuvable.'}); await audit(req,'update','product',id); res.json(r.rows[0]);
  }catch(e){next(e);}
});

app.delete('/api/admin/products/:id',auth,csrf,requireRole('admin'),async(req,res,next)=>{
  try{const r=await pool.query('DELETE FROM products WHERE id=$1 RETURNING id',[Number(req.params.id)]);if(!r.rowCount)return res.status(404).json({error:'Produit introuvable.'});await audit(req,'delete','product',req.params.id); res.status(204).end();}catch(e){next(e);}
});

app.post('/api/admin/password',auth,csrf,async(req,res,next)=>{
  try {
    const current=typeof req.body.currentPassword==='string'?req.body.currentPassword:'';
    const nextPassword=typeof req.body.newPassword==='string'?req.body.newPassword:'';
    if(nextPassword.length<12 || nextPassword.length>200) return res.status(400).json({error:'Le nouveau mot de passe doit contenir au moins 12 caractères.'});
    const r=await pool.query('SELECT password_hash FROM admins WHERE id=$1',[req.auth.admin_id]);
    if(!r.rowCount || !verifyPassword(current,r.rows[0].password_hash)) return res.status(401).json({error:'Mot de passe actuel incorrect.'});
    await pool.query('UPDATE admins SET password_hash=$1 WHERE id=$2',[hashPassword(nextPassword),req.auth.admin_id]);
    await pool.query('DELETE FROM sessions WHERE admin_id=$1 AND id<>$2',[req.auth.admin_id,req.auth.id]);
    await audit(req,'change_password','admin',req.auth.admin_id);
    res.json({message:'Mot de passe modifié.'});
  } catch(e){next(e);}
});

app.get('/api/admin/audit',auth,requireRole('admin'),async(req,res,next)=>{
  try { const r=await pool.query('SELECT id,action,entity,entity_id,ip_address,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 200'); res.json(r.rows); } catch(e){next(e);}
});

app.get('/api/admin/customers',auth,requireRole('admin','manager','editor'),async(req,res,next)=>{
  try{
    const r=await pool.query(`SELECT c.id,c.name,c.email,c.phone,c.country,c.active,c.balance_cents,c.created_at,
      COUNT(o.id)::int AS order_count
      FROM customers c LEFT JOIN orders o ON o.customer_id=c.id
      GROUP BY c.id ORDER BY c.created_at DESC LIMIT 1000`);
    res.json(r.rows);
  }catch(e){next(e);}
});
app.put('/api/admin/customers/:id/status',auth,csrf,requireRole('admin','manager'),async(req,res,next)=>{
  try{
    const id=Number(req.params.id), active=parseBoolean(req.body.active);
    if(!Number.isInteger(id)||active===null)return res.status(400).json({error:'Statut invalide.'});
    const r=await pool.query('UPDATE customers SET active=$1,updated_at=NOW() WHERE id=$2 RETURNING id,active',[active,id]);
    if(!r.rowCount)return res.status(404).json({error:'Client introuvable.'});
    await audit(req,'update','customer_status',id);res.json(r.rows[0]);
  }catch(e){next(e);}
});
app.put('/api/admin/customers/:id/balance',auth,csrf,requireRole('admin','manager'),async(req,res,next)=>{
  try{
    const id=Number(req.params.id), amount=Number(req.body.balance_cents);
    if(!Number.isInteger(id)||!Number.isSafeInteger(amount)||amount<0)return res.status(400).json({error:'Solde invalide.'});
    const r=await pool.query('UPDATE customers SET balance_cents=$1,updated_at=NOW() WHERE id=$2 RETURNING id,balance_cents',[amount,id]);
    if(!r.rowCount)return res.status(404).json({error:'Client introuvable.'});
    await audit(req,'update','customer_balance',id);res.json(r.rows[0]);
  }catch(e){next(e);}
});

app.get('/api/admin/orders',auth,requireRole('admin','manager','editor'),async(req,res,next)=>{
  try{const r=await pool.query('SELECT o.id,o.status,o.currency,o.total_cents,o.created_at,c.name,c.email,c.city,c.country FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.created_at DESC LIMIT 500');res.json(r.rows);}catch(e){next(e);}
});
app.put('/api/admin/orders/:id/status',auth,csrf,requireRole('admin','manager'),async(req,res,next)=>{
  try{const id=Number(req.params.id),status=safeText(req.body.status,20);if(!Number.isInteger(id)||!['pending','confirmed','processing','shipped','delivered','cancelled'].includes(status))return res.status(400).json({error:'Statut invalide.'});const r=await pool.query('UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[status,id]);if(!r.rowCount)return res.status(404).json({error:'Commande introuvable.'});await audit(req,'update','order',id);res.json(r.rows[0]);}catch(e){next(e);}
});
app.get('/api/admin/messages',auth,requireRole('admin','editor'),async(req,res,next)=>{
  try{const r=await pool.query('SELECT id,name,email,message,created_at,handled FROM contact_messages ORDER BY created_at DESC LIMIT 200');res.json(r.rows);}catch(e){next(e);}
});

app.get('/health',async(_req,res)=>{
  const diagnostics={service:'nexora-group',vercel_env:process.env.VERCEL_ENV||null,node_env:process.env.NODE_ENV||null,has_database_url:Boolean(process.env.DATABASE_URL)};
  try{
    if(!pool)return res.status(503).json({status:'error',reason:'database_not_configured',...diagnostics});
    await pool.query('SELECT 1');
    res.status(200).json({status:'ok',...diagnostics});
  }catch(error){
    res.status(503).json({status:'error',reason:'database_connection_failed',error_type:error?.name||'Error',...diagnostics});
  }
});

app.use(express.static(publicDir,{extensions:['html'],dotfiles:'deny'}));
app.get('/',(_req,res)=>res.sendFile('index.html',{root:publicDir}));
app.get('/admin',(_req,res)=>res.sendFile('admin.html',{root:publicDir}));
app.get('/connexion',(_req,res)=>res.sendFile('connexion.html',{root:publicDir}));
if (pool) setInterval(()=>pool.query('DELETE FROM sessions WHERE expires_at<=NOW()').catch(()=>{}),60*60*1000).unref();

app.use((err,_req,res,_next)=>{
  console.error(err);
  res.status(500).json({error:'Une erreur interne est survenue.'});
});

let server;
if (!process.env.VERCEL) {
  server=app.listen(port,()=>console.log(`NEXORA écoute sur le port ${port}`));
  async function shutdown(){await pool.end();server.close(()=>process.exit(0));}
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}

export default app;
