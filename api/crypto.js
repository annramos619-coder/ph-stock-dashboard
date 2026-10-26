const https = require('https');

const COINS = 'bitcoin,solana,ethereum,binancecoin,cardano,hedera-hashgraph,sui,polygon-ecosystem-token,chainlink,aave,ondo-finance';

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json',
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

module.exports = async (req, res) => {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=php&ids=${COINS}&order=market_cap_desc&per_page=11&page=1&sparkline=false&price_change_percentage=1h,24h,7d`;
    const { status, body } = await get(url);
    if (status !== 200) throw new Error(`CoinGecko returned ${status}`);

    const coins = JSON.parse(body);
    const result = coins.map(c => ({
      id:       c.id,
      symbol:   c.symbol.toUpperCase(),
      name:     c.name,
      price:    c.current_price,
      change24h: c.price_change_percentage_24h,
      change7d:  c.price_change_percentage_7d_in_currency,
      change1h:  c.price_change_percentage_1h_in_currency,
      high24h:  c.high_24h,
      low24h:   c.low_24h,
      marketCap: c.market_cap,
      volume24h: c.total_volume,
      image:    c.image,
      ath:      c.ath,
      athPct:   c.ath_change_percentage,
    }));

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
    res.status(200).json(result);
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(500).json({ error: e.message });
  }
};
