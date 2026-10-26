const https = require('https');

// Company-specific search terms for Google News RSS
const COMPANY_QUERIES = {
  BDO:   '"BDO Unibank" OR "Banco de Oro" PSE Philippines',
  AREIT: '"AREIT" OR "Ayala REIT" PSE Philippines',
  RFM:   '"RFM Corporation" OR "RFM Corp" PSE Philippines',
  RCR:   '"RL Commercial REIT" OR "RCR REIT" PSE Philippines',
  VREIT: '"Villar REIT" OR "VistaREIT" PSE Philippines',
  VLL:   '"Vista Land" PSE Philippines',
  DNL:   '"D&L Industries" OR "D and L Industries" PSE Philippines',
  LTG:   '"LT Group" OR "Lucio Tan" PSE Philippines',
  SGP:   '"Synergy Grid" OR "National Grid Corporation" PSE Philippines',
  MYNLD: '"Maynilad Water" OR "Maynilad" PSE Philippines',
  UBP:   '"UnionBank" OR "Union Bank of the Philippines" PSE Philippines',
  CNVRG: '"Converge ICT" OR "Converge" fiber broadband PSE Philippines',
};

// Keywords that flag intelligence-relevant stories
const SIGNAL_PATTERNS = [
  { key: 'insider',  rx: /insider|beneficial ownership|17-7|change in ownership|director.{0,20}(bought|sold|acquir)|officer.{0,20}(bought|sold|acquir)/i,      label: 'Insider Move',    color: '#f59e0b' },
  { key: 'buyback',  rx: /share.{0,10}(buy.?back|repurchase)|buyback|buy-back|9-1/i,                                                                           label: 'Buyback',         color: '#06b6d4' },
  { key: 'acquisition', rx: /acqui(r|sit)|merger|takeover|JV|joint venture|partnership deal|strategic alliance/i,                                               label: 'Acquisition/JV',  color: '#8b5cf6' },
  { key: 'project',  rx: /expand|expan|new (project|development|plant|facility|branch|building|tower|mall|hospital|school|solar|wind|power|infra)|capital expenditure|capex|IPO|launch/i, label: 'Expansion',    color: '#10d88a' },
  { key: 'regulation', rx: /SEC|BSP|DICT|NTC|ERC|DOF|BIR|tax|regulatory|compliance|investigation|fine|penalty|sanction|cease|suspend/i,                       label: 'Regulatory',      color: '#f43f5e' },
  { key: 'earnings', rx: /earnings|profit|revenue|income|result|financial (report|performance)|quarterly|annual report/i,                                       label: 'Earnings',        color: '#6366f1' },
  { key: 'dividend', rx: /dividend|divid|payout|cash distribution|property dividend/i,                                                                          label: 'Dividend',        color: '#f59e0b' },
  { key: 'block',    rx: /block (sale|trade|deal)|big block|large (stake|shareholding)|sold.{0,20}(shares|stake)|placement|cross deal/i,                        label: 'Block Trade',     color: '#f43f5e' },
];

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/rss+xml, text/xml, */*',
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

function parseRSS(xml) {
  const items = [];
  const rx = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = rx.exec(xml)) !== null) {
    const block = m[1];
    const field = tag => {
      const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/${tag}>`);
      const fm = r.exec(block);
      return fm ? (fm[1] || fm[2] || '').trim() : '';
    };
    const title   = field('title');
    const link    = field('link') || (block.match(/<link[^>]*>([^<]+)<\/link>/) || [])[1] || '';
    const pubDate = field('pubDate');
    const source  = (block.match(/<source[^>]+>([^<]+)<\/source>/) || [])[1] || '';
    const desc    = field('description').replace(/<[^>]+>/g, '').trim().slice(0, 200);
    if (title && link) items.push({ title, link, pubDate, source, desc });
  }
  return items;
}

function tagSignals(item) {
  const text = `${item.title} ${item.desc}`;
  return SIGNAL_PATTERNS.filter(p => p.rx.test(text)).map(p => ({
    key: p.key, label: p.label, color: p.color,
  }));
}

module.exports = async (req, res) => {
  const ticker = (req.query?.ticker || '').toUpperCase();
  if (!ticker) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(400).json({ error: 'ticker required' });
  }

  const query = COMPANY_QUERIES[ticker];
  if (!query) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(404).json({ error: 'ticker not in watchlist' });
  }

  try {
    const encoded = encodeURIComponent(query);
    const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-PH&gl=PH&ceid=PH:en`;
    const { status, body } = await get(url);
    if (status !== 200) throw new Error(`Google News returned ${status}`);

    const items = parseRSS(body).slice(0, 20);
    const results = items.map(item => ({
      title:   item.title,
      link:    item.link,
      date:    item.pubDate,
      source:  item.source,
      excerpt: item.desc,
      signals: tagSignals(item),
    }));

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=180');
    res.status(200).json({ ticker, items: results });
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(500).json({ error: e.message });
  }
};
