const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 10000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

module.exports = async (req, res) => {
  try {
    const raw = await get('https://phisix-api3.appspot.com/stocks.json');
    const data = JSON.parse(raw);
    const result = {};

    for (const s of (data.stocks || [])) {
      const price = s.price?.amount ?? 0;
      const pctChg = s.percentChange ?? 0;
      const prevClose = pctChg !== -100 ? price / (1 + pctChg / 100) : price;
      result[s.symbol] = {
        regularMarketPrice: price,
        regularMarketChange: price - prevClose,
        regularMarketChangePercent: pctChg,
        regularMarketVolume: s.volume ?? 0,
      };
    }

    // Try PSEi
    try {
      const piRaw = await get('https://phisix-api3.appspot.com/stocks/PSEi.json');
      const pi = JSON.parse(piRaw).stocks?.[0];
      if (pi) {
        const price = pi.price?.amount ?? 0;
        const pct = pi.percentChange ?? 0;
        const prev = pct !== -100 ? price / (1 + pct / 100) : price;
        result['^PSEi'] = {
          regularMarketPrice: price,
          regularMarketChange: price - prev,
          regularMarketChangePercent: pct,
        };
      }
    } catch (_) {}

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
