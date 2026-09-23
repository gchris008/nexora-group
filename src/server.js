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
app.use(express.json({ limit: '3mb' }));
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
function normalizePhone(value) { return safeText(value, 30).replace(/[\s().-]/g, ''); }
function validPhone(value) { return /^\+[1-9]\d{7,14}$/.test(value); }
function maskPhone(value) { const v=String(value||''); return v.length<=6 ? v : v.slice(0,4)+' •••• •••• '+v.slice(-2); }
function validName(value) { return /^[\p{L}]+(?:[ '\u2019-][\p{L}]+){1,5}$/u.test(value); }
function validUsername(value) { return /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{2,29})$/.test(value); }
function parseBoolean(value) { if (value === true || value === false) return value; if (value === 'true') return true; if (value === 'false') return false; return null; }
function emailConfigured() { return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL); }
function publicAppUrl() { return (process.env.PUBLIC_APP_URL || 'https://nexora-group.vercel.app').replace(/\/$/,''); }
function hashVerificationCode(code) { return sha256(String(code)); }
function randomVerificationCode() { return String(crypto.randomInt(100000,1000000)); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
async function sendEmail({to,subject,html}) {
  if (!emailConfigured()) throw Object.assign(new Error('La vérification par e-mail n’est pas encore configurée.'), {statusCode:503});
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.RESEND_API_KEY},body:JSON.stringify({from:process.env.RESEND_FROM_EMAIL,to:[to],subject,html})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw Object.assign(new Error(data.message||'Impossible d’envoyer l’e-mail.'),{statusCode:502});
  return data;
}
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
    const phone=normalizePhone(req.body.customer?.phone), address=safeText(req.body.customer?.address,240), city=safeText(req.body.customer?.city,120);
    const items=Array.isArray(req.body.items)?req.body.items.slice(0,50):[];
    if(!validName(name)||!validEmail(email)||!validPhone(phone)||!address||!city||!items.length) return res.status(400).json({error:'Informations de commande invalides.'});
    const ids=[...new Set(items.map(x=>Number(x.product_id)).filter(Number.isInteger))];
    if(!ids.length)return res.status(400).json({error:'Panier invalide.'});
    await client.query('BEGIN');
    const products=(await client.query('SELECT id,name,price_cents,currency,stock_quantity FROM products WHERE id=ANY($1::bigint[]) AND active=TRUE FOR UPDATE',[ids])).rows;
    const map=new Map(products.map(p=>[Number(p.id),p]));
    let total=0,currency=null,lines=[];
    for(const item of items){const id=Number(item.product_id),qty=Number(item.quantity),p=map.get(id);if(!p||!Number.isInteger(qty)||qty<1||qty>99)throw Object.assign(new Error('Panier invalide.'),{statusCode:400});if(qty>p.stock_quantity)throw Object.assign(new Error(`Stock insuffisant pour ${p.name}.`),{statusCode:409});if(currency&&currency!==p.currency)throw Object.assign(new Error('Les produits doivent utiliser la même devise.'),{statusCode:400});currency=p.currency;const line=p.price_cents*qty;total+=line;lines.push({p,qty,line});}
    if(total>2147483647)throw Object.assign(new Error('Commande trop élevée.'),{statusCode:400});
    const customer=(await client.query('INSERT INTO customers(name,email,phone,address,city) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone,address=EXCLUDED.address,city=EXCLUDED.city,updated_at=NOW() RETURNING id',[name,email,phone,address,city])).rows[0];
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

let customerSchemaReady = null;
async function ensureCustomerAuthSchema() {
  if (!pool) return false;
  if (!customerSchemaReady) {
    customerSchemaReady = (async () => {
      await pool.query("CREATE TABLE IF NOT EXISTS customers (id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,phone TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',city TEXT NOT NULL DEFAULT '',country TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await pool.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_hash TEXT");
      await pool.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS username TEXT");
      await pool.query("UPDATE customers SET username='client-' || id::text WHERE username IS NULL OR username=''");
      await pool.query("ALTER TABLE customers ALTER COLUMN username SET NOT NULL");
      await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS customers_username_unique_idx ON customers(LOWER(username))");
      await pool.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ");
      await pool.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ");
      await pool.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE");
      await pool.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS balance_cents BIGINT NOT NULL DEFAULT 0");
      await pool.query("CREATE TABLE IF NOT EXISTS customer_sessions (id BIGSERIAL PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await pool.query("CREATE INDEX IF NOT EXISTS customer_sessions_token_hash_idx ON customer_sessions(token_hash)");
      await pool.query("CREATE INDEX IF NOT EXISTS customer_sessions_expires_at_idx ON customer_sessions(expires_at)");
      await pool.query("CREATE TABLE IF NOT EXISTS customer_verification_challenges (id BIGSERIAL PRIMARY KEY,customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,purpose TEXT NOT NULL CHECK (purpose IN ('registration','login','profile','new_phone')),phone TEXT NOT NULL,verification_sid TEXT NOT NULL,payload JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL,consumed_at TIMESTAMPTZ)");
      await pool.query("CREATE INDEX IF NOT EXISTS customer_verification_challenges_customer_idx ON customer_verification_challenges(customer_id,purpose,created_at DESC)");
      await pool.query("CREATE INDEX IF NOT EXISTS customer_verification_challenges_expires_idx ON customer_verification_challenges(expires_at)");
      await pool.query("CREATE TABLE IF NOT EXISTS customer_email_verifications (id BIGSERIAL PRIMARY KEY,customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,purpose TEXT NOT NULL CHECK (purpose IN ('registration','reset','profile')),email TEXT NOT NULL,code_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL,consumed_at TIMESTAMPTZ)");
      await pool.query("CREATE INDEX IF NOT EXISTS customer_email_verifications_lookup_idx ON customer_email_verifications(customer_id,purpose,email,created_at DESC)");
      await pool.query("CREATE INDEX IF NOT EXISTS customer_email_verifications_expires_idx ON customer_email_verifications(expires_at)");
      return true;
    })().catch(error => { customerSchemaReady = null; throw error; });
  }
  await customerSchemaReady;
  return true;
}

async function customerAuth(req, res, next) {
  try {
    const raw = req.headers.cookie?.split(';').map(v => v.trim())
      .find(v => v.startsWith('nexora_customer_session='))
      ?.slice('nexora_customer_session='.length);
    if (!raw) return res.status(401).json({ error: 'Connexion requise.' });
    const r = await pool.query(
      'SELECT s.id,s.customer_id,c.name,c.username,c.email,c.phone,c.phone_verified_at,c.address,c.city,c.country,c.balance_cents,c.active FROM customer_sessions s JOIN customers c ON c.id=s.customer_id WHERE s.token_hash=$1 AND s.expires_at>NOW()',
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
    if (!pool) return res.status(503).json({error:'Le service de création de compte n’est pas encore connecté à la base de données.'});
    await ensureCustomerAuthSchema();
    const name=safeText(req.body.name,120), username=safeText(req.body.username,30).toLowerCase(), email=safeText(req.body.email,160).toLowerCase(), phone=normalizePhone(req.body.phone);
    const password=typeof req.body.password==='string'?req.body.password:'';
    if(!validName(name)||!validUsername(username)||!validEmail(email)||!validPhone(phone)||password.length<12||password.length>200)return res.status(400).json({error:'Nom, nom d’utilisateur, e-mail, téléphone ou mot de passe invalide.'});
    if(!emailConfigured()) return res.status(503).json({error:'La vérification par e-mail n’est pas encore configurée.'});
    const existing=await pool.query('SELECT id,active,email_verified_at FROM customers WHERE email=$1 OR LOWER(username)=LOWER($2) LIMIT 1',[email,username]);
    if(existing.rowCount) return res.status(409).json({error:existing.rows[0].email_verified_at?'Ce compte existe déjà. Utilisez la connexion ou réinitialisez votre mot de passe.':'Une inscription existe déjà avec ces informations. Vérifiez votre e-mail.'});
    const hash=hashPassword(password);
    const customer=(await pool.query('INSERT INTO customers(name,username,email,password_hash,phone,active,email_verified_at) VALUES($1,$2,$3,$4,$5,FALSE,NULL) RETURNING id,name,username,email,phone',[name,username,email,hash,phone])).rows[0];
    const code=randomVerificationCode();
    await pool.query('INSERT INTO customer_email_verifications(customer_id,purpose,email,code_hash,expires_at) VALUES($1,\'registration\',$2,$3,NOW()+INTERVAL \'10 minutes\')',[customer.id,email,hashVerificationCode(code)]);
    try {
      await sendEmail({to:email,subject:'NEXORA GROUP — Vérification de votre compte',html:'<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>NEXORA GROUP</h2><p>Bonjour '+escapeHtml(name)+',</p><p>Votre code de vérification est :</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">'+code+'</p><p>Ce code expire dans 10 minutes.</p><p>Si vous n’êtes pas à l’origine de cette inscription, ignorez cet e-mail.</p></div>'});
    } catch(e) {
      await pool.query('DELETE FROM customer_email_verifications WHERE customer_id=$1',[customer.id]).catch(()=>{});
      await pool.query('DELETE FROM customers WHERE id=$1 AND active=FALSE',[customer.id]).catch(()=>{});
      throw e;
    }
    res.status(201).json({verificationRequired:true,customerId:customer.id,email,message:'Un code de vérification a été envoyé à votre adresse e-mail.'});
  } catch(e){
    console.error('customer_register_error',{name:e?.name,code:e?.code,message:e?.message});
    if(e?.code==='23505') return res.status(409).json({error:'Ce compte existe déjà. Utilisez la connexion ou réinitialisez votre mot de passe.'});
    res.status(e.statusCode||500).json({error:e.statusCode===503?e.message:'Une erreur interne est survenue.'});
  }
});

app.post('/api/customer/verify-registration', customerAuthLimiter, async(req,res,next)=>{
  try {
    await ensureCustomerAuthSchema();
    const customerId=Number(req.body.customer_id), email=safeText(req.body.email,160).toLowerCase(), code=safeText(req.body.code,10);
    if(!Number.isInteger(customerId)||!validEmail(email)||!/^[0-9]{6}$/.test(code)) return res.status(400).json({error:'Code de vérification invalide.'});
    const challenge=(await pool.query('SELECT id,code_hash FROM customer_email_verifications WHERE customer_id=$1 AND purpose=\'registration\' AND email=$2 AND consumed_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1',[customerId,email])).rows[0];
    if(!challenge)return res.status(400).json({error:'Le code a expiré. Demandez un nouveau code.'});
    const valid=crypto.timingSafeEqual(Buffer.from(hashVerificationCode(code)),Buffer.from(challenge.code_hash));
    if(!valid)return res.status(400).json({error:'Code incorrect ou expiré.'});
    const c=(await pool.query('UPDATE customers SET email_verified_at=NOW(),active=TRUE,updated_at=NOW() WHERE id=$1 AND email=$2 RETURNING id,name,username,email,phone,email_verified_at',[customerId,email])).rows[0];
    if(!c)return res.status(404).json({error:'Compte introuvable.'});
    await pool.query('UPDATE customer_email_verifications SET consumed_at=NOW() WHERE id=$1',[challenge.id]);
    const raw=randomToken(),expires=new Date(Date.now()+sessionHours*3600000);
    await pool.query('INSERT INTO customer_sessions(token_hash,customer_id,expires_at) VALUES($1,$2,$3)',[sha256(raw),customerId,expires]);
    res.setHeader('Set-Cookie','nexora_customer_session='+raw+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+sessionHours*3600+(isProd?'; Secure':''));
    res.json({customer:c});
  }catch(e){next(e);}
});

app.post('/api/customer/resend-registration', customerAuthLimiter, async(req,res,next)=>{
  try {
    await ensureCustomerAuthSchema();
    const customerId=Number(req.body.customer_id), email=safeText(req.body.email,160).toLowerCase();
    if(!Number.isInteger(customerId)||!validEmail(email))return res.status(400).json({error:'Informations de vérification invalides.'});
    const c=(await pool.query('SELECT id,name,email,email_verified_at,active FROM customers WHERE id=$1',[customerId])).rows[0];
    if(!c||c.email!==email)return res.status(404).json({error:'Inscription introuvable.'});
    if(c.email_verified_at)return res.status(409).json({error:'Cette adresse e-mail est déjà vérifiée.'});
    const recent=(await pool.query('SELECT created_at FROM customer_email_verifications WHERE customer_id=$1 AND purpose=\'registration\' ORDER BY created_at DESC LIMIT 1',[customerId])).rows[0];
    if(recent&&Date.now()-new Date(recent.created_at).getTime()<30000)return res.status(429).json({error:'Attendez quelques secondes avant de demander un nouveau code.'});
    const code=randomVerificationCode();
    await pool.query('UPDATE customer_email_verifications SET consumed_at=NOW() WHERE customer_id=$1 AND purpose=\'registration\' AND consumed_at IS NULL',[customerId]);
    await pool.query('INSERT INTO customer_email_verifications(customer_id,purpose,email,code_hash,expires_at) VALUES($1,\'registration\',$2,$3,NOW()+INTERVAL \'10 minutes\')',[customerId,email,hashVerificationCode(code)]);
    await sendEmail({to:email,subject:'NEXORA GROUP — Nouveau code de vérification',html:'<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>NEXORA GROUP</h2><p>Bonjour '+escapeHtml(c.name)+',</p><p>Votre nouveau code est :</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">'+code+'</p><p>Ce code expire dans 10 minutes.</p></div>'});
    res.json({message:'Un nouveau code a été envoyé par e-mail.'});
  }catch(e){res.status(e.statusCode||500).json({error:e.statusCode===503?e.message:'Impossible d’envoyer le code.'});}
});

app.post('/api/customer/login', customerAuthLimiter, async(req,res,next)=>{
  try {
    await ensureCustomerAuthSchema();
    const identifier=safeText(req.body.identifier||req.body.email,160).toLowerCase(), password=typeof req.body.password==='string'?req.body.password:'';
    if(!identifier||password.length<12)return res.status(400).json({error:'Identifiants invalides.'});
    const r=await pool.query('SELECT id,name,username,email,password_hash,active,email_verified_at FROM customers WHERE LOWER(email)=LOWER($1) OR LOWER(username)=LOWER($1)',[identifier]);
    if(!r.rowCount||!r.rows[0].password_hash||!verifyPassword(password,r.rows[0].password_hash))return res.status(401).json({error:'E-mail ou mot de passe incorrect.'});
    if(!r.rows[0].active)return res.status(403).json({error:'Ce compte est désactivé.'});
    if(!r.rows[0].email_verified_at)return res.status(403).json({error:'Votre adresse e-mail n’est pas encore vérifiée. Vérifiez votre boîte de réception ou demandez un nouveau code.'});
    const raw=randomToken(),expires=new Date(Date.now()+sessionHours*3600000);
    await pool.query('INSERT INTO customer_sessions(token_hash,customer_id,expires_at) VALUES($1,$2,$3)',[sha256(raw),r.rows[0].id,expires]);
    res.setHeader('Set-Cookie','nexora_customer_session='+raw+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+sessionHours*3600+(isProd?'; Secure':''));
    res.json({customer:{id:r.rows[0].id,name:r.rows[0].name,username:r.rows[0].username,email:r.rows[0].email}});
  }catch(e){next(e);}
});

app.post('/api/customer/password-reset/request', customerAuthLimiter, async(req,res,next)=>{
  try{
    await ensureCustomerAuthSchema();
    const email=safeText(req.body.email,160).toLowerCase();
    if(!validEmail(email))return res.status(400).json({error:'Adresse e-mail invalide.'});
    const c=(await pool.query('SELECT id,name,email,active FROM customers WHERE email=$1 LIMIT 1',[email])).rows[0];
    if(!c||!c.active)return res.json({message:'Si cette adresse existe, un code de réinitialisation a été envoyé.'});
    const recent=(await pool.query('SELECT created_at FROM customer_email_verifications WHERE customer_id=$1 AND purpose=\'reset\' ORDER BY created_at DESC LIMIT 1',[c.id])).rows[0];
    if(recent&&Date.now()-new Date(recent.created_at).getTime()<30000)return res.status(429).json({error:'Attendez quelques secondes avant de demander un nouveau code.'});
    const code=randomVerificationCode();
    await pool.query('UPDATE customer_email_verifications SET consumed_at=NOW() WHERE customer_id=$1 AND purpose=\'reset\' AND consumed_at IS NULL',[c.id]);
    await pool.query('INSERT INTO customer_email_verifications(customer_id,purpose,email,code_hash,expires_at) VALUES($1,\'reset\',$2,$3,NOW()+INTERVAL \'10 minutes\')',[c.id,email,hashVerificationCode(code)]);
    await sendEmail({to:email,subject:'NEXORA GROUP — Réinitialisation du mot de passe',html:'<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>NEXORA GROUP</h2><p>Bonjour '+escapeHtml(c.name)+',</p><p>Votre code de réinitialisation est :</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">'+code+'</p><p>Ce code expire dans 10 minutes.</p><p>Si vous n’avez pas demandé cette réinitialisation, ignorez cet e-mail.</p></div>'});
    res.json({message:'Si cette adresse existe, un code de réinitialisation a été envoyé.'});
  }catch(e){res.status(e.statusCode||500).json({error:e.statusCode===503?e.message:'Impossible d’envoyer le code.'});}
});

app.post('/api/customer/password-reset/confirm', customerAuthLimiter, async(req,res,next)=>{
  try{
    await ensureCustomerAuthSchema();
    const email=safeText(req.body.email,160).toLowerCase(),code=safeText(req.body.code,10),newPassword=typeof req.body.newPassword==='string'?req.body.newPassword:'';
    if(!validEmail(email)||!/^[0-9]{6}$/.test(code)||newPassword.length<12||newPassword.length>200)return res.status(400).json({error:'E-mail, code ou nouveau mot de passe invalide.'});
    const c=(await pool.query('SELECT id,name,email,active FROM customers WHERE email=$1 LIMIT 1',[email])).rows[0];
    if(!c||!c.active)return res.status(400).json({error:'Code incorrect ou expiré.'});
    const challenge=(await pool.query('SELECT id,code_hash FROM customer_email_verifications WHERE customer_id=$1 AND purpose=\'reset\' AND email=$2 AND consumed_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1',[c.id,email])).rows[0];
    if(!challenge)return res.status(400).json({error:'Le code a expiré. Demandez-en un nouveau.'});
    const valid=crypto.timingSafeEqual(Buffer.from(hashVerificationCode(code)),Buffer.from(challenge.code_hash));
    if(!valid)return res.status(400).json({error:'Code incorrect ou expiré.'});
    await pool.query('UPDATE customers SET password_hash=$1,email_verified_at=COALESCE(email_verified_at,NOW()),updated_at=NOW() WHERE id=$2',[hashPassword(newPassword),c.id]);
    await pool.query('UPDATE customer_email_verifications SET consumed_at=NOW() WHERE id=$1',[challenge.id]);
    await pool.query('DELETE FROM customer_sessions WHERE customer_id=$1',[c.id]);
    res.json({message:'Mot de passe réinitialisé. Vous pouvez maintenant vous connecter.'});
  }catch(e){next(e);}
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

app.post('/api/customer/verify-login', customerAuthLimiter, async(req,res,next)=>{
  try{
    await ensureCustomerAuthSchema();
    const customerId=Number(req.body.customer_id), phone=normalizePhone(req.body.phone), code=safeText(req.body.code,10);
    if(!Number.isInteger(customerId)||!validPhone(phone)||!/^[0-9]{4,10}$/.test(code))return res.status(400).json({error:'Code de vérification invalide.'});
    const challenge=(await pool.query('SELECT id FROM customer_verification_challenges WHERE customer_id=$1 AND purpose=\'login\' AND phone=$2 AND consumed_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1',[customerId,phone])).rows[0];
    if(!challenge)return res.status(400).json({error:'Le code a expiré. Reconnectez-vous pour recevoir un nouveau code.'});
    const check=await checkPhoneVerification(phone,code);
    if(check.status!=='approved')return res.status(400).json({error:'Code incorrect ou expiré.'});
    await pool.query('UPDATE customers SET phone_verified_at=NOW(),updated_at=NOW() WHERE id=$1 AND phone=$2',[customerId,phone]);
    await pool.query('UPDATE customer_verification_challenges SET consumed_at=NOW() WHERE id=$1',[challenge.id]);
    const raw=randomToken(),expires=new Date(Date.now()+sessionHours*3600000);
    await pool.query('INSERT INTO customer_sessions(token_hash,customer_id,expires_at) VALUES($1,$2,$3)',[sha256(raw),customerId,expires]);
    res.setHeader('Set-Cookie',`nexora_customer_session=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionHours*3600}${isProd?'; Secure':''}`);
    const c=(await pool.query('SELECT id,name,username,email,phone,phone_verified_at,address,city,country,balance_cents,active FROM customers WHERE id=$1',[customerId])).rows[0];
    res.json({customer:c});
  }catch(e){next(e);}
});

app.post('/api/customer/profile/request-verification', customerAuth, customerAuthLimiter, async(req,res,next)=>{
  try{
    await ensureCustomerAuthSchema();
    const currentPassword=typeof req.body.currentPassword==='string'?req.body.currentPassword:'';
    const name=safeText(req.body.name,120),username=safeText(req.body.username,30).toLowerCase(),email=safeText(req.body.email,160).toLowerCase(),phone=normalizePhone(req.body.phone),address=safeText(req.body.address,240),city=safeText(req.body.city,120);
    if(!validName(name)||!validUsername(username)||!validEmail(email)||!validPhone(phone)||!address||!city)return res.status(400).json({error:'Les informations du profil sont invalides.'});
    const current=(await pool.query('SELECT password_hash,phone,phone_verified_at FROM customers WHERE id=$1',[req.customer.customer_id])).rows[0];
    if(!current||!current.phone_verified_at||!verifyPassword(currentPassword,current.password_hash))return res.status(401).json({error:'Mot de passe actuel incorrect ou numéro non vérifié.'});
    const emailOwner=(await pool.query('SELECT id FROM customers WHERE LOWER(email)=LOWER($1) AND id<>$2 LIMIT 1',[email,req.customer.customer_id])).rows[0];
    if(emailOwner)return res.status(409).json({error:'Cette adresse e-mail est déjà utilisée.'});
    const usernameOwner=(await pool.query('SELECT id FROM customers WHERE LOWER(username)=LOWER($1) AND id<>$2 LIMIT 1',[username,req.customer.customer_id])).rows[0];
    if(usernameOwner)return res.status(409).json({error:'Ce nom d’utilisateur est déjà utilisé.'});
    const purpose=phone===current.phone?'profile':'new_phone';
    const targetPhone=purpose==='profile'?current.phone:phone;
    const recent=(await pool.query('SELECT created_at FROM customer_verification_challenges WHERE customer_id=$1 AND purpose=$2 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1',[req.customer.customer_id,purpose])).rows[0];
    if(recent && Date.now()-new Date(recent.created_at).getTime()<30000)return res.status(429).json({error:'Attendez quelques secondes avant de demander un nouveau code.'});
    const verification=await startPhoneVerification(targetPhone);
    await pool.query('UPDATE customer_verification_challenges SET consumed_at=NOW() WHERE customer_id=$1 AND purpose=$2 AND consumed_at IS NULL',[req.customer.customer_id,purpose]);
    const payload={name,username,email,phone,address,city};
    await pool.query('INSERT INTO customer_verification_challenges(customer_id,purpose,phone,verification_sid,payload,expires_at) VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL \'10 minutes\')',[req.customer.customer_id,purpose,targetPhone,verification.sid,JSON.stringify(payload)]);
    res.json({verificationRequired:true,purpose,targetPhone,phoneMasked:maskPhone(targetPhone),message:purpose==='profile'?'Un code a été envoyé à votre numéro actuel.':'Un code a été envoyé au nouveau numéro.'});
  }catch(e){res.status(e.statusCode||500).json({error:e.statusCode===429?'Trop de demandes de SMS. Réessayez plus tard.':e.statusCode===503?e.message:'Impossible de lancer la vérification du profil.'});}
});

app.post('/api/customer/profile/verify', customerAuth, customerAuthLimiter, async(req,res,next)=>{
  try{
    await ensureCustomerAuthSchema();
    const code=safeText(req.body.code,10),purpose=safeText(req.body.purpose,20),targetPhone=normalizePhone(req.body.phone);
    if(!['profile','new_phone'].includes(purpose)||!/^[0-9]{4,10}$/.test(code)||!validPhone(targetPhone))return res.status(400).json({error:'Code de vérification invalide.'});
    const challenge=(await pool.query('SELECT id,phone,payload FROM customer_verification_challenges WHERE customer_id=$1 AND purpose=$2 AND phone=$3 AND consumed_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1',[req.customer.customer_id,purpose,targetPhone])).rows[0];
    if(!challenge||!challenge.payload)return res.status(400).json({error:'La demande de modification a expiré. Recommencez.'});
    const check=await checkPhoneVerification(targetPhone,code);
    if(check.status!=='approved')return res.status(400).json({error:'Code incorrect ou expiré.'});
    const p=challenge.payload;
    if(!validName(p.name)||!validUsername(p.username)||!validEmail(p.email)||!validPhone(p.phone)||!p.address||!p.city)return res.status(400).json({error:'Modification de profil invalide.'});
    if(p.phone!==req.customer.phone){
      await pool.query('UPDATE customers SET name=$1,username=$2,email=$3,phone=$4,address=$5,city=$6,phone_verified_at=NOW(),updated_at=NOW() WHERE id=$7',[p.name,p.username,p.email,p.phone,p.address,p.city,req.customer.customer_id]);
    }else{
      await pool.query('UPDATE customers SET name=$1,username=$2,email=$3,address=$4,city=$5,updated_at=NOW() WHERE id=$6',[p.name,p.username,p.email,p.address,p.city,req.customer.customer_id]);
    }
    await pool.query('UPDATE customer_verification_challenges SET consumed_at=NOW() WHERE id=$1',[challenge.id]);
    const c=(await pool.query('SELECT id,name,username,email,phone,phone_verified_at,address,city,country,balance_cents,active FROM customers WHERE id=$1',[req.customer.customer_id])).rows[0];
    res.json({customer:c,message:'Profil vérifié et mis à jour.'});
  }catch(e){next(e);}
});


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
    const name=safeText(req.body.name,160),description=safeText(req.body.description,2000),currency=safeText(req.body.currency,3).toUpperCase(),price=Number(req.body.price_cents),stock=Number(req.body.stock_quantity),sku=safeText(req.body.sku,80),category=safeText(req.body.category,100),imageUrl=safeText(req.body.image_url,1800000);
    if(!name||!Number.isInteger(price)||price<0||!Number.isInteger(stock)||stock<0||!/^[A-Z]{3}$/.test(currency)|| (imageUrl && !(/^https:\/\//i.test(imageUrl)||/^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/i.test(imageUrl)))) return res.status(400).json({error:'Produit invalide.'});
    const r=await pool.query('INSERT INTO products(name,description,price_cents,currency,sku,category,image_url,stock_quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[name,description,price,currency,sku||null,category,imageUrl,stock]);await audit(req,'create','product',r.rows[0].id); res.status(201).json(r.rows[0]);
  }catch(e){next(e);}
});

app.put('/api/admin/products/:id',auth,csrf,requireRole('admin','manager'),async(req,res,next)=>{
  try{
    const id=Number(req.params.id),name=safeText(req.body.name,160),description=safeText(req.body.description,2000),currency=safeText(req.body.currency,3).toUpperCase(),price=Number(req.body.price_cents),active=parseBoolean(req.body.active),stock=Number(req.body.stock_quantity),sku=safeText(req.body.sku,80),category=safeText(req.body.category,100),imageUrl=safeText(req.body.image_url,1800000);
    if(!Number.isInteger(id)||!name||!Number.isInteger(price)||price<0||active===null||!Number.isInteger(stock)||stock<0||!/^[A-Z]{3}$/.test(currency)||(imageUrl&& !(/^https:\/\//i.test(imageUrl)||/^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/i.test(imageUrl)))) return res.status(400).json({error:'Produit invalide.'});
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
    const r=await pool.query(`SELECT c.id,c.name,c.email,c.phone,c.phone_verified_at,c.country,c.active,c.balance_cents,c.created_at,
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
