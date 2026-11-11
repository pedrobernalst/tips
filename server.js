// Tap-Tap Tips — servidor principal.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const QRCode = require('qrcode');
const { tx, q, userBalance, poolBalance } = require('./db');
const V = require('./views');

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';      // sin clave => modo demo
const FEE_PCT = Number(process.env.FEE_PCT ?? 1.5);           // comisión de pago estimada (%)
const FEE_FIXED = Number(process.env.FEE_FIXED_CENTS ?? 25);  // + fijo en céntimos
const PRESETS = [200, 500, 1000];
const MIN_TIP = 100, MAX_TIP = 50000, MIN_WITHDRAW = 500;

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use((req, res, next) => { res.set({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }); next(); });

// ---------- utilidades ----------
const rid = (n = 16) => crypto.randomBytes(n).toString('base64url');
const hash = (pw, salt = rid(12)) => `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
const verify = (pw, stored) => {
  const [salt, h] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), crypto.scryptSync(pw, salt, 32));
};
const parseEuros = (s) => { const n = Math.round(parseFloat(String(s || '').replace(',', '.')) * 100); return Number.isFinite(n) ? n : NaN; };
const feeFor = (cents) => Math.round(cents * FEE_PCT / 100) + FEE_FIXED;
const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'local';
const cookie = (req, name) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1];

// ---------- sesión ----------
app.use((req, res, next) => {
  const tok = cookie(req, 'sid');
  if (tok) {
    const s = q('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?').get(tok, Date.now());
    if (s) req.user = s;
  }
  next();
});
function login(res, userId) {
  const token = rid(24);
  q('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, userId, Date.now() + 30 * 864e5);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: BASE_URL.startsWith('https'), maxAge: 30 * 864e5 });
}
const auth = (req, res, next) => (req.user ? next() : res.redirect('/login'));
// Protección CSRF básica: los POST autenticados deben venir de nuestro origen.
app.use((req, res, next) => {
  if (req.method !== 'POST' || !req.user) return next();
  const origin = req.get('origin') || req.get('referer') || '';
  if (origin && !origin.startsWith(BASE_URL) && !origin.startsWith(`${req.protocol}://${req.get('host')}`)) return res.status(403).send('Origen no válido');
  next();
});

// ---------- pagos ----------
async function stripe(method, pathname, params) {
  const r = await fetch(`https://api.stripe.com/v1/${pathname}`, {
    method, headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Error de Stripe');
  return j;
}

// Marca una propina como pagada y abona el neto (idempotente).
function markPaid(uid, providerRef) {
  return tx(() => {
    const t = q("SELECT * FROM tips WHERE uid=? AND status='pending'").get(uid);
    if (!t) return false;
    const net = t.covered_fee ? t.amount_cents : Math.max(0, t.amount_cents - t.fee_cents);
    q("UPDATE tips SET status='paid', paid_at=CURRENT_TIMESTAMP, provider_ref=COALESCE(?,provider_ref) WHERE id=?").run(providerRef ?? null, t.id);
    if (t.user_id) q("INSERT INTO ledger(user_id,amount_cents,kind,ref) VALUES(?,?,'tip',?)").run(t.user_id, net, t.uid);
    else q("INSERT INTO ledger(venue_id,amount_cents,kind,ref) VALUES(?,?,'pool_in',?)").run(t.venue_id, net, t.uid);
    return true;
  });
}

function tipTarget(tip) {
  if (tip.user_id) { const u = q('SELECT name,handle FROM users WHERE id=?').get(tip.user_id); return { name: u.name, back: `/t/${u.handle}` }; }
  const v = q('SELECT name,slug FROM venues WHERE id=?').get(tip.venue_id); return { name: `Equipo de ${v.name}`, back: `/v/${v.slug}` };
}

async function createTip(req, res, target, isVenue) {
  const b = req.body;
  const amount = b.preset === 'custom' ? parseEuros(b.custom) : Number(b.preset);
  const render = (msg) => res.status(400).send(V.tipPage({ target: isVenue ? { name: `Equipo de ${target.name}` } : target, isVenue, presets: PRESETS, feeInfo: { pct: FEE_PCT, fixed: FEE_FIXED }, msg, demoMode: !STRIPE_KEY }));
  if (!Number.isInteger(amount) || amount < MIN_TIP || amount > MAX_TIP) return render(`La propina debe estar entre ${V.eur(MIN_TIP)} y ${V.eur(MAX_TIP)}.`);
  const rating = Number(b.rating);
  const tip = {
    uid: rid(12), fee: feeFor(amount), covered: b.cover_fee ? 1 : 0,
    rating: rating >= 1 && rating <= 5 ? rating : null,
  };
  q(`INSERT INTO tips(uid,user_id,venue_id,amount_cents,fee_cents,covered_fee,payer_name,message,rating,provider)
     VALUES(?,?,?,?,?,?,?,?,?,?)`).run(tip.uid, isVenue ? null : target.id, isVenue ? target.id : null, amount, tip.fee, tip.covered,
    String(b.payer_name || '').slice(0, 40), String(b.message || '').slice(0, 200), tip.rating, STRIPE_KEY ? 'stripe' : 'demo');

  if (!STRIPE_KEY) return res.redirect(303, `/pago/${tip.uid}`);
  try {
    const charge = amount + (tip.covered ? tip.fee : 0);
    const s = await stripe('POST', 'checkout/sessions', {
      mode: 'payment', 'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': 'eur',
      'line_items[0][price_data][unit_amount]': charge,
      'line_items[0][price_data][product_data][name]': `Propina para ${isVenue ? 'el equipo de ' + target.name : target.name}`,
      client_reference_id: tip.uid, 'metadata[tip_uid]': tip.uid,
      success_url: `${BASE_URL}/pago/${tip.uid}/ok?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}${isVenue ? '/v/' + target.slug + '/bote' : '/t/' + target.handle}`,
    });
    q('UPDATE tips SET provider_ref=? WHERE uid=?').run(s.id, tip.uid);
    res.redirect(303, s.url);
  } catch (e) { console.error(e); render('No se pudo iniciar el pago. Inténtalo de nuevo.'); }
}

// ---------- rutas públicas ----------
app.get('/', (req, res) => res.send(V.landing(req.user)));
app.get('/registro', (req, res) => res.send(V.authForm('registro')));
app.get('/login', (req, res) => res.send(V.authForm('login')));

app.post('/registro', (req, res) => {
  const { name = '', email = '', password = '', title = '' } = req.body;
  const handle = String(req.body.handle || '').toLowerCase().trim();
  const fail = (m) => res.status(400).send(V.authForm('registro', m, req.body));
  if (!/^[a-z0-9-]{3,30}$/.test(handle)) return fail('El enlace debe tener 3-30 caracteres: minúsculas, números o guiones.');
  if (['admin', 'panel', 'api', 'www'].includes(handle)) return fail('Ese enlace está reservado.');
  if (password.length < 8) return fail('La contraseña debe tener al menos 8 caracteres.');
  if (!name.trim()) return fail('Indica tu nombre.');
  if (q('SELECT 1 FROM users WHERE handle=?').get(handle)) return fail('Ese enlace ya está en uso.');
  if (q('SELECT 1 FROM users WHERE email=?').get(email.toLowerCase())) return fail('Ya existe una cuenta con ese email.');
  const r = q('INSERT INTO users(email,pass,name,handle,title) VALUES(?,?,?,?,?)').run(email.toLowerCase().trim(), hash(password), name.trim().slice(0, 60), handle, title.slice(0, 60));
  login(res, r.lastInsertRowid);
  res.redirect(303, '/panel');
});

app.post('/login', (req, res) => {
  const u = q('SELECT * FROM users WHERE email=?').get(String(req.body.email || '').toLowerCase().trim());
  if (!u || !verify(String(req.body.password || ''), u.pass)) return res.status(401).send(V.authForm('login', 'Email o contraseña incorrectos.', req.body));
  login(res, u.id);
  res.redirect(303, '/panel');
});

app.post('/logout', (req, res) => {
  const tok = cookie(req, 'sid');
  if (tok) q('DELETE FROM sessions WHERE token=?').run(tok);
  res.clearCookie('sid');
  res.redirect(303, '/');
});

// Página de propina de una persona (la que abre el NFC/QR).
app.get('/t/:handle', (req, res) => {
  const u = q('SELECT id,name,handle,title,bio,color FROM users WHERE handle=?').get(req.params.handle.toLowerCase());
  if (!u) return res.status(404).send(V.notFound());
  res.send(V.tipPage({ target: u, isVenue: false, presets: PRESETS, feeInfo: { pct: FEE_PCT, fixed: FEE_FIXED }, demoMode: !STRIPE_KEY }));
});
app.post('/t/:handle', async (req, res) => {
  const u = q('SELECT id,name,handle,title,bio,color FROM users WHERE handle=?').get(req.params.handle.toLowerCase());
  if (!u) return res.status(404).send(V.notFound());
  await createTip(req, res, u, false);
});

// Local: elegir a quién dar propina o al bote común.
app.get('/v/:slug', (req, res) => {
  const v = q('SELECT * FROM venues WHERE slug=?').get(req.params.slug);
  if (!v) return res.status(404).send(V.notFound());
  const members = q('SELECT u.name,u.handle,u.title,u.color FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.venue_id=? ORDER BY u.name').all(v.id);
  res.send(V.venuePage(v, members));
});
app.get('/v/:slug/bote', (req, res) => {
  const v = q('SELECT * FROM venues WHERE slug=?').get(req.params.slug);
  if (!v) return res.status(404).send(V.notFound());
  res.send(V.tipPage({ target: { name: `Equipo de ${v.name}` }, isVenue: true, presets: PRESETS, feeInfo: { pct: FEE_PCT, fixed: FEE_FIXED }, demoMode: !STRIPE_KEY }));
});
app.post('/v/:slug/bote', async (req, res) => {
  const v = q('SELECT * FROM venues WHERE slug=?').get(req.params.slug);
  if (!v) return res.status(404).send(V.notFound());
  await createTip(req, res, v, true);
});

// Pasarela de demostración (sólo sin STRIPE_SECRET_KEY).
app.get('/pago/:uid', (req, res) => {
  const t = q('SELECT * FROM tips WHERE uid=?').get(req.params.uid);
  if (!t) return res.status(404).send(V.notFound());
  if (t.status !== 'pending' || t.provider !== 'demo') return res.redirect(`/gracias/${t.uid}`);
  res.send(V.demoCheckout(t, tipTarget(t).name));
});
app.post('/pago/:uid/demo', (req, res) => {
  const t = q("SELECT * FROM tips WHERE uid=? AND provider='demo'").get(req.params.uid);
  if (!t || STRIPE_KEY) return res.status(404).send(V.notFound());
  markPaid(t.uid, 'demo_' + rid(6));
  res.redirect(303, `/gracias/${t.uid}`);
});
app.post('/pago/:uid/cancelar', (req, res) => {
  const t = q("SELECT * FROM tips WHERE uid=? AND status='pending'").get(req.params.uid);
  if (!t) return res.redirect('/');
  q("UPDATE tips SET status='cancelled' WHERE id=?").run(t.id);
  res.redirect(303, tipTarget(t).back);
});
// Vuelta desde Stripe Checkout: verificamos con Stripe antes de abonar.
app.get('/pago/:uid/ok', async (req, res) => {
  const t = q('SELECT * FROM tips WHERE uid=?').get(req.params.uid);
  if (!t) return res.status(404).send(V.notFound());
  if (t.status === 'pending' && STRIPE_KEY && t.provider_ref) {
    try {
      const s = await stripe('GET', `checkout/sessions/${encodeURIComponent(t.provider_ref)}`);
      if (s.payment_status === 'paid' && s.client_reference_id === t.uid) markPaid(t.uid, s.payment_intent);
    } catch (e) { console.error(e); }
  }
  res.redirect(`/gracias/${t.uid}`);
});
// Webhook de Stripe (respaldo por si el cliente cierra antes de volver).
app.post('/webhooks/stripe', express.raw({ type: '*/*' }), (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.sendStatus(404);
  const sig = String(req.get('stripe-signature') || '');
  const parts = Object.fromEntries(sig.split(',').map((p) => p.split('=')));
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${req.body}`).digest('hex');
  if (!parts.v1 || parts.v1.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected))
      || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return res.sendStatus(400);
  const ev = JSON.parse(req.body);
  if (ev.type === 'checkout.session.completed' && ev.data.object.payment_status === 'paid') {
    markPaid(ev.data.object.client_reference_id, ev.data.object.payment_intent);
  }
  res.sendStatus(200);
});
app.get('/gracias/:uid', (req, res) => {
  const t = q('SELECT * FROM tips WHERE uid=?').get(req.params.uid);
  if (!t) return res.status(404).send(V.notFound());
  const tg = tipTarget(t);
  res.send(V.thanks(t, tg.name, tg.back));
});

// ---------- panel ----------
const qrFor = (url, opts = {}) => QRCode.toDataURL(url, { margin: 1, width: 480, color: { dark: '#1e1b4b' }, ...opts });

app.get('/panel', auth, async (req, res) => {
  const u = req.user;
  const tipUrl = `${BASE_URL}/t/${u.handle}`;
  const agg = (since) => q(`SELECT COALESCE(SUM(amount_cents),0) s FROM ledger WHERE user_id=? AND kind IN ('tip','pool_share') AND created_at>=datetime('now',?)`).get(u.id, since).s;
  const r = q("SELECT AVG(rating) a, COUNT(*) c FROM tips WHERE user_id=? AND status='paid'").get(u.id);
  const tips = q(`SELECT t.*, CASE WHEN t.covered_fee THEN t.amount_cents ELSE t.amount_cents-t.fee_cents END net, NULL venue_name
                  FROM tips t WHERE t.user_id=? AND t.status='paid' ORDER BY t.paid_at DESC LIMIT 15`).all(u.id);
  const venues = q(`SELECT v.*, (SELECT COUNT(*) FROM memberships WHERE venue_id=v.id) members FROM venues v
                    JOIN memberships m ON m.venue_id=v.id WHERE m.user_id=? ORDER BY v.name`).all(u.id).map((v) => ({ ...v, pool: poolBalance(v.id) }));
  res.send(V.dashboard({
    user: u, tips, venues, tipUrl, base: BASE_URL, balance: userBalance(u.id),
    stats: { today: agg('start of day'), week: agg('-7 days'), month: agg('start of month'), rating: r.a, count: r.c },
    withdrawals: q('SELECT * FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 5').all(u.id),
    qrDataUrl: await qrFor(tipUrl), msg: req.query.e, ok: req.query.ok,
  }));
});
const back = (res, key, m) => res.redirect(303, `/panel?${key}=${encodeURIComponent(m)}`);

app.get('/panel/qr.png', auth, async (req, res) => {
  res.type('png').send(await QRCode.toBuffer(`${BASE_URL}/t/${req.user.handle}`, { margin: 2, width: 1024 }));
});
app.get('/panel/tarjeta', auth, async (req, res) => {
  const url = `${BASE_URL}/t/${req.user.handle}`;
  res.send(V.printCard(req.user, await qrFor(url), url));
});

app.post('/panel/perfil', auth, (req, res) => {
  const { name = '', title = '', bio = '', color = '#7c3aed' } = req.body;
  if (!name.trim()) return back(res, 'e', 'El nombre no puede estar vacío.');
  const goal = req.body.goal ? parseEuros(req.body.goal) : 0;
  q('UPDATE users SET name=?, title=?, bio=?, color=?, goal_cents=? WHERE id=?').run(name.trim().slice(0, 60), title.slice(0, 60), bio.slice(0, 160),
    /^#[0-9a-f]{6}$/i.test(color) ? color : '#7c3aed', Number.isInteger(goal) && goal > 0 ? goal : 0, req.user.id);
  back(res, 'ok', 'Perfil guardado.');
});

app.post('/panel/retirar', auth, (req, res) => {
  const amount = parseEuros(req.body.amount);
  const iban = String(req.body.iban || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return back(res, 'e', 'IBAN no válido.');
  if (!Number.isInteger(amount) || amount < MIN_WITHDRAW) return back(res, 'e', `La retirada mínima es ${V.eur(MIN_WITHDRAW)}.`);
  const ok = tx(() => {
    if (amount > userBalance(req.user.id)) return false;
    const w = q('INSERT INTO withdrawals(user_id,amount_cents,iban) VALUES(?,?,?)').run(req.user.id, amount, iban);
    q("INSERT INTO ledger(user_id,amount_cents,kind,ref) VALUES(?,?,'withdrawal',?)").run(req.user.id, -amount, `w${w.lastInsertRowid}`);
    return true;
  });
  ok ? back(res, 'ok', `Retirada de ${V.eur(amount)} solicitada.`) : back(res, 'e', 'Saldo insuficiente.');
});

app.post('/panel/locales', auth, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) return back(res, 'e', 'Indica el nombre del local.');
  let slug = slugify(name);
  while (q('SELECT 1 FROM venues WHERE slug=?').get(slug)) slug = `${slugify(name)}-${rid(2).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
  tx(() => {
    const v = q('INSERT INTO venues(owner_id,name,slug,join_code) VALUES(?,?,?,?)').run(req.user.id, name, slug, crypto.randomBytes(4).toString('hex').toUpperCase());
    q('INSERT INTO memberships(venue_id,user_id) VALUES(?,?)').run(v.lastInsertRowid, req.user.id);
  });
  back(res, 'ok', `Local "${name}" creado. Comparte el código de equipo con tus compañeros.`);
});
app.post('/panel/locales/unirse', auth, (req, res) => {
  const v = q('SELECT * FROM venues WHERE join_code=?').get(String(req.body.code || '').trim().toUpperCase());
  if (!v) return back(res, 'e', 'Código no válido.');
  q('INSERT OR IGNORE INTO memberships(venue_id,user_id) VALUES(?,?)').run(v.id, req.user.id);
  back(res, 'ok', `Te has unido a ${v.name}.`);
});
// Reparto del bote a partes iguales entre el equipo; los céntimos sobrantes quedan en el bote.
app.post('/panel/locales/:id/repartir', auth, (req, res) => {
  const v = q('SELECT * FROM venues WHERE id=? AND owner_id=?').get(Number(req.params.id), req.user.id);
  if (!v) return back(res, 'e', 'Sólo el responsable del local puede repartir el bote.');
  const result = tx(() => {
    const pool = poolBalance(v.id);
    const members = q('SELECT user_id FROM memberships WHERE venue_id=?').all(v.id);
    const share = Math.floor(pool / members.length);
    if (share <= 0) return null;
    const ref = `pool${v.id}-${Date.now()}`;
    for (const m of members) q("INSERT INTO ledger(user_id,amount_cents,kind,ref) VALUES(?,?,'pool_share',?)").run(m.user_id, share, ref);
    q("INSERT INTO ledger(venue_id,amount_cents,kind,ref) VALUES(?,?,'pool_out',?)").run(v.id, -share * members.length, ref);
    return { share, n: members.length };
  });
  result ? back(res, 'ok', `Bote repartido: ${V.eur(result.share)} para cada una de las ${result.n} personas.`) : back(res, 'e', 'No hay bote suficiente para repartir.');
});

app.use((req, res) => res.status(404).send(V.notFound()));
app.use((err, req, res, next) => { console.error(err); res.status(500).send('Error interno'); });

// Usuario de demostración para /t/demo.
if (!q("SELECT 1 FROM users WHERE handle='demo'").get()) {
  q('INSERT INTO users(email,pass,name,handle,title,bio) VALUES(?,?,?,?,?,?)').run('demo@taptap.local', hash(rid()), 'Lucía García', 'demo', 'Camarera · Bar La Plaza', '¡Gracias por venir! Cada propina cuenta 💜');
}

app.listen(PORT, () => console.log(`Tap-Tap Tips en ${BASE_URL} (${STRIPE_KEY ? 'Stripe' : 'modo demo'})`));
