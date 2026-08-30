// PH Stock Dashboard — Node.js server (no install needed, uses built-ins)
// Run: node server.js  or  double-click "START DASHBOARD.bat"

const http = require('http');
const https = require('https');

const PORT = 8888;

const WATCHLIST = [
  { ticker: 'BDO',   yf: 'BDO',   name: 'BDO Unibank',          sector: 'bank',  color: '#4f7cff' },
  { ticker: 'AREIT', yf: 'AREIT', name: 'Ayala REIT',           sector: 'reit',  color: '#7c5cfc' },
  { ticker: 'RFM',   yf: 'RFM',   name: 'RFM Corporation',      sector: 'fmcg',  color: '#00c896' },
  { ticker: 'RCR',   yf: 'RCR',   name: 'RL Commercial REIT',   sector: 'reit',  color: '#5cb8ff' },
  { ticker: 'DDMPR', yf: 'DDMPR', name: 'DoubleDragon REIT',    sector: 'reit',  color: '#7c5cfc' },
  { ticker: 'VREIT', yf: 'VREIT', name: 'Villar REIT',          sector: 'reit',  color: '#b05cfc' },
  { ticker: 'VLL',   yf: 'VLL',   name: 'Vista Land',           sector: 'prop',  color: '#f5c542' },
  { ticker: 'DNL',   yf: 'DNL',   name: 'D&L Industries',       sector: 'fmcg',  color: '#00c896' },
  { ticker: 'LTG',   yf: 'LTG',   name: 'LT Group',             sector: 'other', color: '#ff7043' },
  { ticker: 'SGP',   yf: 'SGP',   name: 'Synergy Grid & Dev.',  sector: 'other', color: '#26c6da' },
  { ticker: 'MYNLD', yf: 'MYNLD', name: 'Maynilad Water',       sector: 'util',  color: '#0ea5e9' },
];

const NEWS_FEEDS = [
  { url: 'https://www.bworldonline.com/feed/',          name: 'BusinessWorld', cls: 'src-bw'  },
  { url: 'https://business.inquirer.net/feed',          name: 'Inquirer Biz',  cls: 'src-inq' },
  { url: 'https://www.philstar.com/rss/business',       name: 'PhilStar',      cls: 'src-pbs' },
  { url: 'https://mb.com.ph/category/business/feed/',   name: 'Manila Bulletin', cls: 'src-mb' },
];

// Cache
let quotesCache = null, quotesTs = 0;
let newsCache   = null, newsTs   = 0;
const QUOTES_TTL = 5  * 60 * 1000;
const NEWS_TTL   = 15 * 60 * 1000;

// ── HTTP helper ───────────────────────────────────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json, text/html, application/xhtml+xml',
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

// ── Quotes via phisix-api (live PSE data) ────────────────────────────────
async function fetchQuotes() {
  const raw = await get('https://phisix-api3.appspot.com/stocks.json');
  const data = JSON.parse(raw);
  const result = {};

  // Map phisix stocks to our format
  for (const s of (data.stocks || [])) {
    const price = s.price?.amount ?? 0;
    const pctChg = s.percentChange ?? 0;
    // prevClose = price / (1 + pctChg/100)
    const prevClose = pctChg !== -100 ? price / (1 + pctChg / 100) : price;
    const change = price - prevClose;

    result[s.symbol] = {
      symbol: s.symbol,
      shortName: s.name,
      regularMarketPrice: price,
      regularMarketChange: change,
      regularMarketChangePercent: pctChg,
      regularMarketVolume: s.volume ?? 0,
      // phisix doesn't provide 52W/day range — omit gracefully
      fiftyTwoWeekLow: null,
      fiftyTwoWeekHigh: null,
      regularMarketDayLow: null,
      regularMarketDayHigh: null,
      asOf: data.as_of,
    };
  }

  // Try to get PSEi from phisix (it's sometimes included as 'PSEi')
  // Fallback: fetch PSEi separately
  try {
    const piRaw = await get('https://phisix-api3.appspot.com/stocks/PSEi.json');
    const piData = JSON.parse(piRaw);
    const pi = piData.stocks?.[0];
    if (pi) {
      const price = pi.price?.amount ?? 0;
      const pct   = pi.percentChange ?? 0;
      const prev  = pct !== -100 ? price / (1 + pct / 100) : price;
      result['^PSEi'] = {
        regularMarketPrice: price,
        regularMarketChange: price - prev,
        regularMarketChangePercent: pct,
      };
    }
  } catch(_) {}

  return result;
}

async function getQuotes() {
  const now = Date.now();
  if (quotesCache && now - quotesTs < QUOTES_TTL) return quotesCache;
  try {
    quotesCache = await fetchQuotes();
    quotesTs = now;
    console.log(`[quotes] fetched ${Object.keys(quotesCache).length} symbols`);
  } catch (e) {
    console.error('[quotes] error:', e.message);
    if (!quotesCache) quotesCache = {};
  }
  return quotesCache;
}

// ── News ──────────────────────────────────────────────────────────────────
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
    const link    = get('link') || block.match(/<link[^>]*href="([^"]+)"/)?.[1] || '';
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
  } catch (e) {
    console.error(`[news] ${feed.name}: ${e.message}`);
    return [];
  }
}

async function getNews() {
  const now = Date.now();
  if (newsCache && now - newsTs < NEWS_TTL) return newsCache;
  const results = await Promise.all(NEWS_FEEDS.map(fetchFeed));
  newsCache = results.flat().sort((a, b) => new Date(b.date) - new Date(a.date));
  newsTs = now;
  console.log(`[news] fetched ${newsCache.length} articles`);
  return newsCache;
}

// ── HTML ──────────────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PH Stock Dashboard</title>
<style>
:root{--bg:#0f1117;--card:#1a1d27;--card2:#21253a;--border:#2a2f45;--text:#e8eaf0;--muted:#7b82a0;--green:#00c896;--red:#ff4d6a;--accent:#4f7cff;--accent2:#7c5cfc;--yellow:#f5c542;--radius:12px}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh}
.header{background:linear-gradient(135deg,#151929,#1a1d2e);border-bottom:1px solid var(--border);padding:16px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.logo{font-size:20px;font-weight:700;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.logo span{font-size:12px;-webkit-text-fill-color:var(--muted);font-weight:400;display:block}
.psei-chip{background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:8px 14px;display:flex;align-items:center;gap:10px}
.psei-chip .label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
.psei-chip .value{font-size:18px;font-weight:700}
.psei-chip .change{font-size:13px;font-weight:600}
.header-left{display:flex;align-items:center;gap:16px}
.header-right{display:flex;align-items:center;gap:12px}
.last-update{font-size:12px;color:var(--muted)}
.refresh-btn{background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;font-weight:600;display:flex;align-items:center;gap:6px;transition:opacity .2s}
.refresh-btn:hover{opacity:.85}
.refresh-btn:disabled{opacity:.5;cursor:not-allowed}
.spin{animation:spin 1s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.main{display:grid;grid-template-columns:1fr 390px;min-height:calc(100vh - 70px)}
@media(max-width:900px){.main{grid-template-columns:1fr}}
.left-panel{padding:20px;border-right:1px solid var(--border);overflow-y:auto}
.market-bar{display:flex;gap:12px;margin-bottom:20px;overflow-x:auto;padding-bottom:4px}
.market-stat{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;min-width:130px;flex-shrink:0}
.market-stat .ms-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.market-stat .ms-value{font-size:18px;font-weight:700}
.market-stat .ms-sub{font-size:12px;color:var(--muted);margin-top:2px}
.section-title{font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.section-title::after{content:'';flex:1;height:1px;background:var(--border)}
.watchlist-table{width:100%;border-collapse:collapse}
.watchlist-table th{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;text-align:left;padding:8px 12px;border-bottom:1px solid var(--border)}
.watchlist-table th:not(:first-child){text-align:right}
.watchlist-table td{padding:11px 12px;border-bottom:1px solid rgba(42,47,69,.5);font-size:14px;vertical-align:middle}
.watchlist-table td:not(:first-child){text-align:right}
.watchlist-table tr:last-child td{border-bottom:none}
.watchlist-table tr:hover td{background:rgba(79,124,255,.05);cursor:pointer}
.ticker-cell{display:flex;align-items:center;gap:10px}
.ticker-icon{width:34px;height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0}
.ticker-name{font-weight:600;font-size:14px}
.ticker-full{font-size:11px;color:var(--muted)}
.price-cell{font-weight:700;font-size:15px}
.change-cell{font-weight:600;font-size:13px}
.pos{color:var(--green)}.neg{color:var(--red)}.neu{color:var(--muted)}
.vol-cell{font-size:12px;color:var(--muted)}
.badge{display:inline-block;font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;text-transform:uppercase;letter-spacing:.3px}
.badge-reit{background:rgba(79,124,255,.2);color:var(--accent)}
.badge-bank{background:rgba(245,197,66,.2);color:var(--yellow)}
.badge-fmcg{background:rgba(0,200,150,.2);color:var(--green)}
.badge-prop{background:rgba(124,92,252,.2);color:var(--accent2)}
.badge-other{background:rgba(123,130,160,.2);color:var(--muted)}
.divider{height:1px;background:var(--border);margin:16px 0}
.gl-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px}
.gl-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px}
.gl-title{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
.gl-item{display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:13px}
.gl-item:not(:last-child){border-bottom:1px solid rgba(42,47,69,.5)}
.right-panel{display:flex;flex-direction:column;height:calc(100vh - 70px);position:sticky;top:70px}
.news-header{padding:14px 20px 0;border-bottom:1px solid var(--border);flex-shrink:0}
.news-tabs{display:flex;gap:2px;overflow-x:auto;padding-bottom:0}
.tab-btn{background:none;border:none;color:var(--muted);font-size:12px;font-weight:600;padding:8px 12px;cursor:pointer;border-radius:8px 8px 0 0;white-space:nowrap;border-bottom:2px solid transparent;transition:all .15s}
.tab-btn:hover{color:var(--text);background:rgba(79,124,255,.08)}
.tab-btn.active{color:var(--accent);border-bottom-color:var(--accent)}
.news-feed{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:12px}
.news-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px;transition:border-color .15s;text-decoration:none;color:inherit;display:block}
.news-card:hover{border-color:var(--accent)}
.news-meta{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.news-source{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:2px 6px;border-radius:4px}
.src-bw{background:rgba(79,124,255,.2);color:var(--accent)}
.src-inq{background:rgba(255,77,106,.2);color:var(--red)}
.src-pbs{background:rgba(0,200,150,.2);color:var(--green)}
.src-mb{background:rgba(245,197,66,.2);color:var(--yellow)}
.news-time{font-size:11px;color:var(--muted);margin-left:auto}
.news-title{font-size:13px;font-weight:600;line-height:1.45;color:var(--text)}
.news-excerpt{font-size:12px;color:var(--muted);line-height:1.5;margin-top:6px}
.news-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:8px}
.news-tag{font-size:10px;background:rgba(79,124,255,.15);color:var(--accent);padding:2px 6px;border-radius:4px}
.news-loading,.news-empty{text-align:center;color:var(--muted);font-size:13px;padding:40px 20px}
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1000;align-items:center;justify-content:center}
.modal-overlay.show{display:flex}
.modal{background:var(--card);border:1px solid var(--border);border-radius:16px;width:90vw;max-width:680px;max-height:85vh;overflow-y:auto;padding:24px;position:relative}
.modal-close{position:absolute;top:16px;right:16px;background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer}
.modal-title{font-size:20px;font-weight:700;margin-bottom:4px}
.modal-sub{font-size:13px;color:var(--muted);margin-bottom:20px}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:10px}
.status-dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:5px}
.status-live{background:var(--green);box-shadow:0 0 6px var(--green);animation:pulse 2s infinite}
.status-error{background:var(--red)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.footer{padding:12px 20px;border-top:1px solid var(--border);font-size:11px;color:var(--muted);flex-shrink:0}
</style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <div class="logo">PH Stocks <span>Philippine Market Dashboard</span></div>
    <div class="psei-chip">
      <div><div class="label">PSEi</div><div class="value" id="psei-val">—</div></div>
      <div class="change neu" id="psei-chg">—</div>
    </div>
  </div>
  <div class="header-right">
    <div class="last-update"><span class="status-dot status-live" id="status-dot"></span><span id="last-update-time">Loading...</span></div>
    <button class="refresh-btn" id="refresh-btn" onclick="refreshAll()"><span id="refresh-icon">↻</span> Refresh</button>
  </div>
</div>
<div class="main">
  <div class="left-panel">
    <div class="market-bar">
      <div class="market-stat"><div class="ms-label">Advances</div><div class="ms-value pos" id="stat-adv">—</div><div class="ms-sub">stocks up</div></div>
      <div class="market-stat"><div class="ms-label">Declines</div><div class="ms-value neg" id="stat-dec">—</div><div class="ms-sub">stocks down</div></div>
      <div class="market-stat"><div class="ms-label">Unchanged</div><div class="ms-value neu" id="stat-unc">—</div><div class="ms-sub">stocks flat</div></div>
    </div>
    <div class="section-title">My Watchlist</div>
    <table class="watchlist-table">
      <thead><tr><th>Stock</th><th>Price (PHP)</th><th>Change</th><th>% Chg</th><th>Volume</th><th>52W Range</th></tr></thead>
      <tbody id="watchlist-body"><tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px">⟳ Loading prices...</td></tr></tbody>
    </table>
    <div class="divider"></div>
    <div class="gl-row">
      <div class="gl-card"><div class="gl-title">Top Gainers</div><div id="gl-gainers"><div style="color:var(--muted);font-size:12px">Loading...</div></div></div>
      <div class="gl-card"><div class="gl-title">Top Losers</div><div id="gl-losers"><div style="color:var(--muted);font-size:12px">Loading...</div></div></div>
    </div>
  </div>
  <div class="right-panel">
    <div class="news-header">
      <div class="news-tabs">
        <button class="tab-btn active" onclick="filterNews('all')" data-tab="all">All News</button>
        <button class="tab-btn" onclick="filterNews('BDO')"   data-tab="BDO">BDO</button>
        <button class="tab-btn" onclick="filterNews('AREIT')" data-tab="AREIT">AREIT</button>
        <button class="tab-btn" onclick="filterNews('RFM')"   data-tab="RFM">RFM</button>
        <button class="tab-btn" onclick="filterNews('RCR')"   data-tab="RCR">RCR</button>
        <button class="tab-btn" onclick="filterNews('DDMPR')" data-tab="DDMPR">DDMPR</button>
        <button class="tab-btn" onclick="filterNews('VREIT')" data-tab="VREIT">VREIT</button>
        <button class="tab-btn" onclick="filterNews('VLL')"   data-tab="VLL">VLL</button>
        <button class="tab-btn" onclick="filterNews('DNL')"   data-tab="DNL">DNL</button>
        <button class="tab-btn" onclick="filterNews('LTG')"   data-tab="LTG">LTG</button>
        <button class="tab-btn" onclick="filterNews('SGP')"   data-tab="SGP">SGP</button>
      </div>
    </div>
    <div class="news-feed" id="news-feed"><div class="news-loading">⟳ Loading news...</div></div>
    <div class="footer">Prices via Yahoo Finance · News: BusinessWorld, Inquirer, PhilStar, Manila Bulletin · ~15 min delayed</div>
  </div>
</div>
<div class="modal-overlay" id="modal-overlay" onclick="closeModal(event)">
  <div class="modal">
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title" id="modal-title">—</div>
    <div class="modal-sub" id="modal-sub">—</div>
    <div id="modal-content"></div>
  </div>
</div>
<script>
const WATCHLIST=[
  {ticker:'BDO',  yf:'BDO',   name:'BDO Unibank',        sector:'bank', color:'#4f7cff'},
  {ticker:'AREIT',yf:'AREIT', name:'Ayala REIT',          sector:'reit', color:'#7c5cfc'},
  {ticker:'RFM',  yf:'RFM',   name:'RFM Corporation',     sector:'fmcg', color:'#00c896'},
  {ticker:'RCR',  yf:'RCR',   name:'RL Commercial REIT',  sector:'reit', color:'#7c5cfc'},
  {ticker:'DDMPR',yf:'DDMPR', name:'DoubleDragon REIT',   sector:'reit', color:'#7c5cfc'},
  {ticker:'VREIT',yf:'VREIT', name:'Villar REIT',         sector:'reit', color:'#7c5cfc'},
  {ticker:'VLL',  yf:'VLL',   name:'Vista Land',          sector:'prop', color:'#f5c542'},
  {ticker:'DNL',  yf:'DNL',   name:'D&L Industries',      sector:'fmcg', color:'#00c896'},
  {ticker:'LTG',  yf:'LTG',   name:'LT Group',            sector:'other',color:'#ff7043'},
  {ticker:'SGP',  yf:'SGP',   name:'Synergy Grid & Dev.', sector:'other',color:'#26c6da'},
];
const SB={reit:'badge-reit',bank:'badge-bank',fmcg:'badge-fmcg',prop:'badge-prop',other:'badge-other'};
const SL={reit:'REIT',bank:'BANK',fmcg:'FMCG',prop:'PROP',other:'HOLD'};
let allNews=[],priceData={},currentTab='all';

function fmt(n,d=2){return n==null||isNaN(n)?'—':Number(n).toLocaleString('en-PH',{minimumFractionDigits:d,maximumFractionDigits:d})}
function fmtV(n){if(!n||isNaN(n))return'—';if(n>=1e9)return(n/1e9).toFixed(2)+'B';if(n>=1e6)return(n/1e6).toFixed(2)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'K';return n}
function ago(d){const s=Math.floor((Date.now()-new Date(d))/1000);if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago'}
function cc(v){return v>0?'pos':v<0?'neg':'neu'}
function sg(v){return v>0?'+':''}

async function loadPrices(){
  try{
    const r=await fetch('/api/quotes');
    priceData=await r.json();
    const pi=priceData['^PSEi'];
    if(pi){
      document.getElementById('psei-val').textContent='₱'+fmt(pi.regularMarketPrice);
      const c=pi.regularMarketChange,cp=pi.regularMarketChangePercent,el=document.getElementById('psei-chg');
      el.className='change '+cc(c);
      el.textContent=sg(c)+fmt(c)+' ('+sg(cp)+fmt(cp)+'%)';
    }
    let adv=0,dec=0,unc=0,rows='';
    WATCHLIST.forEach(s=>{
      const q=priceData[s.yf];
      if(!q){rows+=\`<tr><td><div class="ticker-cell"><div class="ticker-icon" style="background:\${s.color}">\${s.ticker.slice(0,2)}</div><div><div class="ticker-name">\${s.ticker}</div><div class="ticker-full">\${s.name}</div></div></div></td><td colspan="5" style="color:var(--muted);font-size:12px;text-align:right">No data</td></tr>\`;return;}
      const p=q.regularMarketPrice,c=q.regularMarketChange,cp=q.regularMarketChangePercent;
      if(c>0)adv++;else if(c<0)dec++;else unc++;
      rows+=\`<tr onclick="openModal('\${s.ticker}')" style="cursor:pointer">
        <td><div class="ticker-cell"><div class="ticker-icon" style="background:\${s.color}">\${s.ticker.slice(0,2)}</div>
        <div><div class="ticker-name">\${s.ticker} <span class="badge \${SB[s.sector]}">\${SL[s.sector]}</span></div>
        <div class="ticker-full">\${s.name}</div></div></div></td>
        <td class="price-cell">₱\${fmt(p)}</td>
        <td class="change-cell \${cc(c)}">\${sg(c)}\${fmt(c)}</td>
        <td class="change-cell \${cc(cp)}">\${sg(cp)}\${fmt(cp)}%</td>
        <td class="vol-cell">\${fmtV(q.regularMarketVolume)}</td>
        <td class="vol-cell" style="font-size:11px">₱\${fmt(q.fiftyTwoWeekLow)} – ₱\${fmt(q.fiftyTwoWeekHigh)}</td>
      </tr>\`;
    });
    document.getElementById('watchlist-body').innerHTML=rows;
    document.getElementById('stat-adv').textContent=adv;
    document.getElementById('stat-dec').textContent=dec;
    document.getElementById('stat-unc').textContent=unc;
    const s2=WATCHLIST.map(s=>({...s,chgp:priceData[s.yf]?.regularMarketChangePercent||0})).filter(s=>priceData[s.yf]);
    document.getElementById('gl-gainers').innerHTML=[...s2].sort((a,b)=>b.chgp-a.chgp).slice(0,3).map(s=>\`<div class="gl-item"><span>\${s.ticker}</span><span class="pos">\${sg(s.chgp)}\${fmt(s.chgp)}%</span></div>\`).join('');
    document.getElementById('gl-losers').innerHTML=[...s2].sort((a,b)=>a.chgp-b.chgp).slice(0,3).map(s=>\`<div class="gl-item"><span>\${s.ticker}</span><span class="neg">\${fmt(s.chgp)}%</span></div>\`).join('');
    document.getElementById('status-dot').className='status-dot status-live';
    document.getElementById('last-update-time').textContent='Updated '+new Date().toLocaleTimeString('en-PH');
  }catch(e){
    document.getElementById('watchlist-body').innerHTML=\`<tr><td colspan="6" style="text-align:center;color:var(--red);padding:20px">⚠ \${e.message}</td></tr>\`;
    document.getElementById('status-dot').className='status-dot status-error';
  }
}

async function loadNews(){
  try{const r=await fetch('/api/news');allNews=await r.json();renderNews(currentTab);}
  catch(e){document.getElementById('news-feed').innerHTML='<div class="news-empty">⚠ Could not load news</div>';}
}

const KW={
  BDO:['BDO','BDO Unibank','Banco de Oro'],AREIT:['AREIT','Ayala REIT'],
  RFM:['RFM','RFM Corp','Cosmos'],RCR:['RCR','RL Commercial','Robinsons Land'],
  DDMPR:['DDMPR','DoubleDragon'],VREIT:['VREIT','Villar REIT'],
  VLL:['VLL','Vista Land','Brittany','Camella'],DNL:['DNL','D&L Industries'],
  LTG:['LTG','LT Group','Lucio Tan','Philippine Airlines','PAL'],
  SGP:['SGP','Synergy Grid','National Grid'],
};
function matches(a,t){const h=(a.title+' '+a.excerpt).toLowerCase();return(KW[t]||[t]).some(k=>h.includes(k.toLowerCase()))}

function renderNews(tab){
  currentTab=tab;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  const list=tab==='all'?allNews:allNews.filter(a=>matches(a,tab));
  if(!list.length){document.getElementById('news-feed').innerHTML=\`<div class="news-empty">No recent news for \${tab}.<br><small>Try "All News" or check back later.</small></div>\`;return;}
  document.getElementById('news-feed').innerHTML=list.slice(0,30).map(a=>{
    const tags=WATCHLIST.filter(s=>matches(a,s.ticker)).map(s=>\`<span class="news-tag">\${s.ticker}</span>\`).join('');
    return \`<a class="news-card" href="\${a.link}" target="_blank" rel="noopener">
      <div class="news-meta"><span class="news-source \${a.cls}">\${a.source}</span><span class="news-time">\${a.date?ago(a.date):''}</span></div>
      <div class="news-title">\${a.title}</div>
      \${a.excerpt?\`<div class="news-excerpt">\${a.excerpt}...</div>\`:''}
      \${tags?\`<div class="news-tags">\${tags}</div>\`:''}
    </a>\`;
  }).join('');
}
function filterNews(t){renderNews(t)}

function openModal(ticker){
  const s=WATCHLIST.find(x=>x.ticker===ticker),q=priceData[s?.yf];
  if(!s||!q)return;
  document.getElementById('modal-title').textContent=\`\${ticker} — \${s.name}\`;
  document.getElementById('modal-sub').textContent=\`\${SL[s.sector]} · PSE\`;
  const p=q.regularMarketPrice,c=q.regularMarketChange,cp=q.regularMarketChangePercent;
  document.getElementById('modal-content').innerHTML=\`
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">
      <div style="background:var(--card2);border-radius:10px;padding:14px">
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px">PRICE</div>
        <div style="font-size:26px;font-weight:700">₱\${fmt(p)}</div>
        <div style="font-size:14px;font-weight:600" class="\${cc(c)}">\${sg(c)}\${fmt(c)} (\${sg(cp)}\${fmt(cp)}%)</div>
      </div>
      <div style="background:var(--card2);border-radius:10px;padding:14px">
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px">DAY RANGE</div>
        <div style="font-size:15px;font-weight:600">₱\${fmt(q.regularMarketDayLow)} – ₱\${fmt(q.regularMarketDayHigh)}</div>
      </div>
      <div style="background:var(--card2);border-radius:10px;padding:14px">
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px">52W RANGE</div>
        <div style="font-size:15px;font-weight:600">₱\${fmt(q.fiftyTwoWeekLow)} – ₱\${fmt(q.fiftyTwoWeekHigh)}</div>
      </div>
    </div>
    <div style="background:var(--card2);border-radius:10px;padding:14px;margin-bottom:20px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">VOLUME</div>
      <div style="font-size:20px;font-weight:700">\${fmtV(q.regularMarketVolume)}</div>
    </div>
    <div class="section-title">Related News</div>
    \${allNews.filter(a=>matches(a,ticker)).slice(0,5).map(a=>\`
      <a class="news-card" href="\${a.link}" target="_blank" rel="noopener" style="margin-bottom:10px;display:block">
        <div class="news-meta"><span class="news-source \${a.cls}">\${a.source}</span><span class="news-time">\${a.date?ago(a.date):''}</span></div>
        <div class="news-title">\${a.title}</div></a>\`).join('')||'<div style="color:var(--muted);font-size:13px">No specific news found.</div>'}
  \`;
  document.getElementById('modal-overlay').classList.add('show');
}
function closeModal(e){if(!e||e.target===document.getElementById('modal-overlay'))document.getElementById('modal-overlay').classList.remove('show')}

async function refreshAll(){
  const btn=document.getElementById('refresh-btn'),icon=document.getElementById('refresh-icon');
  btn.disabled=true;icon.className='spin';icon.textContent='↻';
  await Promise.all([loadPrices(),loadNews()]);
  btn.disabled=false;icon.className='';
}
document.addEventListener('DOMContentLoaded',()=>{
  refreshAll();
  setInterval(loadPrices,5*60*1000);
  setInterval(loadNews,15*60*1000);
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
</script>
</body>
</html>`;

// ── Server ────────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  const cors = () => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
  };

  if (req.url === '/') {
    cors();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);

  } else if (req.url === '/api/quotes') {
    const data = await getQuotes();
    const out = {};
    for (const [sym, q] of Object.entries(data)) {
      out[sym] = {
        regularMarketPrice:        q.regularMarketPrice,
        regularMarketChange:       q.regularMarketChange,
        regularMarketChangePercent:q.regularMarketChangePercent,
        regularMarketVolume:       q.regularMarketVolume,
        fiftyTwoWeekLow:           q.fiftyTwoWeekLow,
        fiftyTwoWeekHigh:          q.fiftyTwoWeekHigh,
        regularMarketDayLow:       q.regularMarketDayLow,
        regularMarketDayHigh:      q.regularMarketDayHigh,
      };
    }
    cors();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));

  } else if (req.url === '/api/news') {
    const data = await getNews();
    cors();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));

  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(PORT, 'localhost', () => {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   PH Stock Dashboard                 ║');
  console.log(`║   http://localhost:${PORT}              ║`);
  console.log('║   Press Ctrl+C to stop               ║');
  console.log('╚══════════════════════════════════════╝');
  // Pre-fetch in background
  getQuotes().catch(() => {});
  getNews().catch(() => {});
  // Open browser
  setTimeout(() => {
    const { exec } = require('child_process');
    exec(`start http://localhost:${PORT}`);
  }, 1200);
});
