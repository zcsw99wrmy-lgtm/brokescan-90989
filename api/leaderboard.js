import { put, list } from '@vercel/blob';
const LB_KEY = 'brokescan-leaderboard.json';

function normalizeIdentity(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\uFE0F/g, '')
    .replace(/^@/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function selectedId(entry, key = '') {
  if (!entry || typeof entry !== 'object') return null;
  const values = [
    normalizeIdentity(entry.name),
    normalizeIdentity(entry.handle),
    normalizeIdentity(key),
  ];
  if (
    values.includes(normalizeIdentity('🟢Vina🍪')) ||
    values.includes(normalizeIdentity('@worldofvina'))
  ) {
    return 'vina';
  }

  if (
    values.includes(normalizeIdentity('Joey')) ||
    values.includes(normalizeIdentity('@Joeyekpe001'))
  ) {
    return 'joey';
  }

  return null;
}

function keepOnlySelected(data) {
  const selected = new Map();
  for (const [key, entry] of Object.entries(data || {})) {
    const id = selectedId(entry, key);
    if (!id) continue;
    const previous = selected.get(id);
    if (!previous || Number(entry.lastSeen || 0) >= Number(previous.entry.lastSeen || 0)) {
      selected.set(id, { key, entry });
    }
  }

  return Object.fromEntries(
    [...selected.values()].map(({ key, entry }) => [entry.handle || key, entry])
  );
}

async function readLbRaw() {
  try {
    const { blobs } = await list({ prefix: LB_KEY });
    if (!blobs.length) return {};
    const r = await fetch(blobs[0].downloadUrl);
    if (!r.ok) return {};
    const data = await r.json();
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  } catch (e) {
    console.error('readLb error:', e.message);
    return {};
  }
}

async function writeLbRaw(data) {
  await put(LB_KEY, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

// Фильтр постоянный: при каждом чтении удаляем из Blob всех,
// кроме Joey и Vina, и возвращаем только этих двух участников.
export async function readLb() {
  const current = await readLbRaw();
  const selected = keepOnlySelected(current);

  if (
    Object.keys(selected).length !==
    Object.keys(current).length
  ) {
    await writeLbRaw(selected);
  }

  return selected;
}

export async function writeLb(data) {
  await writeLbRaw(keepOnlySelected(data));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const lb = await readLb();
      const valid = Object.fromEntries(
        Object.entries(lb).filter(([, v]) => v && typeof v === 'object')
      );
      return res.status(200).json({ leaderboard: valid });
    }
    if (req.method === 'POST') {
      const entry = req.body;
      if (!entry?.handle) return res.status(400).json({ error: 'handle required' });

      // Не добавляем в лидерборд никого, кроме Joey и Vina.
      if (!selectedId(entry, entry.handle)) {
        return res.status(200).json({
          ok: true,
          ignored: true,
        });
      }

      const lb = await readLb();
      const ex = lb[entry.handle];
      const exSafe = (ex && typeof ex === 'object') ? ex : {};
      lb[entry.handle] = {
        name:       entry.name   || exSafe.name   || entry.handle,
        handle:     entry.handle,
        avatar:     entry.avatar || exSafe.avatar || '',
        wallet:     entry.wallet || exSafe.wallet || null,
        tweetCount: (exSafe.tweetCount || 0) + 1,
        daily:      entry.daily   ?? exSafe.daily  ?? null,
        weekly:     entry.weekly  ?? exSafe.weekly ?? null,
        monthly:    entry.monthly ?? exSafe.monthly ?? null,
        firstSeen:  exSafe.firstSeen || Date.now(),
        lastSeen:   Date.now(),
      };
      await writeLb(lb);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('leaderboard handler error:', e.message, e.stack);
    return res.status(500).json({ error: 'internal_error', message: String(e.message || e) });
  }
}
