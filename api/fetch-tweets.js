import { put, list } from '@vercel/blob';

const API_KEY =
  process.env.TWITTERAPI_KEY ||
  'new1_b5fb91ab97be5f36b076';

const FEED_KEY = 'brokescan-feed.json';

const MAX_TWEETS = 100;

// Показывать твиты не старше 30 минут
const MAX_AGE_MS = 30 * 60 * 1000;

// Максимальное число одновременных запросов к Twitter API
const CONCURRENCY = 5;

const QUERIES = [
  'can i get sol',
  'can i get some sol',
  'can i have sol',
  'give me sol',
  'send me sol',
  'need sol please',
  'pls send sol',
  'can someone send sol',
  'drop me some sol',
  'bless me with sol',
  'bless my wallet with sol',
  'how many likes for sol',
  'how many retweets for sol',
  'need some sol',
  'please send sol',
  'spare some sol',
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
  'casino',
  'jackpot',
  'one shot',
  'game',
  'gaming',
];

const BEG_PATTERNS = [
  /\bcan i (?:get|have)(?: some| any| a little)? (?:sol|solana)\b/i,

  /\bcan someone (?:send|give|drop) me(?: some| any)? (?:sol|solana)\b/i,

  /\b(?:anyone|somebody) (?:send|give|drop) me(?: some| any)? (?:sol|solana)\b/i,

  /\b(?:please|pls) send me(?: some| any)? (?:sol|solana)\b/i,

  /\b(?:please|pls) send(?: some| any)? (?:sol|solana)\b/i,

  /\bsend me(?: some| any)? (?:sol|solana)\b/i,

  /\bgive me(?: some| any)? (?:sol|solana)\b/i,

  /\bdrop me(?: some| any)? (?:sol|solana)\b/i,

  /\bi need(?: some| any| a little)? (?:sol|solana)\b/i,

  /\bneed(?: some| any| a little)? (?:sol|solana)(?: please| pls)?\b/i,

  /\bspare(?: me)?(?: some| any)? (?:sol|solana)\b/i,

  /\bbless me with(?: some| any)? (?:sol|solana)\b/i,

  /\bbless my wallet(?: with)?(?: some| any)? (?:sol|solana)\b/i,

  /\bhow many (?:likes?|rts?|retweets?) for (?:sol|solana)\b/i,

  /\b(?:likes?|rts?|retweets?) for (?:sol|solana)\b/i,
];

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\$sol\b/g, 'sol')
    .replace(/\$solana\b/g, 'solana')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBeg(text) {
  if (!text) {
    return false;
  }

  const normalized = normalizeText(text);

  if (
    !normalized.includes('sol') &&
    !normalized.includes('solana')
  ) {
    return false;
  }

  if (
    BEG_STOPS.some((keyword) =>
      normalized.includes(keyword)
    )
  ) {
    return false;
  }

  return BEG_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  );
}

function getTweetTimestamp(tweet) {
  const createdAt =
    tweet.creation_date ||
    tweet.createdAt ||
    tweet.created_at ||
    '';

  if (!createdAt) {
    return 0;
  }

  const timestamp = Date.parse(createdAt);

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isTweetFresh(tweet, now) {
  const timestamp = getTweetTimestamp(tweet);

  if (!timestamp) {
    return true;
  }

  return now - timestamp < MAX_AGE_MS;
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

    // Добавляем параметр, чтобы не получить старую кешированную версию.
    const blobUrl = new URL(blobs[0].url);

    blobUrl.searchParams.set(
      'v',
      String(Date.now())
    );

    const response = await fetch(blobUrl.toString(), {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Blob read failed: ${response.status}`
      );
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
    await put(
      FEED_KEY,
      JSON.stringify(data),
      {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      }
    );
  } catch (error) {
    console.error('writeFeed:', error);
    throw error;
  }
}

async function fetchQuery(query) {
  const url =
    'https://api.twitterapi.io/twitter/tweet/advanced_search' +
    '?query=' +
    encodeURIComponent(query) +
    '&queryType=Latest';

  try {
    const response = await fetch(url, {
      headers: {
        'X-API-Key': API_KEY,
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const body = await response.text();

      console.error(
        `Twitter API "${query}":`,
        response.status,
        body
      );

      return [];
    }

    const data = await response.json();

    const tweets =
      data.tweets ||
      data.timeline ||
      data.results ||
      [];

    const matching = tweets.filter((tweet) =>
      isBeg(tweet.text || tweet.full_text)
    );

    console.log(
      `"${query}" → ${tweets.length} tweets, ` +
      `isBeg: ${matching.length}`
    );

    return tweets;
  } catch (error) {
    console.error(
      `Fetch error for "${query}":`,
      error instanceof Error
        ? error.message
        : String(error)
    );

    return [];
  }
}

async function fetchInBatches(queries, batchSize) {
  const results = [];

  for (
    let index = 0;
    index < queries.length;
    index += batchSize
  ) {
    const batch = queries.slice(
      index,
      index + batchSize
    );

    const batchResults = await Promise.allSettled(
      batch.map((query) => fetchQuery(query))
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(...result.value);
      } else {
        console.error(
          'Query rejected:',
          result.reason
        );
      }
    }
  }

  return results;
}

function convertTweet(tweet, now) {
  const id = String(
    tweet.id ||
    tweet.tweet_id ||
    tweet.id_str ||
    ''
  );

  const author =
    tweet.author ||
    tweet.user ||
    {};

  const text =
    tweet.text ||
    tweet.full_text ||
    '';

  const createdAt =
    tweet.createdAt ||
    tweet.created_at ||
    tweet.creation_date ||
    '';

  return {
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
  };
}

export default async function handler(req, res) {
  res.setHeader(
    'Access-Control-Allow-Origin',
    '*'
  );

  res.setHeader(
    'Cache-Control',
    'no-store, max-age=0'
  );

  const authorization =
    req.headers.authorization || '';

  const bearerSecret =
    authorization.startsWith('Bearer ')
      ? authorization.slice(7)
      : '';

  const receivedSecret =
    bearerSecret ||
    req.headers['x-cron-secret'] ||
    req.query.secret;

  const expectedSecret =
    process.env.CRON_SECRET ||
    'brokescan123';

  if (receivedSecret !== expectedSecret) {
    return res.status(401).json({
      error: 'unauthorized',
    });
  }

  try {
    const now = Date.now();

    const storedFeed = await readFeed();

    // Удаляем старые и ошибочно добавленные твиты.
    const existing = storedFeed
      .filter((tweet) => isTweetFresh(tweet, now))
      .filter((tweet) => isBeg(tweet.text))
      .slice(0, MAX_TWEETS);

    const existingIds = new Set(
      existing.map((tweet) =>
        String(tweet.tweet_id)
      )
    );

    console.log(
      `Fetching ${QUERIES.length} unique queries`
    );

    const rawTweets = await fetchInBatches(
      QUERIES,
      CONCURRENCY
    );

    const newTweets = [];

    for (const rawTweet of rawTweets) {
      const converted = convertTweet(
        rawTweet,
        now
      );

      if (
        !converted.tweet_id ||
        existingIds.has(converted.tweet_id)
      ) {
        continue;
      }

      if (!isTweetFresh(converted, now)) {
        continue;
      }

      if (!isBeg(converted.text)) {
        continue;
      }

      newTweets.push(converted);
      existingIds.add(converted.tweet_id);
    }

    newTweets.sort((a, b) => {
      return (
        getTweetTimestamp(b) -
        getTweetTimestamp(a)
      );
    });

    const finalFeed = [
      ...newTweets,
      ...existing,
    ]
      .filter((tweet) =>
        isTweetFresh(tweet, now)
      )
      .filter((tweet) =>
        isBeg(tweet.text)
      )
      .slice(0, MAX_TWEETS);

    const feedChanged =
      newTweets.length > 0 ||
      finalFeed.length !== storedFeed.length;

    if (feedChanged) {
      await writeFeed(finalFeed);
    }

    console.log(
      `Added ${newTweets.length} new tweets`
    );

    return res.status(200).json({
      added: newTweets.length,
      total: finalFeed.length,
      queries: QUERIES.length,
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
