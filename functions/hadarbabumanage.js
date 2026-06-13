// Admin dashboard for RSVPs + bus signups.
// Auth: ?key=<ADMIN_KEY> matching the ADMIN_KEY env var (set in
// Cloudflare Pages → Settings → Environment Variables).
// Routes:
//   GET  /hadarbabumanage?key=X                → tabbed HTML dashboard
//   GET  /hadarbabumanage?key=X&export=rsvps   → CSV of all RSVPs
//   GET  /hadarbabumanage?key=X&export=bus     → CSV of all bus signups
//   POST /hadarbabumanage  (form fields)       → mutate (update/delete)
//        body: action=update|delete, table=rsvps|bus_signups, id=N, key=X, <fields...>

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  if (!authorize(env, key)) return forbidden(env);

  const exportType = url.searchParams.get('export');
  if (exportType === 'rsvps') return exportRsvps(env);
  if (exportType === 'bus') return exportBus(env);
  return renderDashboard(env, key);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const fd = await request.formData();
  const key = String(fd.get('key') || '');
  if (!authorize(env, key)) return new Response('Forbidden', { status: 403 });

  const action = fd.get('action');
  const table = fd.get('table');
  const id = parseInt(fd.get('id'), 10);

  if (!Number.isInteger(id) || id < 1) return json({ error: 'bad id' }, 400);
  if (table !== 'rsvps' && table !== 'bus_signups') return json({ error: 'bad table' }, 400);

  try {
    if (action === 'delete') {
      const r = await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
      return json({ ok: true, changes: r.meta?.changes ?? 0 });
    }
    if (action === 'update') {
      if (table === 'rsvps') {
        const name = String(fd.get('name') || '').trim().slice(0, 100);
        const guests = parseInt(fd.get('guests'), 10);
        if (!name || !Number.isInteger(guests) || guests < 0 || guests > 100) {
          return json({ error: 'bad fields' }, 400);
        }
        await env.DB.prepare('UPDATE rsvps SET name = ?, guests = ? WHERE id = ?')
          .bind(name, guests, id).run();
      } else {
        const name = String(fd.get('name') || '').trim().slice(0, 100);
        const phone = String(fd.get('phone') || '').trim().slice(0, 30);
        const passengers = parseInt(fd.get('passengers'), 10);
        const pickup = String(fd.get('pickup') || '').trim().slice(0, 200);
        const notes = String(fd.get('notes') || '').trim().slice(0, 500);
        if (!name || !phone || !Number.isInteger(passengers) || passengers < 0 || passengers > 100) {
          return json({ error: 'bad fields' }, 400);
        }
        await env.DB.prepare('UPDATE bus_signups SET name = ?, phone = ?, passengers = ?, pickup = ?, notes = ? WHERE id = ?')
          .bind(name, phone, passengers, pickup, notes, id).run();
      }
      return json({ ok: true });
    }
  } catch (e) {
    return json({ error: 'db error', detail: String(e) }, 500);
  }
  return json({ error: 'bad action' }, 400);
}

function authorize(env, key) {
  const expected = env.ADMIN_KEY || '';
  if (!expected) return false;
  return safeEqual(key, expected);
}

function forbidden(env) {
  if (!env.ADMIN_KEY) {
    return new Response(
      'ADMIN_KEY env var is not configured. Set it in Cloudflare Pages → Settings → Environment Variables.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }
    );
  }
  return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain' } });
}

async function renderDashboard(env, key) {
  const [rsvpsRes, busRes, settingsRes] = await Promise.all([
    env.DB.prepare('SELECT id, name, guests, created_at FROM rsvps ORDER BY name COLLATE NOCASE ASC').all(),
    env.DB.prepare('SELECT id, name, phone, passengers, pickup, notes, created_at FROM bus_signups ORDER BY name COLLATE NOCASE ASC').all(),
    env.DB.prepare('SELECT key, value FROM settings').all(),
  ]);
  const rs = rsvpsRes.results || [];
  const bs = busRes.results || [];
  const settings = {};
  for (const row of (settingsRes.results || [])) settings[row.key] = row.value;
  const totalGuests = rs.reduce((s, r) => s + (r.guests || 0), 0);
  const totalPassengers = bs.reduce((s, r) => s + (r.passengers || 0), 0);
  const kq = encodeURIComponent(key);
  const savedGold = settings.color_gold || '#193a7f';
  const savedBg = settings.color_bg || '#faf6f1';
  const pickerVisible = settings.color_picker_visible !== '0';

  const rsvpRows = rs.length === 0
    ? `<tr><td colspan="4" class="empty">אין אישורי הגעה עדיין</td></tr>`
    : rs.map(r => `
      <tr data-table="rsvps" data-id="${r.id}">
        <td class="cell" data-field="name">${esc(r.name)}</td>
        <td class="cell num" data-field="guests">${r.guests}</td>
        <td class="ts">${esc(fmtDate(r.created_at))}</td>
        <td class="actions">
          <button class="btn-edit">ערוך</button>
          <button class="btn-del">מחק</button>
        </td>
      </tr>`).join('');

  const busRows = bs.length === 0
    ? `<tr><td colspan="7" class="empty">אין הרשמות להסעה עדיין</td></tr>`
    : bs.map(r => `
      <tr data-table="bus_signups" data-id="${r.id}">
        <td class="cell" data-field="name">${esc(r.name)}</td>
        <td class="cell ltr" data-field="phone" dir="ltr">${esc(r.phone)}</td>
        <td class="cell num" data-field="passengers">${r.passengers}</td>
        <td class="cell" data-field="pickup">${esc(r.pickup || '')}</td>
        <td class="cell" data-field="notes">${esc(r.notes || '')}</td>
        <td class="ts">${esc(fmtDate(r.created_at))}</td>
        <td class="actions">
          <button class="btn-edit">ערוך</button>
          <button class="btn-del">מחק</button>
        </td>
      </tr>`).join('');

  const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="robots" content="noindex, nofollow"/>
  <title>הרשמות - הדר ויהונתן</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: #faf6f1; color: #2a2a2a; }
    h1 { margin: 0 0 8px; color: #193a7f; }
    .subtitle { color: #666; margin-bottom: 20px; }
    .stats { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 22px; }
    .stat { padding: 10px 16px; background: #fff; border: 1px solid #193a7f; border-radius: 4px; min-width: 140px; }
    .stat .lbl { font-size: 0.82rem; color: #666; }
    .stat .val { font-size: 1.4rem; color: #193a7f; font-weight: 700; }
    .tabs { display: flex; gap: 6px; border-bottom: 2px solid #193a7f; }
    .tab-btn { padding: 10px 18px; background: #fff; border: 1px solid #193a7f; border-bottom: none; border-radius: 4px 4px 0 0; cursor: pointer; font-size: 1rem; font-family: inherit; color: #193a7f; }
    .tab-btn.active { background: #193a7f; color: #fff; }
    .panel { display: none; background: #fff; border: 1px solid #193a7f; border-top: none; padding: 16px; }
    .panel.active { display: block; }
    .panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px; }
    .panel-head h2 { margin: 0; font-size: 1.15rem; color: #193a7f; }
    .export-btn { display: inline-block; padding: 8px 14px; background: #193a7f; color: #fff; text-decoration: none; border-radius: 4px; font-size: 0.95rem; }
    .export-btn:hover { background: #11285a; }
    .table-wrap {
      position: relative;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      max-width: 100%;
      /* Always show a scrollbar so users see it can scroll */
      scrollbar-width: thin;
      scrollbar-color: #193a7f #eee9e0;
    }
    .table-wrap::-webkit-scrollbar { height: 10px; }
    .table-wrap::-webkit-scrollbar-track { background: #eee9e0; border-radius: 5px; }
    .table-wrap::-webkit-scrollbar-thumb { background: #193a7f; border-radius: 5px; }
    /* Right-edge fade as a visible cue when there's more content to scroll */
    .table-wrap::after {
      content: "";
      position: absolute;
      top: 0; bottom: 10px; left: 0;
      width: 40px;
      pointer-events: none;
      background: linear-gradient(to right, #fff, rgba(255,255,255,0));
      opacity: 0;
      transition: opacity 0.2s;
    }
    .table-wrap.has-scroll::after { opacity: 1; }
    .scroll-hint {
      display: none;
      font-size: 0.8rem;
      color: #193a7f;
      margin-bottom: 6px;
      font-weight: 700;
    }
    .scroll-hint.show { display: block; }
    table { width: 100%; min-width: 480px; border-collapse: collapse; font-size: 0.95rem; }
    th, td { border: 1px solid #e0d8ca; padding: 8px 10px; text-align: right; vertical-align: top; }
    th { background: #eee9e0; color: #193a7f; font-weight: 700; }
    tr:nth-child(even) td { background: #faf6f1; }
    tr.editing td { background: #fff8e1 !important; }
    tr.busy { opacity: 0.5; pointer-events: none; }
    td.ts { white-space: nowrap; color: #666; font-size: 0.85rem; }
    td.ltr { direction: ltr; text-align: left; }
    td.num { text-align: center; width: 80px; }
    td.actions { white-space: nowrap; width: 1%; }
    td.actions button { font-family: inherit; cursor: pointer; padding: 6px 10px; margin: 0 2px; border-radius: 3px; border: 1px solid #193a7f; background: #fff; color: #193a7f; font-size: 0.85rem; }
    td.actions button:hover { background: #193a7f; color: #fff; }
    td.actions .btn-del { border-color: #b03a2e; color: #b03a2e; }
    td.actions .btn-del:hover { background: #b03a2e; color: #fff; }
    td.actions .btn-save { border-color: #2e7d32; color: #2e7d32; }
    td.actions .btn-save:hover { background: #2e7d32; color: #fff; }
    td.cell input { width: 100%; padding: 6px 8px; border: 1px solid #193a7f; border-radius: 3px; font-family: inherit; font-size: 0.95rem; }
    .empty { text-align: center; color: #999; padding: 24px; }
    .error-banner { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); background: #b03a2e; color: #fff; padding: 10px 18px; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); z-index: 100; display: none; }
    .error-banner.show { display: block; }
    @media (max-width: 600px) {
      body { padding: 12px; }
      .panel { padding: 10px; }
      table { font-size: 0.85rem; min-width: 560px; }
      th, td { padding: 6px; }
      .stat { min-width: 110px; }
      td.actions { white-space: normal; min-width: 92px; }
      td.actions button { padding: 4px 6px; font-size: 0.8rem; margin: 2px; display: inline-block; }
    }
    /* Settings panel */
    .settings-section { margin-bottom: 28px; padding: 16px; background: #fff; border: 1px solid #d8d2c5; border-radius: 6px; }
    .settings-label { font-weight: 700; font-size: 0.95rem; color: #193a7f; margin-bottom: 12px; }
    .toggle-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .toggle-switch { position: relative; display: inline-block; width: 48px; height: 26px; flex-shrink: 0; }
    .toggle-switch input { opacity: 0; width: 0; height: 0; }
    .toggle-track { position: absolute; inset: 0; background: #ccc; border-radius: 13px; cursor: pointer; transition: background 0.2s; }
    .toggle-track::before { content: ''; position: absolute; width: 20px; height: 20px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform 0.2s; }
    .toggle-switch input:checked + .toggle-track { background: #193a7f; }
    .toggle-switch input:checked + .toggle-track::before { transform: translateX(22px); }
    .toggle-desc { font-size: 0.9rem; color: #444; }
    .color-row { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
    .color-preview-wrap { display: flex; align-items: center; gap: 10px; }
    .color-preview { width: 48px; height: 48px; border-radius: 6px; border: 1px solid #ccc; flex-shrink: 0; }
    .color-hex-display { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.95rem; color: #333; }
    .color-native { width: 48px; height: 40px; padding: 2px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; background: #fff; }
    .rgb-sliders { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
    .rgb-row { display: grid; grid-template-columns: 20px 1fr 56px; align-items: center; gap: 10px; }
    .rgb-label { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-weight: 700; font-size: 0.85rem; text-align: center; }
    .rgb-range { -webkit-appearance: none; appearance: none; width: 100%; height: 22px; background: transparent; cursor: pointer; }
    .rgb-range::-webkit-slider-runnable-track { height: 10px; border-radius: 5px; background: var(--track, #ddd); border: 1px solid rgba(0,0,0,0.1); }
    .rgb-range::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 2px solid #555; margin-top: -5px; box-shadow: 0 1px 3px rgba(0,0,0,0.2); cursor: pointer; }
    .rgb-range::-moz-range-track { height: 10px; border-radius: 5px; background: var(--track, #ddd); }
    .rgb-range::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 2px solid #555; }
    .rgb-num { width: 100%; padding: 5px 4px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.85rem; text-align: center; border: 1px solid #d8d2c5; border-radius: 4px; background: #fff; -moz-appearance: textfield; }
    .rgb-num::-webkit-outer-spin-button, .rgb-num::-webkit-inner-spin-button { -webkit-appearance: none; }
    .save-btn { padding: 9px 20px; background: #193a7f; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 0.95rem; font-weight: 700; }
    .save-btn:hover { background: #11285a; }
    .save-status { margin: 8px 0 0; font-size: 0.88rem; min-height: 1.2em; }
    .save-status.ok { color: #2e7d32; }
    .save-status.err { color: #b03a2e; }
  </style>
</head>
<body data-key="${esc(key)}">
  <h1>הרשמות</h1>
  <div class="subtitle">הדר ויהונתן · 04/09/2026</div>
  <div id="err" class="error-banner"></div>

  <div class="stats">
    <div class="stat"><div class="lbl">אישורי הגעה</div><div class="val">${rs.length}</div></div>
    <div class="stat"><div class="lbl">סה״כ אורחים</div><div class="val">${totalGuests}</div></div>
    <div class="stat"><div class="lbl">הרשמות להסעה</div><div class="val">${bs.length}</div></div>
    <div class="stat"><div class="lbl">סה״כ נוסעים</div><div class="val">${totalPassengers}</div></div>
  </div>

  <div class="tabs">
    <button class="tab-btn active" data-target="rsvps">אישורי הגעה (${rs.length})</button>
    <button class="tab-btn" data-target="bus">הסעות (${bs.length})</button>
    <button class="tab-btn" data-target="settings">הגדרות</button>
  </div>

  <div class="panel active" id="rsvps">
    <div class="panel-head">
      <h2>אישורי הגעה</h2>
      <a class="export-btn" href="?key=${kq}&amp;export=rsvps">⬇ ייצוא ל-Excel (CSV)</a>
    </div>
    <div class="scroll-hint">↔ גלול לצדדים לראיית עוד עמודות</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>שם</th><th>אורחים</th><th>תאריך הרשמה</th><th>פעולות</th></tr></thead>
        <tbody>${rsvpRows}</tbody>
      </table>
    </div>
  </div>

  <div class="panel" id="bus">
    <div class="panel-head">
      <h2>הרשמות להסעה</h2>
      <a class="export-btn" href="?key=${kq}&amp;export=bus">⬇ ייצוא ל-Excel (CSV)</a>
    </div>
    <div class="scroll-hint">↔ גלול לצדדים לראיית עוד עמודות</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>שם</th><th>טלפון</th><th>נוסעים</th><th>נקודת איסוף</th><th>הערות</th><th>תאריך הרשמה</th><th>פעולות</th></tr></thead>
        <tbody>${busRows}</tbody>
      </table>
    </div>
  </div>

  <div class="panel" id="settings">
    <h2 style="margin:0 0 18px;color:#193a7f;font-size:1.1rem;">הגדרות אתר</h2>

    <div class="settings-section">
      <div class="settings-label">נראות בורר הצבעים בדף הראשי</div>
      <div class="toggle-row">
        <label class="toggle-switch">
          <input type="checkbox" id="picker-visible-toggle" ${pickerVisible ? 'checked' : ''}/>
          <span class="toggle-track"></span>
        </label>
        <span id="picker-visible-label" class="toggle-desc">${pickerVisible ? 'מוצג' : 'מוסתר'}</span>
      </div>
      <button class="save-btn" id="save-visibility">שמור נראות</button>
      <p class="save-status" id="save-visibility-status"></p>
    </div>

    <div class="settings-section">
      <div class="settings-label">צבע ראשי (כפתורים, מסגרות)</div>
      <div class="color-row">
        <div class="color-preview-wrap">
          <div class="color-preview" id="admin-gold-preview" style="background:${esc(savedGold)}"></div>
          <span class="color-hex-display" id="admin-gold-hex">${esc(savedGold)}</span>
        </div>
        <input type="color" class="color-native" id="admin-gold-input" value="${esc(savedGold)}"/>
      </div>
      <div class="rgb-sliders">
        <div class="rgb-row"><span class="rgb-label">R</span><input type="range" class="rgb-range" id="adm-r" min="0" max="255"/><input type="number" class="rgb-num" id="adm-r-val" min="0" max="255"/></div>
        <div class="rgb-row"><span class="rgb-label">G</span><input type="range" class="rgb-range" id="adm-g" min="0" max="255"/><input type="number" class="rgb-num" id="adm-g-val" min="0" max="255"/></div>
        <div class="rgb-row"><span class="rgb-label">B</span><input type="range" class="rgb-range" id="adm-b" min="0" max="255"/><input type="number" class="rgb-num" id="adm-b-val" min="0" max="255"/></div>
      </div>
      <button class="save-btn" id="save-gold">שמור צבע ראשי</button>
      <p class="save-status" id="save-gold-status"></p>
    </div>

    <div class="settings-section">
      <div class="settings-label">צבע רקע</div>
      <div class="color-row">
        <div class="color-preview-wrap">
          <div class="color-preview" id="admin-bg-preview" style="background:${esc(savedBg)}"></div>
          <span class="color-hex-display" id="admin-bg-hex">${esc(savedBg)}</span>
        </div>
        <input type="color" class="color-native" id="admin-bg-input" value="${esc(savedBg)}"/>
      </div>
      <div class="rgb-sliders">
        <div class="rgb-row"><span class="rgb-label">R</span><input type="range" class="rgb-range" id="adm-br" min="0" max="255"/><input type="number" class="rgb-num" id="adm-br-val" min="0" max="255"/></div>
        <div class="rgb-row"><span class="rgb-label">G</span><input type="range" class="rgb-range" id="adm-bg" min="0" max="255"/><input type="number" class="rgb-num" id="adm-bg-val" min="0" max="255"/></div>
        <div class="rgb-row"><span class="rgb-label">B</span><input type="range" class="rgb-range" id="adm-bb" min="0" max="255"/><input type="number" class="rgb-num" id="adm-bb-val" min="0" max="255"/></div>
      </div>
      <button class="save-btn" id="save-bg">שמור צבע רקע</button>
      <p class="save-status" id="save-bg-status"></p>
    </div>
  </div>

  <script>
    const KEY = document.body.dataset.key;
    const FIELD_TYPES = {
      rsvps: { guests: 'number' },
      bus_signups: { passengers: 'number', phone: 'tel' }
    };

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === target));
      });
    });

    function showError(msg) {
      const el = document.getElementById('err');
      el.textContent = msg;
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 4000);
    }

    async function postAction(payload) {
      const fd = new FormData();
      fd.set('key', KEY);
      Object.entries(payload).forEach(([k, v]) => fd.set(k, String(v)));
      const res = await fetch(location.pathname, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || ('HTTP ' + res.status));
      }
      return data;
    }

    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const tr = btn.closest('tr[data-table]');
      if (!tr) return;
      const table = tr.dataset.table;
      const id = tr.dataset.id;

      if (btn.classList.contains('btn-del')) {
        if (!confirm('למחוק רשומה זו?')) return;
        tr.classList.add('busy');
        try {
          await postAction({ action: 'delete', table, id });
          tr.remove();
        } catch (err) {
          tr.classList.remove('busy');
          showError('מחיקה נכשלה: ' + err.message);
        }
        return;
      }

      if (btn.classList.contains('btn-edit')) {
        enterEditMode(tr, table);
        return;
      }

      if (btn.classList.contains('btn-cancel')) {
        exitEditMode(tr);
        return;
      }

      if (btn.classList.contains('btn-save')) {
        const payload = { action: 'update', table, id };
        let valid = true;
        tr.querySelectorAll('td.cell').forEach(td => {
          const field = td.dataset.field;
          const input = td.querySelector('input');
          if (!input) return;
          const val = input.value.trim();
          if (FIELD_TYPES[table]?.[field] === 'number' && !/^[0-9]+$/.test(val)) valid = false;
          if (field === 'name' && !val) valid = false;
          if (field === 'phone' && !val) valid = false;
          payload[field] = val;
        });
        if (!valid) { showError('שדה חובה ריק או לא חוקי'); return; }
        tr.classList.add('busy');
        try {
          await postAction(payload);
          // Reflect the saved values in the row
          tr.querySelectorAll('td.cell').forEach(td => {
            const input = td.querySelector('input');
            if (input) td.textContent = input.value.trim();
          });
          exitEditMode(tr);
        } catch (err) {
          tr.classList.remove('busy');
          showError('שמירה נכשלה: ' + err.message);
        }
      }
    });

    function enterEditMode(tr, table) {
      // Stash original text and swap cells for inputs
      tr.classList.add('editing');
      tr.querySelectorAll('td.cell').forEach(td => {
        const field = td.dataset.field;
        const orig = td.textContent;
        td.dataset.orig = orig;
        const type = FIELD_TYPES[table]?.[field] || 'text';
        const input = document.createElement('input');
        input.type = type;
        input.value = orig;
        if (type === 'number') { input.min = '0'; input.max = '100'; }
        td.textContent = '';
        td.appendChild(input);
      });
      // Swap action buttons
      const actions = tr.querySelector('td.actions');
      actions.innerHTML = '<button class="btn-save">שמור</button><button class="btn-cancel">בטל</button>';
      const first = tr.querySelector('td.cell input');
      if (first) first.focus();
    }

    function exitEditMode(tr) {
      tr.classList.remove('editing', 'busy');
      tr.querySelectorAll('td.cell').forEach(td => {
        if (td.dataset.orig !== undefined) {
          // textContent may already be the saved value if save succeeded — only restore if still has input
          const input = td.querySelector('input');
          if (input) td.textContent = td.dataset.orig;
          delete td.dataset.orig;
        }
      });
      const actions = tr.querySelector('td.actions');
      actions.innerHTML = '<button class="btn-edit">ערוך</button><button class="btn-del">מחק</button>';
    }

    // Reveal scroll affordance only when the table actually overflows.
    function updateScrollHints() {
      document.querySelectorAll('.table-wrap').forEach(w => {
        const overflowing = w.scrollWidth > w.clientWidth + 1;
        w.classList.toggle('has-scroll', overflowing);
        const hint = w.previousElementSibling;
        if (hint && hint.classList.contains('scroll-hint')) {
          hint.classList.toggle('show', overflowing);
        }
      });
    }
    updateScrollHints();
    window.addEventListener('resize', updateScrollHints);
    // Re-check after a tab becomes visible (panels are display:none until active)
    document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => setTimeout(updateScrollHints, 0)));

    // ─── Settings panel ───
    (function() {
      function clamp(n) { n = parseInt(n, 10); return isNaN(n) ? 0 : Math.max(0, Math.min(255, n)); }
      function h2(n) { return n.toString(16).padStart(2, '0'); }
      function toHex(r, g, b) { return '#' + h2(r) + h2(g) + h2(b); }
      function fromHex(hex) {
        return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
      }

      function setupAdminPicker(opts) {
        const native = document.getElementById(opts.nativeId);
        const preview = document.getElementById(opts.previewId);
        const hexDisp = document.getElementById(opts.hexId);
        const rS = document.getElementById(opts.rId);  const rN = document.getElementById(opts.rValId);
        const gS = document.getElementById(opts.gId);  const gN = document.getElementById(opts.gValId);
        const bS = document.getElementById(opts.bId);  const bN = document.getElementById(opts.bValId);
        if (!native) return;

        function apply(rv, gv, bv) {
          rv = clamp(rv); gv = clamp(gv); bv = clamp(bv);
          const hx = toHex(rv, gv, bv);
          native.value = hx;
          preview.style.background = hx;
          hexDisp.textContent = hx;
          if (document.activeElement !== rS) rS.value = rv;
          if (document.activeElement !== gS) gS.value = gv;
          if (document.activeElement !== bS) bS.value = bv;
          if (document.activeElement !== rN) rN.value = rv;
          if (document.activeElement !== gN) gN.value = gv;
          if (document.activeElement !== bN) bN.value = bv;
          rS.style.setProperty('--track', \`linear-gradient(to right,rgb(0,\${gv},\${bv}),rgb(255,\${gv},\${bv}))\`);
          gS.style.setProperty('--track', \`linear-gradient(to right,rgb(\${rv},0,\${bv}),rgb(\${rv},255,\${bv}))\`);
          bS.style.setProperty('--track', \`linear-gradient(to right,rgb(\${rv},\${gv},0),rgb(\${rv},\${gv},255))\`);
        }

        native.addEventListener('input', () => { const [r,g,b] = fromHex(native.value); apply(r,g,b); });
        [rS,gS,bS].forEach(s => s.addEventListener('input', () => apply(rS.value, gS.value, bS.value)));
        [rN,gN,bN].forEach(n => n.addEventListener('input', () => apply(rN.value, gN.value, bN.value)));

        const [r,g,b] = fromHex(native.value);
        apply(r, g, b);
      }

      setupAdminPicker({
        nativeId: 'admin-gold-input', previewId: 'admin-gold-preview', hexId: 'admin-gold-hex',
        rId: 'adm-r', rValId: 'adm-r-val', gId: 'adm-g', gValId: 'adm-g-val', bId: 'adm-b', bValId: 'adm-b-val',
      });
      setupAdminPicker({
        nativeId: 'admin-bg-input', previewId: 'admin-bg-preview', hexId: 'admin-bg-hex',
        rId: 'adm-br', rValId: 'adm-br-val', gId: 'adm-bg', gValId: 'adm-bg-val', bId: 'adm-bb', bValId: 'adm-bb-val',
      });

      async function saveSetting(settingKey, settingValue, statusId) {
        const statusEl = document.getElementById(statusId);
        statusEl.className = 'save-status';
        statusEl.textContent = 'שומר...';
        try {
          const fd = new FormData();
          fd.set('key', KEY);
          fd.set('setting_key', settingKey);
          fd.set('setting_value', settingValue);
          const res = await fetch('/settings', { method: 'POST', body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.ok) throw new Error(data.error || 'HTTP ' + res.status);
          statusEl.className = 'save-status ok';
          statusEl.textContent = 'נשמר ✓';
          setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'save-status'; }, 3000);
        } catch (err) {
          statusEl.className = 'save-status err';
          statusEl.textContent = 'שגיאה: ' + err.message;
        }
      }

      document.getElementById('save-gold').addEventListener('click', () => {
        saveSetting('color_gold', document.getElementById('admin-gold-input').value, 'save-gold-status');
      });
      document.getElementById('save-bg').addEventListener('click', () => {
        saveSetting('color_bg', document.getElementById('admin-bg-input').value, 'save-bg-status');
      });

      const toggle = document.getElementById('picker-visible-toggle');
      const toggleLabel = document.getElementById('picker-visible-label');
      toggle.addEventListener('change', () => {
        toggleLabel.textContent = toggle.checked ? 'מוצג' : 'מוסתר';
      });
      document.getElementById('save-visibility').addEventListener('click', () => {
        saveSetting('color_picker_visible', toggle.checked ? '1' : '0', 'save-visibility-status');
      });
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

async function exportRsvps(env) {
  const res = await env.DB.prepare(
    'SELECT name, guests, created_at FROM rsvps ORDER BY name COLLATE NOCASE ASC'
  ).all();
  const rows = res.results || [];
  const header = ['שם', 'אורחים', 'תאריך הרשמה'];
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([r.name, r.guests, r.created_at].map(csvCell).join(','));
  }
  return csvResponse(`rsvps-${todayStamp()}.csv`, lines.join('\r\n'));
}

async function exportBus(env) {
  const res = await env.DB.prepare(
    'SELECT name, phone, passengers, pickup, notes, created_at FROM bus_signups ORDER BY name COLLATE NOCASE ASC'
  ).all();
  const rows = res.results || [];
  const header = ['שם', 'טלפון', 'נוסעים', 'נקודת איסוף', 'הערות', 'תאריך הרשמה'];
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([r.name, r.phone, r.passengers, r.pickup || '', r.notes || '', r.created_at].map(csvCell).join(','));
  }
  return csvResponse(`bus-signups-${todayStamp()}.csv`, lines.join('\r\n'));
}

function csvResponse(filename, body) {
  // UTF-8 BOM so Excel detects the encoding and renders Hebrew correctly.
  return new Response('﻿' + body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function fmtDate(s) {
  if (!s) return '';
  return s.replace('T', ' ').slice(0, 16);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeEqual(a, b) {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
