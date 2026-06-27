import { put, list, getDownloadUrl } from '@vercel/blob';

const API_KEY  = process.env.TWITTERAPI_KEY || 'new1_b5fb91a3bf4f4b36807b97be5f36b076';
const FEED_KEY = 'brokescan-feed.json';
const MAX_TWEETS = 100;
const MAX_AGE_MS = 5 * 60 * 1000;

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
];

const BEG_PATTERNS = [
  /\bcan i get\b/i, /\bcan i have\b/i, /\bplease send\b/i, /\bpls send\b/i,
  /\bsend me\b/i, /\bgive me\b/i, /\bdrop me\b/i, /\bneed (some |a |)sol\b/i,
  /\bbless me\b/i, /\bbless my wallet\b/i, /\blikes?\s+for\s+(sol|solana)\b/i,
  /\bretweets?\s+for\s+(sol|solana)\b/i, /\bmy (sol |solana |)wallet\b/i,
  /\bcan someone (send|give|drop)\b/i, /\banyone (send|give|drop)\b/i,
  /\bspare\s+(some\s+)?(sol|solana)\b/i,
  /\bhow many (likes?|rts?|retweets?)\b/i,
];

function isBeg(text) {
  if (!text) return false;
  const tl = text.toLowerCase();
  if (!tl.includes('sol') && !tl.includes('solana')) return false;
  if (BEG_STOPS.some(kw => tl.includes(kw))) return false;
  return BEG_PATTERNS.some(re => re.test(text));
}

async function readFeed() {
  try {
    const { blobs } = await list({ prefix: FEED_KEY });
    if (!blobs.length) return [];
    const r = await fetch(blobs[0].downloadUrl);
    if (!r.ok) return [];
    return await r.json();
  } catch (e) {
    console.error('readFeed error:', e.message);
    return [];
  }
}

async function writeFeed(data) {
  await put(FEED_KEY, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
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

  const picked = [...QUERIES].sort(() => 0.5 - Math.random()).slice(0, 3);

  for (const query of picked) {
    try {
      const url = 'https://api.twitterapi.io/twitter/tweet/advanced_search'
                + '?query=' + encodeURIComponent(query) + '&queryType=Latest';
      const r = await fetch(url, { headers: { 'X-API-Key': API_KEY } });
      if (!r.ok) {
        console.error('Twitter API error:', r.status, await r.text());
        continue;
      }
      const data = await r.json();
      const raw = data.tweets || data.timeline || data.results || [];
      console.log(`query "${query}" → ${raw.length} tweets`);

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
  if (added > 0) {
    const merged = [...newTweets, ...existing]
      .filter(t => !t.fetched_at || (now - t.fetched_at) < MAX_AGE_MS)
      .slice(0, MAX_TWEETS);
    await writeFeed(merged);
  }

  res.status(200).json({ added, total: existing.length + added });
}
