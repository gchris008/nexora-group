import 'node:process';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const sessionCookie = process.env.SESSION_COOKIE_NAME || 'nexora_session';
const sessionHours = Number(process.env.SESSION_TTL_HOURS || 8);
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL est obligatoire.');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: true } : false,
  max: 10,
  idleTimeoutMillis: 30000
});

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
function parseBoolean(value) { if (value === true || value === false) return value; if (value === 'true') return true; if (value === 'false') return false; return null; }
async function audit(req, action, entity, entityId = null) { await pool.query('INSERT INTO audit_logs(admin_id,action,entity,entity_id,ip_address) VALUES($1,$2,$3,$4,$5)', [req.auth?.admin_id ?? null, action, entity, entityId == null ? null : String(entityId), req.ip]); }

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
  try { const r=await pool.query('SELECT id,name,description,price_cents,currency FROM products WHERE active=TRUE ORDER BY created_at DESC'); res.json(r.rows); } catch(e){next(e);}
});

app.get('/api/site', async (_req,res,next)=>{
  try {
    const r=await pool.query('SELECT company_name,tagline,hero_text,contact_email FROM site_content WHERE id=1');
    res.json(r.rows[0]);
  } catch(e){next(e);}
});

app.post('/api/contact', contactLimiter, async (req,res,next)=>{
  try {
    const name=safeText(req.body.name,80), email=safeText(req.body.email,160).toLowerCase(), message=safeText(req.body.message,2000);
    if(!name || !validEmail(email) || !message) return res.status(400).json({error:'Informations de contact invalides.'});
    await pool.query('INSERT INTO contact_messages(name,email,message) VALUES($1,$2,$3)',[name,email,message]);
    res.status(201).json({message:'Votre demande a été enregistrée.'});
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
    const name=safeText(req.body.name,160),description=safeText(req.body.description,2000),currency=safeText(req.body.currency,3).toUpperCase(),price=Number(req.body.price_cents);
    if(!name||!Number.isInteger(price)||price<0||!/^[A-Z]{3}$/.test(currency)) return res.status(400).json({error:'Produit invalide.'});
    const r=await pool.query('INSERT INTO products(name,description,price_cents,currency) VALUES($1,$2,$3,$4) RETURNING *',[name,description,price,currency]);await audit(req,'create','product',r.rows[0].id); res.status(201).json(r.rows[0]);
  }catch(e){next(e);}
});

app.put('/api/admin/products/:id',auth,csrf,requireRole('admin','manager'),async(req,res,next)=>{
  try{
    const id=Number(req.params.id),name=safeText(req.body.name,160),description=safeText(req.body.description,2000),currency=safeText(req.body.currency,3).toUpperCase(),price=Number(req.body.price_cents),active=parseBoolean(req.body.active);
    if(!Number.isInteger(id)||!name||!Number.isInteger(price)||price<0||active===null||!/^[A-Z]{3}$/.test(currency)) return res.status(400).json({error:'Produit invalide.'});
    const r=await pool.query('UPDATE products SET name=$1,description=$2,price_cents=$3,currency=$4,active=$5,updated_at=NOW() WHERE id=$6 RETURNING *',[name,description,price,currency,active,id]);
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

app.get('/api/admin/messages',auth,requireRole('admin','editor'),async(req,res,next)=>{
  try{const r=await pool.query('SELECT id,name,email,message,created_at,handled FROM contact_messages ORDER BY created_at DESC LIMIT 200');res.json(r.rows);}catch(e){next(e);}
});

app.use(express.static('public',{extensions:['html'],dotfiles:'deny'}));
app.get('/admin',(req,res)=>res.sendFile('admin.html',{root:'public'}));
app.get('/connexion',(req,res)=>res.sendFile('connexion.html',{root:'public'}));
setInterval(()=>pool.query('DELETE FROM sessions WHERE expires_at<=NOW()').catch(()=>{}),60*60*1000).unref();

app.use((err,_req,res,_next)=>{
  console.error(err);
  res.status(500).json({error:'Une erreur interne est survenue.'});
});

const server=app.listen(port,()=>console.log(`NEXORA écoute sur le port ${port}`));
async function shutdown(){await pool.end();server.close(()=>process.exit(0));}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
