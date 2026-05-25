// Admin dashboard for RSVPs + bus signups.
// Auth: ?key=<ADMIN_KEY> matching the ADMIN_KEY env var (set in
// Cloudflare Pages → Settings → Environment Variables).
// Routes:
//   GET /hadarbabumanage?key=X                → tabbed HTML dashboard
//   GET /hadarbabumanage?key=X&export=rsvps   → CSV of all RSVPs
//   GET /hadarbabumanage?key=X&export=bus     → CSV of all bus signups

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  const expected = env.ADMIN_KEY || '';

  if (!expected) {
    return new Response(
      'ADMIN_KEY env var is not configured. Set it in Cloudflare Pages → Settings → Environment Variables.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }
    );
  }
  if (!safeEqual(key, expected)) {
    return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain' } });
  }

  const exportType = url.searchParams.get('export');
  if (exportType === 'rsvps') return exportRsvps(env);
  if (exportType === 'bus') return exportBus(env);

  return renderDashboard(env, key);
}

async function renderDashboard(env, key) {
  const [rsvpsRes, busRes] = await Promise.all([
    env.DB.prepare('SELECT id, name, guests, created_at FROM rsvps ORDER BY created_at DESC').all(),
    env.DB.prepare('SELECT id, name, phone, passengers, pickup, notes, created_at FROM bus_signups ORDER BY created_at DESC').all(),
  ]);
  const rs = rsvpsRes.results || [];
  const bs = busRes.results || [];
  const totalGuests = rs.reduce((s, r) => s + (r.guests || 0), 0);
  const totalPassengers = bs.reduce((s, r) => s + (r.passengers || 0), 0);
  const kq = encodeURIComponent(key);

  const rsvpRows = rs.length === 0
    ? `<tr><td colspan="3" class="empty">אין אישורי הגעה עדיין</td></tr>`
    : rs.map(r => `<tr><td>${esc(r.name)}</td><td>${r.guests}</td><td>${fmtDate(r.created_at)}</td></tr>`).join('');

  const busRows = bs.length === 0
    ? `<tr><td colspan="6" class="empty">אין הרשמות להסעה עדיין</td></tr>`
    : bs.map(r => `<tr><td>${esc(r.name)}</td><td dir="ltr">${esc(r.phone)}</td><td>${r.passengers}</td><td>${esc(r.pickup || '')}</td><td>${esc(r.notes || '')}</td><td>${fmtDate(r.created_at)}</td></tr>`).join('');

  const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
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
    .tabs { display: flex; gap: 6px; border-bottom: 2px solid #193a7f; margin-bottom: 0; }
    .tab-btn { padding: 10px 18px; background: #fff; border: 1px solid #193a7f; border-bottom: none; border-radius: 4px 4px 0 0; cursor: pointer; font-size: 1rem; font-family: inherit; color: #193a7f; }
    .tab-btn.active { background: #193a7f; color: #fff; }
    .panel { display: none; background: #fff; border: 1px solid #193a7f; border-top: none; padding: 16px; }
    .panel.active { display: block; }
    .panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px; }
    .panel-head h2 { margin: 0; font-size: 1.15rem; color: #193a7f; }
    .export-btn { display: inline-block; padding: 8px 14px; background: #193a7f; color: #fff; text-decoration: none; border-radius: 4px; font-size: 0.95rem; }
    .export-btn:hover { background: #11285a; }
    table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
    th, td { border: 1px solid #e0d8ca; padding: 8px 10px; text-align: right; vertical-align: top; }
    th { background: #eee9e0; color: #193a7f; font-weight: 700; }
    tr:nth-child(even) td { background: #faf6f1; }
    .empty { text-align: center; color: #999; padding: 24px; }
    @media (max-width: 600px) {
      body { padding: 12px; }
      table { font-size: 0.85rem; }
      th, td { padding: 6px; }
      .stat { min-width: 110px; }
    }
  </style>
</head>
<body>
  <h1>הרשמות</h1>
  <div class="subtitle">הדר ויהונתן · 04/09/2026</div>

  <div class="stats">
    <div class="stat"><div class="lbl">אישורי הגעה</div><div class="val">${rs.length}</div></div>
    <div class="stat"><div class="lbl">סה״כ אורחים</div><div class="val">${totalGuests}</div></div>
    <div class="stat"><div class="lbl">הרשמות להסעה</div><div class="val">${bs.length}</div></div>
    <div class="stat"><div class="lbl">סה״כ נוסעים</div><div class="val">${totalPassengers}</div></div>
  </div>

  <div class="tabs">
    <button class="tab-btn active" data-target="rsvps">אישורי הגעה (${rs.length})</button>
    <button class="tab-btn" data-target="bus">הסעות (${bs.length})</button>
  </div>

  <div class="panel active" id="rsvps">
    <div class="panel-head">
      <h2>אישורי הגעה</h2>
      <a class="export-btn" href="?key=${kq}&amp;export=rsvps">⬇ ייצוא ל-Excel (CSV)</a>
    </div>
    <table>
      <thead><tr><th>שם</th><th>אורחים</th><th>תאריך הרשמה</th></tr></thead>
      <tbody>${rsvpRows}</tbody>
    </table>
  </div>

  <div class="panel" id="bus">
    <div class="panel-head">
      <h2>הרשמות להסעה</h2>
      <a class="export-btn" href="?key=${kq}&amp;export=bus">⬇ ייצוא ל-Excel (CSV)</a>
    </div>
    <table>
      <thead><tr><th>שם</th><th>טלפון</th><th>נוסעים</th><th>נקודת איסוף</th><th>הערות</th><th>תאריך הרשמה</th></tr></thead>
      <tbody>${busRows}</tbody>
    </table>
  </div>

  <script>
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === target));
      });
    });
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
    'SELECT name, guests, created_at FROM rsvps ORDER BY created_at DESC'
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
    'SELECT name, phone, passengers, pickup, notes, created_at FROM bus_signups ORDER BY created_at DESC'
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
  // D1 stores datetime('now') as 'YYYY-MM-DD HH:MM:SS' (UTC)
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
