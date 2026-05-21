export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    const ctype = request.headers.get('content-type') || '';
    if (ctype.includes('application/json')) {
      data = await request.json();
    } else {
      const fd = await request.formData();
      data = Object.fromEntries(fd);
    }
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  if (data._honey) return json({ ok: true });

  const name = String(data.name || '').trim().slice(0, 100);
  const guests = parseInt(data.guests, 10) || 0;

  if (!name || guests < 1 || guests > 10) {
    return json({ error: 'missing or invalid fields' }, 400);
  }

  const ip = request.headers.get('cf-connecting-ip') || '';
  const ua = request.headers.get('user-agent') || '';

  try {
    await env.DB.prepare(
      'INSERT INTO rsvps (name, guests, ip, user_agent) VALUES (?, ?, ?, ?)'
    ).bind(name, guests, ip, ua).run();
  } catch {
    return json({ error: 'database error' }, 500);
  }

  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}
