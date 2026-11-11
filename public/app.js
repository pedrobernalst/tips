// Interacciones del cliente: importes, comisión, copiar enlace y grabar NFC.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const eur = (c) => (c / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

  const form = $('#tipForm');
  if (form) {
    const fee = form.querySelector('[name=cover_fee]');
    const pct = Number(fee.dataset.pct), fixed = Number(fee.dataset.fixed);
    const update = () => {
      const p = form.querySelector('[name=preset]:checked')?.value;
      $('#customWrap').classList.toggle('hidden', p !== 'custom');
      const amt = p === 'custom' ? Math.round(parseFloat(form.custom.value.replace(',', '.')) * 100) || 0 : Number(p);
      const f = amt ? Math.round(amt * pct / 100) + fixed : 0;
      $('#feeTxt').textContent = eur(f);
      $('#payBtn').textContent = amt ? `Dejar ${eur(amt + (fee.checked ? f : 0))}` : 'Dejar propina';
    };
    form.addEventListener('input', update);
    form.addEventListener('submit', () => { $('#payBtn').disabled = true; $('#payBtn').textContent = 'Procesando…'; });
    update();
  }

  document.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) {
      const url = c.dataset.copy;
      if (navigator.share && matchMedia('(pointer:coarse)').matches) navigator.share({ title: 'Déjame propina', url }).catch(() => {});
      else { await navigator.clipboard.writeText(url); c.textContent = '¡Copiado!'; setTimeout(() => (c.textContent = 'Copiar enlace'), 1500); }
    }
    const n = e.target.closest('[data-nfc]');
    if (n) {
      const msg = $('#nfcMsg');
      if (!('NDEFReader' in window)) { msg.textContent = 'Este navegador no puede grabar NFC. Usa Chrome en Android, o NFC Tools en iPhone con tu enlace.'; return; }
      try {
        msg.textContent = 'Acerca la tarjeta NFC a la parte trasera del móvil…';
        await new NDEFReader().write({ records: [{ recordType: 'url', data: n.dataset.nfc }] });
        msg.textContent = '✅ Tarjeta grabada. ¡Ya puedes recibir propinas con un toque!';
      } catch (err) { msg.textContent = 'No se pudo grabar: ' + err.message; }
    }
  });
})();
