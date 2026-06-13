// GET /settings  — public, returns current site settings as JSON
// POST /settings — admin-keyed, saves key=value pairs
//   body: key=X, action=set, setting_key=<key>, setting_value=<value>

const ALLOWED_KEYS = ['color_gold', 'color_bg', 'color_picker_visible'];

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const res = await env.DB.prepare('SELECT key, value FROM settings').all();
    const map = {};
    for (const row of (res.results || [])) {
      map[row.key] = row.value;
    }
    return json(map);
  } catch {
    return json({});
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const fd = await request.formData();
  const key = String(fd.get('key') || '');
  if (!authorize(env, key)) return new Response('Forbidden', { status: 403 });

  const settingKey = String(fd.get('setting_key') || '');
  const settingValue = String(fd.get('setting_value') || '');

  if (!ALLOWED_KEYS.includes(settingKey)) {
    return json({ error: 'bad key' }, 400);
  }

  if (settingKey.startsWith('color_') && settingKey !== 'color_picker_visible' && !/^#[0-9a-fA-F]{6}$/.test(settingValue)) {
    return json({ error: 'invalid color' }, 400);
  }

  if (settingKey === 'color_picker_visible' && settingValue !== '0' && settingValue !== '1') {
    return json({ error: 'invalid value' }, 400);
  }

  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(settingKey, settingValue).run();

  return json({ ok: true });
}

function authorize(env, key) {
  const expected = env.ADMIN_KEY || '';
  if (!expected) return false;
  const ae = new TextEncoder().encode(key);
  const be = new TextEncoder().encode(expected);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
