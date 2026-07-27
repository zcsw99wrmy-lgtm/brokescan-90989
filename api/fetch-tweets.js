import { put, list } from '@vercel/blob';

const API_KEY =
  process.env.TWITTERAPI_KEY ||
  'new1_b5fb91a3bf4f4b36807b97be5f36b076';

const FEED_KEY = 'brokescan-feed.json';

const MAX_TWEETS = 100;

// Показывать твиты не старше 2 часов. Это даёт повторному запуску время
// подобрать твит, если Twitter Search проиндексировал его с задержкой.
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

// Запросы с отметкой @brokescan имеют приоритет и проверяются
// при каждом запуске.
const PRIORITY_QUERIES = [
  '@brokescan',
  '@brokescan sol',
  '@brokescan send me sol',
  '@brokescan can u send me sol',
  '@brokescan can you send me sol',
  '@brokescan give me sol',
  '@brokescan how many likes for sol',
  '@brokescan sol please',
];

// Обычные просьбы тоже ищем, но только часть списка за один запуск.
// Список циклически сдвигается, поэтому все фразы регулярно проверяются.
const GENERIC_QUERIES = [
  'can i get sol',
  'can i get some sol',
  'can i get 1 sol',
  'can i get 0.1 sol',
  'can i get 0.2 sol',
  'can i get 0.5 sol',
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
  'how many likes sol',
  'how many likes for 0.1 sol',
  'how many likes for 0.2 sol',
  'how many likes for 0.5 sol',
  'how many likes for 1 sol',
  'how many retweets for sol',
  'how many retweets sol',
  'need some sol',
  'please send sol',
  'please 1 sol',
  'spare some sol',
];

const GENERIC_QUERIES_PER_RUN = 10;
const QUERY_ROTATION_MS = 2 * 60 * 1000;

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
  'claim airdrop',
  'airdrop is live',
  'airdrop to ',
  'sol at ',
  'sol to $',
  // Sol Ruca — имя рестлера, а не просьба отправить SOL.
  'sol ruca',
  'casino',
  'jackpot',
  'one shot',
  'game',
  'gaming',
];

// Рассказы о прошлых переводах и обсуждение уже полученных денег —
// это не просьбы. Проверяем их до положительных шаблонов.
const BEG_CONTEXT_STOPS = [
  // Например: "Give me Sol Ruca vs Lyra ... for the title".
  // Здесь SOL является частью имени в спортивном контексте.
  /\bgive me sol [a-z][a-z'-]+\b.*\b(?:vs|title|titles|championship|match|contenders?)\b/i,
  /\b(?:sent|gave|paid|transferred) me(?: some| any| \d*\.?\d+)? (?:sol|solana)\b/i,
  /\b(?:i|we) (?:sent|gave|paid|transferred)(?: someone| them| him| her)?(?: some| any| \d*\.?\d+)? (?:sol|solana)\b/i,
  /\b(?:received|got)(?: some| any| \d*\.?\d+)? (?:sol|solana)\b/i,
  /\b(?:already|previously|earlier|yesterday|last time)\b.*\b(?:sent|gave|paid|received|got)\b/i,
  /\bsend me(?: some| any| \d*\.?\d+)? (?:sol|solana)\b.*\b(?:and|when) it was\b/i,
];

const BEG_PATTERNS = [
  // Для твитов с @brokescan принимаем больше вариантов формулировки,
  // но в тексте всё равно должна быть просьба и слово SOL/Solana.
  /@brokescan\b.*\b(?:can|could|would|send|give|drop|need|want|please|pls|plz|likes?|retweets?|rts?)\b.*\b(?:sol|solana)\b/i,

  /@brokescan\b.*\b(?:sol|solana)\b.*\b(?:please|pls|plz|send|give|drop|need|want|likes?|retweets?|rts?)\b/i,

  // can i get sol / can i get some sol / can i get 1 sol
  /\bcan i (?:get|have)(?: some| any| a little| \d*\.?\d+)? (?:sol|solana)\b/i,

  // can someone send me sol / can someone send me 0.5 sol
  /\bcan someone (?:send|give|drop) me(?: some| any| \d*\.?\d+)? (?:sol|solana)\b/i,

  /\b(?:anyone|somebody) (?:send|give|drop) me(?: some| any| \d*\.?\d+)? (?:sol|solana)\b/i,

  /\b(?:please|pls|plz) send me(?: some| any| \d*\.?\d+)? (?:sol|solana)\b/i,

  /\b(?:please|pls|plz) send(?: some| any| \d*\.?\d+)? (?:sol|solana)\b/i,

  // @brokescan can u/can you/could u send me 1 sol?
  /\bbrokescan\b.*\b(?:can|could|would) (?:u|you) (?:send|give|drop) me(?: some| any| \d*\.?\d+)? (?:sol|solana)\b/i,

  /\b(?:can|could|would) (?:u|you) (?:send|give|drop) me(?: some| any| \d*\.?\d+)? (?:sol|solana)\b/i,

  /\bbrokescan\b.*\b(?:send|give|drop) me(?: some| any| \d*\.?\d+)? (?:sol|solana)\b/i,

  // please 1 sol legend
  /\b(?:please|pls|plz)(?: \d*\.?\d+)? (?:sol|solana)\b/i,

  /^(?:@\w+\s+)*(?:(?:please|pls|plz)\s+)?send me(?: some| any| \d*\.?\d+)? (?:sol|solana)\b/i,

  /^(?:@\w+\s+)*(?:(?:please|pls|plz)\s+)?give me(?: some| any| \d*\.?\d+)? (?:sol|solana)\b/i,

  /^(?:@\w+\s+)*(?:(?:please|pls|plz)\s+)?drop me(?: some| any| \d*\.?\d+)? (?:sol|solana)\b/i,

  /\bi need(?: some| any| a little| \d*\.?\d+)? (?:sol|solana)\b/i,

  /\bneed(?: some| any| a little| \d*\.?\d+)? (?:sol|solana)(?: please| pls| plz)?\b/i,

  /\bspare(?: me)?(?: some| any| \d*\.?\d+)? (?:sol|solana)\b/i,

  /\bbless me with(?: some| any| \d*\.?\d+)? (?:sol|solana)\b/i,

  /\bbless my wallet(?: with)?(?: some| any| \d*\.?\d+)? (?:sol|solana)\b/i,

  // how many likes for sol / how many likes for 1 sol
  /\bhow many (?:likes?|rts?|retweets?) for (?:\d*\.?\d+\s*)?(?:sol|solana)\b/i,

  /\b(?:likes?|rts?|retweets?) for (?:\d*\.?\d+\s*)?(?:sol|solana)\b/i,
];

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\$sol\b/g, 'sol')
    .replace(/\$solana\b/g, 'solana')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBeg(text) {
  if (!text) {
    return false;
  }

  const normalized = normalizeText(text);

  if (!/\b(?:sol|solana)\b/i.test(normalized)) {
    return false;
  }

  if (
    BEG_STOPS.some((keyword) =>
      normalized.includes(keyword)
    )
  ) {
    return false;
  }

  if (
    BEG_CONTEXT_STOPS.some((pattern) =>
      pattern.test(normalized)
    )
  ) {
    return false;
  }

  return BEG_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  );
}

function isPriorityTweet(text) {
  return /@brokescan\b/i.test(String(text || ''));
}

function getQueriesForRun(now) {
  const genericCount = Math.min(
    GENERIC_QUERIES_PER_RUN,
    GENERIC_QUERIES.length
  );

  const rotation = Math.floor(
    now / QUERY_ROTATION_MS
  );

  const startIndex =
    rotation % GENERIC_QUERIES.length;

  const selectedGeneric = [];

  for (let index = 0; index < genericCount; index += 1) {
    selectedGeneric.push(
      GENERIC_QUERIES[
        (startIndex + index) %
        GENERIC_QUERIES.length
      ]
    );
  }

  return [
    ...PRIORITY_QUERIES,
    ...selectedGeneric,
  ];
}

function compareTweets(a, b) {
  const priorityDifference =
    Number(isPriorityTweet(b.text)) -
    Number(isPriorityTweet(a.text));

  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  return (
    getTweetTimestamp(b) -
    getTweetTimestamp(a)
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

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    20_000
  );

  try {
    const response = await fetch(url, {
      headers: {
        'X-API-Key': API_KEY,
      },
      signal: controller.signal,
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

    const rawTweets =
      data.tweets ||
      data.timeline?.tweets ||
      data.timeline ||
      data.results ||
      [];

    const tweets = Array.isArray(rawTweets)
      ? rawTweets
      : [];

    const matching = tweets.filter((tweet) =>
      isBeg(tweet.text || tweet.full_text)
    );

    console.log(
      `"${query}" → ${tweets.length} tweets, ` +
      `isBeg: ${matching.length}`
    );

    return matching;
  } catch (error) {
    console.error(
      `Fetch error for "${query}":`,
      error instanceof Error
        ? error.message
        : String(error)
    );

    return [];
  } finally {
    clearTimeout(timeoutId);
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

    const queries = getQueriesForRun(now);

    console.log(
      `Fetching ${queries.length} queries: ` +
      `${PRIORITY_QUERIES.length} priority, ` +
      `${queries.length - PRIORITY_QUERIES.length} generic`
    );

    // Все выбранные запросы запускаются параллельно. Приоритетные
    // запросы присутствуют в каждом проходе.
    const rawTweets = await fetchInBatches(
      queries,
      queries.length
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

    newTweets.sort(compareTweets);

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
      .sort(compareTweets)
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
      queries: queries.length,
      priority_queries: PRIORITY_QUERIES.length,
      generic_queries:
        queries.length - PRIORITY_QUERIES.length,
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
