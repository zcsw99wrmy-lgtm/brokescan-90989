// /api/feed.js — хранит общую историю твитов в Vercel Blob
// GET  /api/feed   → возвращает последние 100 твитов
// POST /api/feed   → добавляет новые твиты { tweets: [...] }

import { put, head, getDownloadUrl } from '@vercel/blob';

const BLOB_KEY = 'brokescan-feed.json';
const MAX_TWEETS = 100;
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

async function readBlob() {
  try {
    // Ищем существующий blob по имени
    const url = `https://blob.vercel-storage.com/${BLOB_KEY}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
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
    const tweets = await readBlob();
    return res.status(200).json({ tweets });
  }

  if (req.method === 'POST') {
    const { tweets: newTweets } = req.body || {};
    if (!Array.isArray(newTweets) || !newTweets.length)
      return res.status(400).json({ error: 'tweets array required' });

    const existing = await readBlob();
    const existingIds = new Set(existing.map(t => t.tweet_id));
    const toAdd = newTweets.filter(t => t.tweet_id && !existingIds.has(t.tweet_id));
    if (!toAdd.length) return res.status(200).json({ added: 0 });

    const merged = [...toAdd, ...existing].slice(0, MAX_TWEETS);
    await writeBlob(merged);
    return res.status(200).json({ added: toAdd.length, total: merged.length });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
