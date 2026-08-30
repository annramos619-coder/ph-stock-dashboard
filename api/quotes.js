const https = require('https');

const TICKERS = ['BDO','AREIT','RFM','RCR','DDMPR','VREIT','VLL','DNL','LTG','SGP','MYNLD'];

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://www.investagrams.com/',
      },
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

async function fetchStock(ticker) {
  try {
    const raw = await get(`https://webapi.investagrams.com/InvestaApi/Stock/ViewStock?stockCode=${ticker}&exchangeType=0`);
    const data = JSON.parse(raw);
    const h = data.LatestStockHistory;
    if (!h) return null;
    return {
      ticker,
      regularMarketPrice: h.Last ?? h.Close ?? 0,
      regularMarketChange: h.Change ?? 0,
      regularMarketChangePercent: h.ChangePercentage ?? 0,
      regularMarketVolume: h.Volume ?? 0,
      open: h.Open ?? 0,
      high: h.High ?? 0,
      low: h.Low ?? 0,
      marketCap: h.MarketCap ?? '',
      netForeign: h.NetForeign ?? 0,
      lastUpdate: h.LastUpdateTime ?? '',
      marketStatus: data.MarketTradingStatus ?? '',
    };
  } catch (_) {
    return null;
  }
}

module.exports = async (req, res) => {
  try {
    const results = await Promise.all(TICKERS.map(fetchStock));
    const result = {};
    for (const r of results) {
      if (r) result[r.ticker] = r;
    }

    // PSEi via phisix as fallback (Investagrams doesn't expose index freely)
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
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=30');
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
