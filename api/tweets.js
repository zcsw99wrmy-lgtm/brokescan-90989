// Vercel Serverless Function — proxy to twitterapi.io
// Браузер ходит сюда (/api/tweets?query=...), CORS не возникает (тот же домен),
// а API-ключ спрятан на сервере.

export default async function handler(req, res) {
  const query = (req.query.query || 'can i get sol').toString();

  // Ключ берётся из переменной окружения Vercel (Settings → Environment Variables),
  // либо хардкод-фолбэк ниже.
  const API_KEY = process.env.TWITTERAPI_KEY || 'new1_9c1b2678858245шгненгортa8481037949cbe980';

  const url = 'https://api.twitterapi.io/twitter/tweet/advanced_search'
            + '?query=' + encodeURIComponent(query)
            + '&queryType=Latest';

  try {
    const r = await fetch(url, { headers: { 'X-API-Key': API_KEY } });
    const text = await r.text();

    // Фильтруем твиты длиннее 60 символов
    let payload;
    try {
      payload = JSON.parse(text);
      if (Array.isArray(payload.tweets)) {
        payload.tweets = payload.tweets.filter(t => (t.text || '').length <= 60);
      } else if (Array.isArray(payload)) {
        payload = payload.filter(t => (t.text || '').length <= 60);
      }
    } catch {
      // Если JSON не распарсился — отдаём как есть
      payload = text;
    }

    const responseBody = typeof payload === 'string' ? payload : JSON.stringify(payload);

    // Разрешаем запрос с любого источника (на всякий случай)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.status(r.status).setHeader('Content-Type', 'application/json').send(responseBody);
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(502).json({ error: 'proxy_failed', message: String(e) });
  }
}
