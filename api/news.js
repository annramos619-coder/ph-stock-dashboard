const https = require('https');

const FEEDS = [
  { url: 'https://www.bworldonline.com/feed/',         name: 'BusinessWorld', cls: 'src-bw'  },
  { url: 'https://business.inquirer.net/feed',         name: 'Inquirer Biz',  cls: 'src-inq' },
  { url: 'https://www.philstar.com/rss/business',      name: 'PhilStar',      cls: 'src-pbs' },
  { url: 'https://mb.com.ph/category/business/feed/',  name: 'Manila Bulletin', cls: 'src-mb' },
];

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseRSS(xml, source, cls) {
  const items = [];
  const itemRx = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const block = m[1];
    const get = tag => {
      const r = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`);
      const match = r.exec(block);
      return match ? (match[1] || match[2] || '').trim() : '';
    };
    const title   = get('title');
    const link    = get('link');
    const desc    = get('description') || get('content:encoded') || '';
    const date    = get('pubDate');
    if (title && link) {
      const excerpt = desc.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
      items.push({ title, link, excerpt, date, source, cls });
    }
  }
  return items;
}

async function fetchFeed(feed) {
  try {
    const xml = await get(feed.url);
    return parseRSS(xml, feed.name, feed.cls);
  } catch (_) {
    return [];
  }
}

module.exports = async (req, res) => {
  try {
    const results = await Promise.all(FEEDS.map(fetchFeed));
    const all = results.flat().sort((a, b) => new Date(b.date) - new Date(a.date));
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=120');
    res.status(200).json(all);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
