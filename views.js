// Plantillas HTML. Todo lo que viene del usuario pasa por esc().
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (c) => (c / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const initials = (n) => esc(String(n).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase());
const stars = (r) => (r ? '★'.repeat(r) + '☆'.repeat(5 - r) : '');
const when = (iso) => new Date(iso.replace(' ', 'T') + 'Z').toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function layout(title, body, { user, bare } = {}) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#7c3aed">
<title>${esc(title)} · Tap-Tap Tips</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/style.css"></head><body>
${bare ? '' : `<header class="top"><a class="logo" href="/"><span class="dot">●●</span> Tap-Tap Tips</a>
<nav>${user ? `<a href="/panel">Mi panel</a><form method="post" action="/logout" class="inline"><button class="link">Salir</button></form>`
    : `<a href="/login">Entrar</a><a class="btn sm" href="/registro">Crear cuenta</a>`}</nav></header>`}
<main>${body}</main>
<script src="/app.js"></script></body></html>`;
}

const flash = (msg, kind = 'err') => (msg ? `<div class="flash ${kind}">${esc(msg)}</div>` : '');

const landing = (user) => layout('Propinas digitales', `
<section class="hero">
  <h1>Propinas en dos toques.</h1>
  <p class="lead">Tu cliente acerca el móvil a tu tarjeta NFC o escanea tu QR, elige cantidad y paga con Apple Pay, Google Pay o tarjeta. Sin apps, sin efectivo, sin esperas.</p>
  <div class="row"><a class="btn" href="${user ? '/panel' : '/registro'}">${user ? 'Ir a mi panel' : 'Empieza gratis'}</a><a class="btn ghost" href="/t/demo">Ver una página de propinas</a></div>
</section>
<section class="steps">
  <div class="card"><b>1 · Tap</b><p>El cliente toca tu tarjeta NFC o escanea el QR de la mesa, la barra o tu placa.</p></div>
  <div class="card"><b>2 · Tap</b><p>Elige 2 €, 5 €, 10 € o la cantidad que quiera, deja una valoración y paga.</p></div>
  <div class="card"><b>3 · Cobras</b><p>La propina entra en tu saldo al instante. Retira a tu cuenta cuando quieras.</p></div>
</section>
<section class="steps">
  <div class="card"><b>Para cada persona</b><p>Página propia con tu nombre, tu QR y tu enlace NFC. Las propinas son tuyas.</p></div>
  <div class="card"><b>Para el local</b><p>Crea tu local, invita al equipo con un código y recibe propinas a un bote común que se reparte a partes iguales.</p></div>
  <div class="card"><b>Transparente</b><p>El cliente puede cubrir la comisión de pago para que llegue el 100 % de la propina.</p></div>
</section>`, { user });

const authForm = (mode, msg, v = {}) => layout(mode === 'login' ? 'Entrar' : 'Crear cuenta', `
<section class="narrow card">
  <h2>${mode === 'login' ? 'Entrar' : 'Crea tu página de propinas'}</h2>${flash(msg)}
  <form method="post" class="stack">
    ${mode === 'registro' ? `
    <label>Nombre<input name="name" required maxlength="60" value="${esc(v.name)}" placeholder="Lucía García"></label>
    <label>Tu enlace<div class="prefix"><span>/t/</span><input name="handle" required pattern="[a-z0-9-]{3,30}" maxlength="30" value="${esc(v.handle)}" placeholder="lucia"></div><small>Minúsculas, números y guiones.</small></label>
    <label>Puesto (opcional)<input name="title" maxlength="60" value="${esc(v.title)}" placeholder="Camarera · Bar La Plaza"></label>` : ''}
    <label>Email<input type="email" name="email" required value="${esc(v.email)}"></label>
    <label>Contraseña<input type="password" name="password" required minlength="8"></label>
    <button class="btn">${mode === 'login' ? 'Entrar' : 'Crear cuenta'}</button>
  </form>
  <p class="muted">${mode === 'login' ? '¿No tienes cuenta? <a href="/registro">Regístrate</a>' : '¿Ya tienes cuenta? <a href="/login">Entra</a>'}</p>
</section>`);

// Página pública donde el cliente deja la propina (persona o bote del local).
function tipPage({ target, isVenue, presets, feeInfo, msg, demoMode }) {
  const name = target.name;
  return layout(`Propina para ${name}`, `
<section class="tip">
  <div class="avatar" style="background:${esc(target.color || '#7c3aed')}">${isVenue ? '🍽️' : initials(name)}</div>
  <h1>${esc(name)}</h1>
  ${target.title ? `<p class="muted">${esc(target.title)}</p>` : ''}
  ${target.bio ? `<p>${esc(target.bio)}</p>` : ''}
  ${isVenue ? '<p class="muted">Bote común: se reparte entre todo el equipo.</p>' : ''}
  ${flash(msg)}
  <form method="post" class="stack" id="tipForm">
    <div class="amounts">
      ${presets.map((p, i) => `<label class="amt"><input type="radio" name="preset" value="${p}" ${i === 1 ? 'checked' : ''}><span>${eur(p)}</span></label>`).join('')}
      <label class="amt"><input type="radio" name="preset" value="custom"><span>Otra</span></label>
    </div>
    <label class="custom hidden" id="customWrap">Cantidad (€)<input name="custom" inputmode="decimal" placeholder="7,50"></label>
    <div class="rating" aria-label="Valoración">${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="rating" id="r${n}" value="${n}"><label for="r${n}" title="${n}">★</label>`).join('')}</div>
    <input name="payer_name" maxlength="40" placeholder="Tu nombre (opcional)">
    <textarea name="message" maxlength="200" rows="2" placeholder="Deja un mensaje (opcional)"></textarea>
    <label class="check"><input type="checkbox" name="cover_fee" checked data-pct="${feeInfo.pct}" data-fixed="${feeInfo.fixed}"><span>Añadir la comisión de pago (<b id="feeTxt"></b>) para que llegue el 100 %</span></label>
    <button class="btn big" id="payBtn">Dejar propina</button>
    <p class="muted center">${demoMode ? '🧪 Modo demo: no se realiza ningún cargo real.' : '🔒 Pago seguro con Stripe · Apple Pay · Google Pay · Tarjeta'}</p>
  </form>
</section>`, { bare: true });
}

const demoCheckout = (tip, targetName) => layout('Pago', `
<section class="narrow card">
  <p class="muted">Pasarela de pago de demostración</p>
  <h2>${eur(tip.amount_cents + (tip.covered_fee ? tip.fee_cents : 0))}</h2>
  <p>Propina para <b>${esc(targetName)}</b></p>
  <form method="post" action="/pago/${esc(tip.uid)}/demo" class="stack">
    <label>Tarjeta<input value="4242 4242 4242 4242" readonly></label>
    <div class="row"><input value="12/30" readonly><input value="123" readonly></div>
    <button class="btn big">Pagar</button>
  </form>
  <form method="post" action="/pago/${esc(tip.uid)}/cancelar"><button class="link">Cancelar</button></form>
</section>`, { bare: true });

const thanks = (tip, targetName, backUrl) => layout('¡Gracias!', `
<section class="tip">
  <div class="big-emoji">🎉</div>
  <h1>¡Gracias!</h1>
  <p>Tu propina de <b>${eur(tip.amount_cents)}</b> para <b>${esc(targetName)}</b> ${tip.status === 'paid' ? 'ha llegado.' : 'está pendiente de confirmación.'}</p>
  <a class="btn ghost" href="${esc(backUrl)}">Volver</a>
</section>`, { bare: true });

function dashboard({ user, stats, tips, balance, venues, withdrawals, tipUrl, qrDataUrl, msg, ok, base }) {
  return layout('Mi panel', `
${flash(msg)}${flash(ok, 'ok')}
<section class="grid4">
  <div class="card stat"><small>Saldo disponible</small><b>${eur(balance)}</b></div>
  <div class="card stat"><small>Hoy</small><b>${eur(stats.today)}</b></div>
  <div class="card stat"><small>Últimos 7 días</small><b>${eur(stats.week)}</b></div>
  <div class="card stat"><small>Valoración media</small><b>${stats.rating ? stats.rating.toFixed(1) + ' ★' : '—'}</b><small>${stats.count} propinas</small></div>
</section>
${user.goal_cents ? `<section class="card"><small>Objetivo del mes: ${eur(stats.month)} de ${eur(user.goal_cents)}</small><div class="bar"><span style="width:${Math.min(100, (stats.month / user.goal_cents) * 100).toFixed(0)}%"></span></div></section>` : ''}
<section class="grid2">
  <div class="card center">
    <h3>Tu QR y enlace NFC</h3>
    <img class="qr" src="${qrDataUrl}" alt="Código QR">
    <p><code id="tipUrl">${esc(tipUrl)}</code></p>
    <div class="row wrap center">
      <button class="btn sm" data-copy="${esc(tipUrl)}">Copiar enlace</button>
      <button class="btn sm" data-nfc="${esc(tipUrl)}">Grabar en tarjeta NFC</button>
      <a class="btn sm ghost" href="/panel/tarjeta" target="_blank">Imprimir tarjeta</a>
      <a class="btn sm ghost" href="/panel/qr.png" download="taptap-${esc(user.handle)}.png">Descargar QR</a>
    </div>
    <p class="muted" id="nfcMsg">La grabación NFC funciona en Chrome para Android. En iPhone usa una app como NFC Tools con este enlace.</p>
  </div>
  <div class="card">
    <h3>Últimas propinas</h3>
    ${tips.length ? `<ul class="feed">${tips.map((t) => `<li><div><b>${eur(t.net)}</b> ${t.venue_name ? `<span class="tag">bote ${esc(t.venue_name)}</span>` : ''}<small>${when(t.paid_at)}${t.payer_name ? ' · ' + esc(t.payer_name) : ''}</small></div>
      <div class="r">${stars(t.rating)}</div>${t.message ? `<p class="msg">“${esc(t.message)}”</p>` : ''}</li>`).join('')}</ul>`
      : '<p class="muted">Aún no hay propinas. ¡Comparte tu QR!</p>'}
  </div>
</section>
<section class="grid2">
  <div class="card">
    <h3>Retirar saldo</h3>
    <form method="post" action="/panel/retirar" class="stack">
      <label>Cantidad (€)<input name="amount" inputmode="decimal" required placeholder="${(balance / 100).toFixed(2).replace('.', ',')}"></label>
      <label>IBAN<input name="iban" required placeholder="ES00 0000 0000 0000 0000 0000"></label>
      <button class="btn" ${balance < 500 ? 'disabled' : ''}>Solicitar retirada</button>
      <small class="muted">Mínimo 5,00 €.</small>
    </form>
    ${withdrawals.length ? `<ul class="feed">${withdrawals.map((w) => `<li><div><b>${eur(w.amount_cents)}</b><small>${when(w.created_at)} · ${esc(w.iban.slice(-4).padStart(8, '•'))}</small></div><span class="tag">${esc(w.status)}</span></li>`).join('')}</ul>` : ''}
  </div>
  <div class="card">
    <h3>Mi perfil</h3>
    <form method="post" action="/panel/perfil" class="stack">
      <label>Nombre<input name="name" maxlength="60" required value="${esc(user.name)}"></label>
      <label>Puesto<input name="title" maxlength="60" value="${esc(user.title)}"></label>
      <label>Mensaje para tus clientes<textarea name="bio" maxlength="160" rows="2">${esc(user.bio)}</textarea></label>
      <div class="row"><label>Color<input type="color" name="color" value="${esc(user.color)}"></label>
      <label>Objetivo mensual (€)<input name="goal" inputmode="decimal" value="${user.goal_cents ? (user.goal_cents / 100).toString().replace('.', ',') : ''}"></label></div>
      <button class="btn">Guardar</button>
    </form>
  </div>
</section>
<section class="card">
  <h3>Mis locales y botes</h3>
  ${venues.map((v) => `<div class="venue">
    <div><b>${esc(v.name)}</b> ${v.owner_id === user.id ? '<span class="tag">responsable</span>' : ''}
    <small class="muted">${v.members} personas · Bote: <b>${eur(v.pool)}</b> · <a href="/v/${esc(v.slug)}" target="_blank">${esc(base)}/v/${esc(v.slug)}</a></small></div>
    ${v.owner_id === user.id ? `<div class="row wrap"><span class="tag">Código de equipo: <b>${esc(v.join_code)}</b></span>
      <form method="post" action="/panel/locales/${v.id}/repartir" class="inline"><button class="btn sm" ${v.pool <= 0 ? 'disabled' : ''}>Repartir bote</button></form></div>` : ''}
  </div>`).join('') || '<p class="muted">No perteneces a ningún local.</p>'}
  <div class="grid2">
    <form method="post" action="/panel/locales" class="row"><input name="name" required maxlength="60" placeholder="Nombre del local"><button class="btn sm">Crear local</button></form>
    <form method="post" action="/panel/locales/unirse" class="row"><input name="code" required maxlength="12" placeholder="Código de equipo"><button class="btn sm ghost">Unirme</button></form>
  </div>
</section>`, { user });
}

const venuePage = (venue, members) => layout(venue.name, `
<section class="tip">
  <div class="avatar">🍽️</div>
  <h1>${esc(venue.name)}</h1>
  <p class="muted">¿A quién quieres dejar propina?</p>
  <a class="btn big" href="/v/${esc(venue.slug)}/bote">Bote común del equipo</a>
  <div class="people">${members.map((m) => `<a class="person" href="/t/${esc(m.handle)}"><span class="avatar sm" style="background:${esc(m.color)}">${initials(m.name)}</span><span><b>${esc(m.name)}</b><small>${esc(m.title)}</small></span></a>`).join('')}</div>
</section>`, { bare: true });

const printCard = (user, qrDataUrl, tipUrl) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Tarjeta</title><link rel="stylesheet" href="/style.css"></head>
<body class="print"><div class="pcard"><div class="logo"><span class="dot">●●</span> Tap-Tap Tips</div>
<img src="${qrDataUrl}" alt="QR"><h2>${esc(user.name)}</h2><p>${esc(user.title)}</p>
<p class="muted">Escanea o acerca tu móvil para dejar propina</p><small>${esc(tipUrl)}</small></div>
<script>window.onload=()=>window.print()</script></body></html>`;

const notFound = () => layout('No encontrado', '<section class="narrow card center"><h2>No encontrado</h2><p>Este enlace no existe.</p><a class="btn" href="/">Inicio</a></section>');

module.exports = { landing, authForm, tipPage, demoCheckout, thanks, dashboard, venuePage, printCard, notFound, eur };
