export default async function handler(req, res) {
  const query = (req.query.query || 'can i get sol').toString();
  const API_KEY = process.env.TWITTERAPI_KEY || 'new1_ce98ed56cbea4649912ca343c4885760';

  const url = 'https://api.twitterapi.io/twitter/tweet/advanced_search'
            + '?query=' + encodeURIComponent(query)
            + '&queryType=Latest';

  try {
    const r = await fetch(url, { headers: { 'X-API-Key': API_KEY } });
    const text = await r.text();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.status(r.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(502).json({ error: 'proxy_failed', message: String(e) });
  }
}
