const https = require('https');

const COIN_IDS = {
  BTC:  'bitcoin',
  SOL:  'solana',
  ETH:  'ethereum',
  BNB:  'binancecoin',
  ADA:  'cardano',
  HBAR: 'hedera-hashgraph',
  SUI:  'sui',
  POL:  'polygon-ecosystem-token',
  LINK: 'chainlink',
  AAVE: 'aave',
  ONDO: 'ondo-finance',
};

// DeFiLlama slugs for DeFi/protocol coins
const DEFILLAMA_SLUGS = {
  AAVE: 'aave',
  LINK: null,
  ONDO: 'ondo',
};

const NEWS_QUERIES = {
  BTC:  'Bitcoin BTC price prediction 2025',
  SOL:  'Solana SOL blockchain project',
  ETH:  'Ethereum ETH upgrade project',
  BNB:  'BNB Binance chain project',
  ADA:  'Cardano ADA blockchain development',
  HBAR: 'Hedera Hashgraph HBAR enterprise',
  SUI:  'Sui blockchain SUI project',
  POL:  'Polygon POL blockchain layer2',
  LINK: 'Chainlink LINK oracle blockchain',
  AAVE: 'Aave protocol DeFi lending',
  ONDO: 'Ondo Finance RWA tokenization',
};

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json, text/xml, */*',
      },
      timeout: 12000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseNewsRSS(xml) {
  const items = [];
  const rx = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = rx.exec(xml)) !== null && items.length < 8) {
    const block = m[1];
    const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1]?.trim() || '';
    const link  = (block.match(/<link>([^<]+)<\/link>/) || block.match(/<link[^>]+href="([^"]+)"/) || [])[1]?.trim() || '';
    const pub   = (block.match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1]?.trim() || '';
    const src   = (block.match(/<source[^>]*>([^<]+)<\/source>/) || [])[1]?.trim() || '';
    if (title && link) items.push({ title, link, pubDate: pub, source: src });
  }
  return items;
}

module.exports = async (req, res) => {
  const ticker = (req.query?.ticker || '').toUpperCase();
  const coinId = COIN_IDS[ticker];

  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!coinId) return res.status(404).json({ error: 'Coin not found' });

  try {
    const [cgRes, newsRes, tvlRes] = await Promise.all([
      get(`https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`),
      get(`https://news.google.com/rss/search?q=${encodeURIComponent(NEWS_QUERIES[ticker])}&hl=en-PH&gl=PH&ceid=PH:en`),
      DEFILLAMA_SLUGS[ticker]
        ? get(`https://api.llama.fi/protocol/${DEFILLAMA_SLUGS[ticker]}`).catch(() => null)
        : Promise.resolve(null),
    ]);

    const cg   = JSON.parse(cgRes.body);
    const md   = cg.market_data || {};

    // Description — first 2–3 sentences
    const rawDesc = (cg.description?.en || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const sentences = rawDesc.match(/[^.!?]+[.!?]+/g) || [];
    const description = sentences.slice(0, 3).join(' ').trim();

    // Price & market data (PHP)
    const pricePhp  = md.current_price?.php ?? null;
    const priceUsd  = md.current_price?.usd ?? null;
    const mcap      = md.market_cap?.php ?? null;
    const vol24h    = md.total_volume?.php ?? null;
    const circ      = md.circulating_supply ?? null;
    const total     = md.total_supply ?? null;
    const max       = md.max_supply ?? null;
    const ath       = md.ath?.php ?? null;
    const athPct    = md.ath_change_percentage?.php ?? null;
    const chg24h    = md.price_change_percentage_24h ?? null;
    const chg7d     = md.price_change_percentage_7d ?? null;
    const chg30d    = md.price_change_percentage_30d ?? null;
    const chg1y     = md.price_change_percentage_1y ?? null;
    const volMcapRatio = (mcap && vol24h) ? (vol24h / mcap) : null;
    const circPct   = (circ && total) ? (circ / total * 100) : null;

    // TVL from DeFiLlama
    let tvlUsd = null;
    if (tvlRes?.body) {
      try {
        const tvlData = JSON.parse(tvlRes.body);
        const tvlArr = tvlData.tvl;
        if (Array.isArray(tvlArr) && tvlArr.length) {
          tvlUsd = tvlArr[tvlArr.length - 1]?.totalLiquidityUSD ?? null;
        }
      } catch (_) {}
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.status(200).json({
      ticker,
      name: cg.name,
      symbol: (cg.symbol || '').toUpperCase(),
      description,
      categories: (cg.categories || []).slice(0, 4),
      rank: cg.market_cap_rank,
      sentiment: cg.sentiment_votes_up_percentage ?? null,
      watchlistUsers: cg.watchlist_portfolio_users ?? null,
      homepage: cg.links?.homepage?.[0] || null,
      // Price
      pricePhp, priceUsd, mcap, vol24h, ath, athPct,
      circ, total, max, circPct,
      chg24h, chg7d, chg30d, chg1y,
      volMcapRatio,
      // DeFi
      tvlUsd,
      // News
      news: parseNewsRSS(newsRes.body),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
