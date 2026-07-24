import { put, list } from '@vercel/blob';

const API_KEY =
  process.env.TWITTERAPI_KEY ||
  'new1_b5fb91a3bf4f4b36807b97be5f36b076';

const FEED_KEY = 'brokescan-feed.json';
const MAX_TWEETS = 100;
const MAX_AGE_MS = 30 * 60 * 1000;

const QUERIES = [
  // Приоритетные — дублируем для частого выпадания
  'can i get sol',
  'can i get sol',
  'can i get some sol',
  'can i get some sol',
  'give me sol',
  'give me sol',
  'send me sol',
  'send me sol',

  // Остальные
  'need sol please',
  'pls send sol',
  'can someone send sol',
  'drop me some sol',
  'bless me sol',
  'how many likes for sol',
  'how many retweets for sol',
  'need some sol',
  'please send sol',
];

const BEG_STOPS = [
  'i bought',
  'i sold',
  'just bought',
  'just sold',
  'sol price',
  'sol hits',
  'pumping',
  'dumping',
  'bullish',
  'bearish',
  'buy signal',
  'sell signal',
  'sent you',
  'just sent',
  'giving away',
  'airdrop',
  'sol at ',
  'sol to $',
];

const BEG_PATTERNS = [
  /\bcan i get\b/i,
  /\bcan i have\b/i,
  /\bplease send\b/i,
  /\bpls send\b/i,
  /\bsend me\b/i,
  /\bgive me\b/i,
  /\bdrop me\b/i,
  /\bneed (some |a |)sol\b/i,
  /\bbless me\b/i,
  /\bbless my wallet\b/i,
  /\blikes?\s+for\s+(sol|solana)\b/i,
  /\bretweets?\s+for\s+(sol|solana)\b/i,
  /\bmy (sol |solana |)wallet\b/i,
  /\bcan someone (send|give|drop)\b/i,
  /\banyone (send|give|drop)\b/i,
  /\bspare\s+(some\s+)?(sol|solana)\b/i,
  /\bhow many (likes?|rts?|retweets?)\b/i,
];

function isBeg(text) {
  if (!text) return false;

  const lowerText = text.toLowerCase();

  if (!lowerText.includes('sol') && !lowerText.includes('solana')) {
    return false;
  }

  if (BEG_STOPS.some((keyword) => lowerText.includes(keyword))) {
    return false;
  }

  return BEG_PATTERNS.some((pattern) => pattern.test(text));
}

async function readFeed() {
  try {
    const { blobs } = await list({
      prefix: FEED_KEY,
      limit: 1,
    });

    if (!blobs.length) {
      return [];
    }

    // Публичный Blob читается через его URL
    const response = await fetch(blobs[0].url, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Blob read failed: ${response.status}`);
    }

    const data = await response.json();

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('readFeed:', error);
    return [];
  }
}

async function writeFeed(data) {
  try {
    await put(FEED_KEY, JSON.stringify(data), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
  } catch (error) {
    console.error('writeFeed:', error);
    throw error;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const secret =
    req.headers['x-cron-secret'] ||
    req.query.secret;

  const expectedSecret =
    process.env.CRON_SECRET ||
    'brokescan123';

  if (secret !== expectedSecret) {
    return res.status(401).json({
      error: 'unauthorized',
    });
  }

  try {
    const existing = await readFeed();
    const existingIds = new Set(
      existing.map((tweet) => String(tweet.tweet_id))
    );

    const now = Date.now();
    const newTweets = [];

    console.log('Fetching queries:', QUERIES);

    for (const query of QUERIES) {
      try {
        const url =
          'https://api.twitterapi.io/twitter/tweet/advanced_search' +
          '?query=' +
          encodeURIComponent(query) +
          '&queryType=Latest';

        const response = await fetch(url, {
          headers: {
            'X-API-Key': API_KEY,
          },
        });

        if (!response.ok) {
          console.error(
            'Twitter API:',
            response.status,
            await response.text()
          );
          continue;
        }

        const data = await response.json();

        const rawTweets =
          data.tweets ||
          data.timeline ||
          data.results ||
          [];

        const matchingTweets = rawTweets.filter((tweet) =>
          isBeg(tweet.text || tweet.full_text)
        );

        console.log(
          `"${query}" → ${rawTweets.length} tweets, ` +
          `isBeg: ${matchingTweets.length}`
        );

        for (const tweet of rawTweets) {
          const id = String(
            tweet.id ||
            tweet.tweet_id ||
            tweet.id_str ||
            ''
          );

          if (!id || existingIds.has(id)) {
            continue;
          }

          const author = tweet.author || tweet.user || {};
          const text = tweet.text || tweet.full_text || '';

          const createdAt =
            tweet.createdAt ||
            tweet.created_at ||
            tweet.creation_date ||
            '';

          const createdTimestamp = createdAt
            ? Date.parse(createdAt)
            : 0;

          if (
            createdTimestamp &&
            now - createdTimestamp > MAX_AGE_MS
          ) {
            continue;
          }

          if (!isBeg(text)) {
            continue;
          }

          newTweets.push({
            tweet_id: id,
            text,

            username:
              author.userName ||
              author.screen_name ||
              author.username ||
              tweet.username ||
              '',

            name:
              author.name ||
              tweet.name ||
              '',

            avatar: (
              author.profilePicture ||
              author.profile_image_url_https ||
              tweet.avatar ||
              ''
            ).replace('_normal.', '_bigger.'),

            favorites:
              tweet.likeCount ||
              tweet.favorite_count ||
              0,

            retweets:
              tweet.retweetCount ||
              tweet.retweet_count ||
              0,

            creation_date: createdAt,
            fetched_at: now,
          });

          existingIds.add(id);
        }
      } catch (error) {
        console.error(`Fetch error for "${query}":`, error);
      }
    }

    const added = newTweets.length;

    console.log(`Added ${added} new tweets`);

    let finalFeed = existing;

    if (added > 0) {
      finalFeed = [...newTweets, ...existing]
        .filter(
          (tweet) =>
            !tweet.fetched_at ||
            now - tweet.fetched_at < MAX_AGE_MS
        )
        .slice(0, MAX_TWEETS);

      await writeFeed(finalFeed);
    }

    return res.status(200).json({
      added,
      total: finalFeed.length,
    });
  } catch (error) {
    console.error('Handler failed:', error);

    return res.status(500).json({
      error: 'internal_error',
      message:
        error instanceof Error
          ? error.message
          : String(error),
    });
  }
}
