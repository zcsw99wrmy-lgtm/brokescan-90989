// /api/leaderboard.js — хранит лидерборд в Vercel Blob
// GET  /api/leaderboard  → возвращает всех участников
// POST /api/leaderboard  → обновляет/добавляет участника

import { put } from '@vercel/blob';

const BLOB_KEY = 'brokescan-leaderboard.json';
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

async function readBlob() {
  try {
    const url = `https://blob.vercel-storage.com/${BLOB_KEY}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) return {};
    return await r.json();
  } catch { return {}; }
}

async function writeBlob(data) {
  await put(BLOB_KEY, JSON.stringify(data), {
    access: 'public',
    token: TOKEN,
    addRandomSuffix: false,
    contentType: 'application/json',
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const lb = await readBlob();
    return res.status(200).json({ leaderboard: lb });
  }

  if (req.method === 'POST') {
    const entry = req.body;
    if (!entry?.handle) return res.status(400).json({ error: 'handle required' });

    const lb = await readBlob();
    const ex = lb[entry.handle];
    lb[entry.handle] = {
      name:       entry.name   || ex?.name   || entry.handle,
      handle:     entry.handle,
      avatar:     entry.avatar || ex?.avatar || '',
      wallet:     entry.wallet || ex?.wallet || null,
      tweetCount: (ex?.tweetCount || 0) + 1,
      daily:      entry.daily   ?? ex?.daily  ?? null,
      weekly:     entry.weekly  ?? ex?.weekly ?? null,
      monthly:    entry.monthly ?? ex?.monthly ?? null,
      firstSeen:  ex?.firstSeen || Date.now(),
      lastSeen:   Date.now(),
    };

    await writeBlob(lb);
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
