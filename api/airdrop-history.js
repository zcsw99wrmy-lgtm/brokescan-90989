// api/airdrop-history.js
//
// Публичный GET-эндпоинт: отдаёт последние отправки для ленты на фронтенде.
// Запись в лог делает runRandomAirdrop() в api/airdrop-service.js — сюда
// ничего писать вручную не нужно, только читать.

import { put, list } from '@vercel/blob';

const LEGACY_HISTORY_KEY = 'brokescan-airdrop-history.json';
const HISTORY_PREFIX = 'brokescan-airdrop-history/';
const MAX_RECORDS = 200; // храним последние 200 отправок, старые обрезаем

function recordId(record) {
  return record.signature || `${record.handle || ''}:${record.sentAt || ''}`;
}

async function readLegacyHistory() {
  try {
    const { blobs } = await list({ prefix: LEGACY_HISTORY_KEY });
    if (!blobs.length) return [];
    const legacyBlob = blobs.find(blob => blob.pathname === LEGACY_HISTORY_KEY);
    if (!legacyBlob) return [];
    const r = await fetch(legacyBlob.downloadUrl);
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('readLegacyHistory error:', e.message);
    return [];
  }
}

async function readRecordBlob(blob) {
  try {
    const r = await fetch(blob.downloadUrl);
    if (!r.ok) return null;
    const data = await r.json();
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch (e) {
    console.error('readRecordBlob error:', e.message);
    return null;
  }
}

export async function readHistory() {
  try {
    // Имена новых файлов начинаются с обратного timestamp, поэтому list()
    // возвращает самые свежие записи первыми в лексикографическом порядке.
    const { blobs } = await list({ prefix: HISTORY_PREFIX, limit: MAX_RECORDS });
    const [newRecords, legacyRecords] = await Promise.all([
      Promise.all(blobs.map(readRecordBlob)),
      readLegacyHistory(),
    ]);

    // Старый общий JSON продолжаем читать, чтобы история не пропала после
    // перехода на безопасное хранение "одна транзакция — один файл".
    const merged = [...newRecords.filter(Boolean), ...legacyRecords];
    const unique = new Map();
    for (const record of merged) {
      const id = recordId(record);
      if (id && !unique.has(id)) unique.set(id, record);
    }

    return [...unique.values()]
      .sort((a, b) => Number(b.sentAt || 0) - Number(a.sentAt || 0))
      .slice(0, MAX_RECORDS);
  } catch (e) {
    console.error('readHistory error:', e.message);
    return readLegacyHistory();
  }
}

export async function appendHistoryRecord(record) {
  try {
    const sentAt = Number(record.sentAt) || Date.now();
    const entry = { ...record, sentAt };
    const signature = String(record.signature || `${record.handle || 'unknown'}-${sentAt}`)
      .replace(/[^a-zA-Z0-9_-]/g, '');

    // Vercel Blob сортирует pathname лексикографически. Обратный timestamp
    // делает новые выплаты первыми, а signature гарантирует уникальный файл.
    const reverseTime = String(Number.MAX_SAFE_INTEGER - sentAt).padStart(16, '0');
    const pathname = `${HISTORY_PREFIX}${reverseTime}-${signature}.json`;

    await put(pathname, JSON.stringify(entry), {
      access: 'public',
      addRandomSuffix: false,
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
