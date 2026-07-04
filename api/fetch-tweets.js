import { put, list, get } from '@vercel/blob';
const API_KEY    = process.env.TWITTERAPI_KEY || 'new1_4a0be9b5a0714182bd02038ebef458b5';
const FEED_KEY   = 'brokescan-feed.json';
const MAX_TWEETS = 100;
const MAX_AGE_MS = 30 * 60 * 1000;
const QUERIES = [
  'can i get sol', 'can i get some sol', 'send me sol please',
  'need sol please', 'give me sol', 'pls send sol',
  'can someone send sol', 'drop me some sol', 'bless me sol',
  'likes for sol', 'how many likes for sol',
];
const BEG_STOPS = [
  'i bought','i sold','just bought','just sold','sol price','sol hits',
  'pumping','dumping','bullish','bearish','buy signal','sell signal',
  'sent you','just sent','giving away','airdrop','sol at ','sol to $',
  'church','disciple','woke up','checked my feed','brushing','humble',
  'calling the bottom','crypto is','rich or','coping','half of crypto',
  'moves faster','ex leaving',
];
const BEG_PATTERNS = [
  /\bcan i get\b/i, /\bcan i have\b/i, /\bplease send\b/i, /\bpls send\b/i,
  /\bsend me\b/i, /\bgive me\b/i, /\bdrop me\b/i, /\bneed (some |a |)sol\b/i,
  /\bbless me\b/i, /\bbless my wallet\b/i, /\blikes?\s+for\s+(sol|solana)\b/i,
  /\bretweets?\s+for\s+(sol|solana)\b/i, /\bmy (sol |solana |)wallet\b/i,
  /\bcan someone (send|give|drop)\b/i, /\banyone (send|give|drop)\b/i,
  /\bspare\s+(some\s+)?(sol|solana)\b/i, /\bhow many (likes?|rts?|retweets?)\b/i,
];
function isBeg(text) {
  if (!text) return false;
  const tl = text.toLowerCase();
  if (!tl.includes('sol') && !tl.includes('solana')) return false;
  if (BEG_STOPS.some(kw => tl.includes(kw))) return false;
  // Должен быть хотя бы один паттерн просьбы
  if (!BEG_PATTERNS.some(re => re.test(text))) return false;
  // Дополнительная проверка — текст должен быть коротким или содержать адрес кошелька
  // Длинные философские твиты без адреса — не попрошайничество
  const hasWallet = /[1-9A-HJ-NP-Za-km-z]{32,44}/.test(text);
  const isShort = text.length < 200;
  return hasWallet || isShort;
}
async function readFeed() {
  try {
    const { blobs } = await list({ prefix: FEED_KEY });
    if (!blobs.length) return [];
    const result = await get(blobs[0].pathname, { access: 'public' });
    if (!result || !result.stream) return [];
    const text = await new Response(result.stream).text();
    return JSON.parse(text);
  } catch (e) {
    console.error('readFeed:', e.message);
    return [];
  }
}
async function writeFeed(data) {
  await put(FEED_KEY, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== (process.env.CRON_SECRET || 'brokescan123')) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const existing = await readFeed();
  const existingIds = new Set(existing.map(t => t.tweet_id));
  const now = Date.now();
  const newTweets = [];
  const picked = [...QUERIES].sort(() => 0.5 - Math.random()).slice(0, 2);
  console.log('Fetching queries:', picked);
  for (let i = 0; i < picked.length; i++) {
    const query = picked[i];
    if (i > 0) await sleep(5500); // free-tier: не больше 1 запроса в 5 секунд
    try {
      const url = 'https://api.twitterapi.io/twitter/tweet/advanced_search'
                + '?query=' + encodeURIComponent(query) + '&queryType=Latest';
      const r = await fetch(url, { headers: { 'X-API-Key': API_KEY } });
      if (!r.ok) {
        console.error('Twitter API:', r.status, await r.text());
        continue;
      }
      const data = await r.json();
      const raw = data.tweets || data.timeline || data.results || [];
      console.log(`"${query}" → ${raw.length} tweets, isBeg: ${raw.filter(t => isBeg(t.text || t.full_text)).length}`);
      for (const t of raw) {
        const id = String(t.id || t.tweet_id || t.id_str || '');
        if (!id || existingIds.has(id)) continue;
        const a = t.author || t.user || {};
        const text = t.text || t.full_text || '';
        const createdAt = t.createdAt || t.created_at || t.creation_date || '';
        const ts = createdAt ? Date.parse(createdAt) : 0;
        if (ts && (now - ts) > MAX_AGE_MS) continue;
        if (!isBeg(text)) continue;
        newTweets.push({
          tweet_id:      id,
          text,
          username:      a.userName || a.screen_name || a.username || t.username || '',
          name:          a.name || t.name || '',
          avatar:        (a.profilePicture || a.profile_image_url_https || t.avatar || '').replace('_normal.', '_bigger.'),
          favorites:     t.likeCount   || t.favorite_count || 0,
          retweets:      t.retweetCount || t.retweet_count  || 0,
          creation_date: createdAt,
          fetched_at:    now,
        });
        existingIds.add(id);
      }
    } catch (e) {
      console.error('fetch error:', e.message);
    }
  }
  const added = newTweets.length;
  console.log(`Added ${added} new tweets`);
  if (added > 0) {
    const merged = [...newTweets, ...existing]
      .filter(t => !t.fetched_at || (now - t.fetched_at) < MAX_AGE_MS)
      .slice(0, MAX_TWEETS);
    await writeFeed(merged);
  }
  res.status(200).json({ added, total: existing.length + added });
}
