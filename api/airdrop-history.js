// api/airdrop-history.js
//
// Публичный GET-эндпоинт: отдаёт последние отправки для ленты на фронтенде.
// Запись в лог делает runRandomAirdrop() в api/airdrop-service.js — сюда
// ничего писать вручную не нужно, только читать.

import { put, list } from '@vercel/blob';

const HISTORY_KEY = 'brokescan-airdrop-history.json';
const MAX_RECORDS = 200; // храним последние 200 отправок, старые обрезаем

export async function readHistory() {
  try {
    const { blobs } = await list({ prefix: HISTORY_KEY });
    if (!blobs.length) return [];
    const r = await fetch(blobs[0].downloadUrl);
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('readHistory error:', e.message);
    return [];
  }
}

export async function appendHistoryRecord(record) {
  try {
    const history = await readHistory();
    history.unshift({ ...record, sentAt: Date.now() }); // новые сверху
    const trimmed = history.slice(0, MAX_RECORDS);
    await put(HISTORY_KEY, JSON.stringify(trimmed), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
  } catch (e) {
    // История — не критичный путь: если запись лога не удалась,
    // это не должно ронять уже отправленную транзакцию.
    console.error('appendHistoryRecord error:', e.message);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const limit = Math.min(parseInt(req.query?.limit, 10) || 20, MAX_RECORDS);
    const history = await readHistory();
    return res.status(200).json({ history: history.slice(0, limit) });
  } catch (e) {
    console.error('airdrop-history handler error:', e.message);
    return res.status(500).json({ error: 'internal_error' });
  }
}
