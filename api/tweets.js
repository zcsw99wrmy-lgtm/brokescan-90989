export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const query = (req.query.query || 'can i get sol').toString();
  const BEARER = process.env.TWITTER_BEARER_TOKEN;

  const url = 'https://api.twitter.com/2/tweets/search/recent'
    + '?query=' + encodeURIComponent(query + ' -is:retweet lang:en')
    + '&max_results=20'
    + '&tweet.fields=created_at,public_metrics,author_id'
    + '&expansions=author_id'
    + '&user.fields=name,username,profile_image_url';

  try {
    const r = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + BEARER }
    });
    const data = await r.json();

    // Нормализуем под формат который сайт уже понимает
    const users = {};
    (data.includes?.users || []).forEach(u => { users[u.id] = u; });

    const tweets = (data.data || []).map(t => {
      const u = users[t.author_id] || {};
      return {
        tweet_id: t.id,
        text: t.text,
        username: u.username || '',
        name: u.name || '',
        avatar: u.profile_image_url || '',
        favorites: t.public_metrics?.like_count || 0,
        retweets: t.public_metrics?.retweet_count || 0,
        createdAt: t.created_at,
      };
    });

    res.status(200).json({ tweets });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
