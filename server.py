"""
PH Stock Dashboard - Local Server
Run: python server.py
Then open: http://localhost:8888
"""

import json, threading, webbrowser, time, os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import urlopen, Request
from urllib.parse import urlencode
from urllib.error import URLError
import xml.etree.ElementTree as ET

PORT = 8888

WATCHLIST = [
    ('BDO',   'BDO.PS',   'BDO Unibank',           'bank'),
    ('AREIT', 'AREIT.PS', 'Ayala REIT',             'reit'),
    ('RFM',   'RFM.PS',   'RFM Corporation',        'fmcg'),
    ('RCR',   'RCR.PS',   'RL Commercial REIT',     'reit'),
    ('DDMPR', 'DDMPR.PS', 'DoubleDragon REIT',      'reit'),
    ('VREIT', 'VREIT.PS', 'Villar REIT',            'reit'),
    ('VLL',   'VLL.PS',   'Vista Land',             'prop'),
    ('DNL',   'DNL.PS',   'D&L Industries',         'fmcg'),
    ('LTG',   'LTG.PS',   'LT Group',              'other'),
    ('SGP',   'SGP.PS',   'Synergy Grid & Dev.',    'other'),
]

NEWS_FEEDS = [
    ('https://www.bworldonline.com/feed/',            'BusinessWorld', 'src-bw'),
    ('https://business.inquirer.net/feed',            'Inquirer Biz',  'src-inq'),
    ('https://www.philstar.com/rss/business',         'PhilStar',      'src-pbs'),
    ('https://mb.com.ph/category/business/feed/',     'Manila Bulletin','src-mb'),
]

_cache = {'quotes': None, 'news': None, 'quotes_ts': 0, 'news_ts': 0}
QUOTES_TTL = 5 * 60   # 5 min
NEWS_TTL   = 15 * 60  # 15 min


def yf_fetch():
    symbols = ','.join([s[1] for s in WATCHLIST] + ['^PSEi'])
    url = (
        f'https://query1.finance.yahoo.com/v7/finance/quote'
        f'?symbols={symbols}'
        f'&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,'
        f'regularMarketVolume,fiftyTwoWeekLow,fiftyTwoWeekHigh,'
        f'regularMarketDayLow,regularMarketDayHigh,shortName'
    )
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json',
    }
    req = Request(url, headers=headers)
    with urlopen(req, timeout=10) as r:
        data = json.loads(r.read())
    return {q['symbol']: q for q in data['quoteResponse']['result']}


def get_quotes():
    now = time.time()
    if _cache['quotes'] and now - _cache['quotes_ts'] < QUOTES_TTL:
        return _cache['quotes']
    try:
        data = yf_fetch()
        _cache['quotes'] = data
        _cache['quotes_ts'] = now
        print(f'[quotes] fetched {len(data)} symbols')
        return data
    except Exception as e:
        print(f'[quotes] error: {e}')
        return _cache['quotes'] or {}


def parse_rss(url, source, cls):
    req = Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    items = []
    try:
        with urlopen(req, timeout=8) as r:
            root = ET.fromstring(r.read())
        ns = {'atom': 'http://www.w3.org/2005/Atom'}
        for item in root.iter('item'):
            def get(tag):
                el = item.find(tag)
                return el.text.strip() if el is not None and el.text else ''
            title = get('title')
            link  = get('link')
            desc  = get('description')
            date  = get('pubDate')
            if title and link:
                import re
                clean = re.sub('<[^>]+>', '', desc)[:180]
                items.append({'title': title, 'link': link,
                               'excerpt': clean, 'date': date,
                               'source': source, 'cls': cls})
    except Exception as e:
        print(f'[news] {source}: {e}')
    return items


def get_news():
    now = time.time()
    if _cache['news'] and now - _cache['news_ts'] < NEWS_TTL:
        return _cache['news']
    all_items = []
    for url, source, cls in NEWS_FEEDS:
        all_items.extend(parse_rss(url, source, cls))
    _cache['news'] = all_items
    _cache['news_ts'] = now
    print(f'[news] fetched {len(all_items)} articles')
    return all_items


# ── HTML (inline so only one file needed) ───────────────────────────────────
HTML = r"""<!DOCTYPE html>
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
.main{display:grid;grid-template-columns:1fr 380px;min-height:calc(100vh - 70px)}
@media(max-width:900px){.main{grid-template-columns:1fr}}
.left-panel{padding:20px;border-right:1px solid var(--border)}
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
.right-panel{display:flex;flex-direction:column}
.news-header{padding:20px 20px 0;border-bottom:1px solid var(--border)}
.news-tabs{display:flex;gap:2px;overflow-x:auto;padding-bottom:0}
.tab-btn{background:none;border:none;color:var(--muted);font-size:12px;font-weight:600;padding:8px 12px;cursor:pointer;border-radius:8px 8px 0 0;white-space:nowrap;border-bottom:2px solid transparent;transition:all .15s}
.tab-btn:hover{color:var(--text);background:rgba(79,124,255,.08)}
.tab-btn.active{color:var(--accent);border-bottom-color:var(--accent)}
.news-feed{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:12px;max-height:calc(100vh - 130px)}
.news-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px;cursor:pointer;transition:border-color .15s;text-decoration:none;color:inherit;display:block}
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
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;align-items:center;justify-content:center}
.modal-overlay.show{display:flex}
.modal{background:var(--card);border:1px solid var(--border);border-radius:16px;width:90vw;max-width:700px;max-height:85vh;overflow-y:auto;padding:24px;position:relative}
.modal-close{position:absolute;top:16px;right:16px;background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer}
.modal-title{font-size:20px;font-weight:700;margin-bottom:4px}
.modal-sub{font-size:13px;color:var(--muted);margin-bottom:20px}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:10px}
.status-dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:5px}
.status-live{background:var(--green);box-shadow:0 0 6px var(--green);animation:pulse 2s infinite}
.status-error{background:var(--red)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.footer{padding:12px 20px;border-top:1px solid var(--border);font-size:11px;color:var(--muted)}
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
      <tbody id="watchlist-body"><tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px">Loading...</td></tr></tbody>
    </table>
    <div class="divider"></div>
    <div class="gl-row">
      <div class="gl-card"><div class="gl-title">Top Gainers</div><div id="gl-gainers"><div style="color:var(--muted);font-size:12px">Loading...</div></div></div>
      <div class="gl-card"><div class="gl-title">Top Losers</div><div id="gl-losers"><div style="color:var(--muted);font-size:12px">Loading...</div></div></div>
    </div>
  </div>
  <div class="right-panel">
    <div class="news-header">
      <div class="news-tabs" id="news-tabs">
        <button class="tab-btn active" onclick="filterNews('all')" data-tab="all">All News</button>
        <button class="tab-btn" onclick="filterNews('BDO')" data-tab="BDO">BDO</button>
        <button class="tab-btn" onclick="filterNews('AREIT')" data-tab="AREIT">AREIT</button>
        <button class="tab-btn" onclick="filterNews('RFM')" data-tab="RFM">RFM</button>
        <button class="tab-btn" onclick="filterNews('RCR')" data-tab="RCR">RCR</button>
        <button class="tab-btn" onclick="filterNews('DDMPR')" data-tab="DDMPR">DDMPR</button>
        <button class="tab-btn" onclick="filterNews('VREIT')" data-tab="VREIT">VREIT</button>
        <button class="tab-btn" onclick="filterNews('VLL')" data-tab="VLL">VLL</button>
        <button class="tab-btn" onclick="filterNews('DNL')" data-tab="DNL">DNL</button>
        <button class="tab-btn" onclick="filterNews('LTG')" data-tab="LTG">LTG</button>
        <button class="tab-btn" onclick="filterNews('SGP')" data-tab="SGP">SGP</button>
      </div>
    </div>
    <div class="news-feed" id="news-feed"><div class="news-loading">Loading news...</div></div>
    <div class="footer">Prices via Yahoo Finance · News from BusinessWorld, Inquirer, PhilStar, Manila Bulletin · ~15 min delayed</div>
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
  {ticker:'BDO',  yf:'BDO.PS',  name:'BDO Unibank',        sector:'bank', color:'#4f7cff'},
  {ticker:'AREIT',yf:'AREIT.PS',name:'Ayala REIT',          sector:'reit', color:'#7c5cfc'},
  {ticker:'RFM',  yf:'RFM.PS',  name:'RFM Corporation',     sector:'fmcg', color:'#00c896'},
  {ticker:'RCR',  yf:'RCR.PS',  name:'RL Commercial REIT',  sector:'reit', color:'#7c5cfc'},
  {ticker:'DDMPR',yf:'DDMPR.PS',name:'DoubleDragon REIT',   sector:'reit', color:'#7c5cfc'},
  {ticker:'VREIT',yf:'VREIT.PS',name:'Villar REIT',         sector:'reit', color:'#7c5cfc'},
  {ticker:'VLL',  yf:'VLL.PS',  name:'Vista Land',          sector:'prop', color:'#f5c542'},
  {ticker:'DNL',  yf:'DNL.PS',  name:'D&L Industries',      sector:'fmcg', color:'#00c896'},
  {ticker:'LTG',  yf:'LTG.PS',  name:'LT Group',            sector:'other',color:'#ff7043'},
  {ticker:'SGP',  yf:'SGP.PS',  name:'Synergy Grid & Dev.', sector:'other',color:'#26c6da'},
];
const SECTOR_BADGE={reit:'badge-reit',bank:'badge-bank',fmcg:'badge-fmcg',prop:'badge-prop',other:'badge-other'};
const SECTOR_LABEL={reit:'REIT',bank:'BANK',fmcg:'FMCG',prop:'PROP',other:'HOLD'};
let allNews=[],priceData={},currentTab='all';

function fmt(n,d=2){return n==null||isNaN(n)?'—':Number(n).toLocaleString('en-PH',{minimumFractionDigits:d,maximumFractionDigits:d})}
function fmtVol(n){if(!n||isNaN(n))return '—';if(n>=1e9)return(n/1e9).toFixed(2)+'B';if(n>=1e6)return(n/1e6).toFixed(2)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'K';return n.toString()}
function timeAgo(d){const s=Math.floor((Date.now()-new Date(d))/1000);if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago'}
function cc(v){return v>0?'pos':v<0?'neg':'neu'}
function sg(v){return v>0?'+':''}

async function loadPrices(){
  try{
    const r=await fetch('/api/quotes');
    const data=await r.json();
    if(data.error){throw new Error(data.error)}
    priceData=data;
    const psei=data['^PSEi'];
    if(psei){
      document.getElementById('psei-val').textContent='₱'+fmt(psei.regularMarketPrice);
      const c=psei.regularMarketChange,cp=psei.regularMarketChangePercent;
      const el=document.getElementById('psei-chg');
      el.className='change '+cc(c);
      el.textContent=sg(c)+fmt(c)+' ('+sg(cp)+fmt(cp)+'%)';
    }
    let adv=0,dec=0,unc=0,rows='';
    WATCHLIST.forEach(s=>{
      const q=data[s.yf];
      if(!q){rows+=`<tr><td><div class="ticker-cell"><div class="ticker-icon" style="background:${s.color}">${s.ticker.slice(0,2)}</div><div><div class="ticker-name">${s.ticker}</div><div class="ticker-full">${s.name}</div></div></div></td><td colspan="5" style="color:var(--muted);font-size:12px;text-align:right">No data</td></tr>`;return;}
      const p=q.regularMarketPrice,c=q.regularMarketChange,cp=q.regularMarketChangePercent;
      const v=q.regularMarketVolume,l52=q.fiftyTwoWeekLow,h52=q.fiftyTwoWeekHigh;
      if(c>0)adv++;else if(c<0)dec++;else unc++;
      rows+=`<tr onclick="openModal('${s.ticker}')" style="cursor:pointer">
        <td><div class="ticker-cell"><div class="ticker-icon" style="background:${s.color}">${s.ticker.slice(0,2)}</div>
        <div><div class="ticker-name">${s.ticker} <span class="badge ${SECTOR_BADGE[s.sector]}">${SECTOR_LABEL[s.sector]}</span></div>
        <div class="ticker-full">${s.name}</div></div></div></td>
        <td class="price-cell">₱${fmt(p)}</td>
        <td class="change-cell ${cc(c)}">${sg(c)}${fmt(c)}</td>
        <td class="change-cell ${cc(cp)}">${sg(cp)}${fmt(cp)}%</td>
        <td class="vol-cell">${fmtVol(v)}</td>
        <td class="vol-cell" style="font-size:11px">₱${fmt(l52)} – ₱${fmt(h52)}</td>
      </tr>`;
    });
    document.getElementById('watchlist-body').innerHTML=rows;
    document.getElementById('stat-adv').textContent=adv;
    document.getElementById('stat-dec').textContent=dec;
    document.getElementById('stat-unc').textContent=unc;
    const sortable=WATCHLIST.map(s=>({...s,chgp:data[s.yf]?.regularMarketChangePercent||0})).filter(s=>data[s.yf]);
    const gainers=[...sortable].sort((a,b)=>b.chgp-a.chgp).slice(0,3);
    const losers=[...sortable].sort((a,b)=>a.chgp-b.chgp).slice(0,3);
    document.getElementById('gl-gainers').innerHTML=gainers.map(s=>`<div class="gl-item"><span>${s.ticker}</span><span class="pos">${sg(s.chgp)}${fmt(s.chgp)}%</span></div>`).join('');
    document.getElementById('gl-losers').innerHTML=losers.map(s=>`<div class="gl-item"><span>${s.ticker}</span><span class="neg">${fmt(s.chgp)}%</span></div>`).join('');
    document.getElementById('status-dot').className='status-dot status-live';
    document.getElementById('last-update-time').textContent='Updated '+new Date().toLocaleTimeString('en-PH');
  }catch(e){
    document.getElementById('watchlist-body').innerHTML=`<tr><td colspan="6" style="text-align:center;color:var(--red);padding:20px">⚠ ${e.message}</td></tr>`;
    document.getElementById('status-dot').className='status-dot status-error';
  }
}

async function loadNews(){
  document.getElementById('news-feed').innerHTML='<div class="news-loading">Fetching news...</div>';
  try{
    const r=await fetch('/api/news');
    allNews=await r.json();
    renderNews(currentTab);
  }catch(e){
    document.getElementById('news-feed').innerHTML='<div class="news-empty">⚠ Could not load news</div>';
  }
}

const KW={
  BDO:['BDO','BDO Unibank','Banco de Oro'],AREIT:['AREIT','Ayala REIT'],
  RFM:['RFM','RFM Corp','Cosmos Bottling'],RCR:['RCR','RL Commercial','Robinsons Land'],
  DDMPR:['DDMPR','DoubleDragon','DD Meridian'],VREIT:['VREIT','Villar REIT'],
  VLL:['VLL','Vista Land','Brittany','Camella'],DNL:['DNL','D&L Industries'],
  LTG:['LTG','LT Group','Lucio Tan','Philippine Airlines','PAL'],
  SGP:['SGP','Synergy Grid','National Grid'],
};
function matches(a,t){const h=(a.title+' '+a.excerpt).toLowerCase();return(KW[t]||[t]).some(k=>h.includes(k.toLowerCase()))}

function renderNews(tab){
  currentTab=tab;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  const list=tab==='all'?allNews:allNews.filter(a=>matches(a,tab));
  if(!list.length){document.getElementById('news-feed').innerHTML=`<div class="news-empty">No recent news for ${tab}.</div>`;return;}
  document.getElementById('news-feed').innerHTML=list.slice(0,30).map(a=>{
    const tags=WATCHLIST.filter(s=>matches(a,s.ticker)).map(s=>`<span class="news-tag">${s.ticker}</span>`).join('');
    return `<a class="news-card" href="${a.link}" target="_blank" rel="noopener">
      <div class="news-meta"><span class="news-source ${a.cls}">${a.source}</span><span class="news-time">${a.date?timeAgo(a.date):''}</span></div>
      <div class="news-title">${a.title}</div>
      ${a.excerpt?`<div class="news-excerpt">${a.excerpt}...</div>`:''}
      ${tags?`<div class="news-tags">${tags}</div>`:''}
    </a>`;
  }).join('');
}
function filterNews(t){renderNews(t)}

function openModal(ticker){
  const s=WATCHLIST.find(x=>x.ticker===ticker),q=priceData[s?.yf];
  if(!s||!q)return;
  document.getElementById('modal-title').textContent=`${ticker} — ${s.name}`;
  document.getElementById('modal-sub').textContent=`${SECTOR_LABEL[s.sector]} · PSE`;
  const p=q.regularMarketPrice,c=q.regularMarketChange,cp=q.regularMarketChangePercent;
  document.getElementById('modal-content').innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">
      <div style="background:var(--card2);border-radius:10px;padding:14px"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">PRICE</div>
        <div style="font-size:26px;font-weight:700">₱${fmt(p)}</div>
        <div style="font-size:14px;font-weight:600" class="${cc(c)}">${sg(c)}${fmt(c)} (${sg(cp)}${fmt(cp)}%)</div></div>
      <div style="background:var(--card2);border-radius:10px;padding:14px"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">DAY RANGE</div>
        <div style="font-size:15px;font-weight:600">₱${fmt(q.regularMarketDayLow)} – ₱${fmt(q.regularMarketDayHigh)}</div></div>
      <div style="background:var(--card2);border-radius:10px;padding:14px"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">52W RANGE</div>
        <div style="font-size:15px;font-weight:600">₱${fmt(q.fiftyTwoWeekLow)} – ₱${fmt(q.fiftyTwoWeekHigh)}</div></div>
    </div>
    <div style="background:var(--card2);border-radius:10px;padding:14px;margin-bottom:20px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">VOLUME</div>
      <div style="font-size:20px;font-weight:700">${fmtVol(q.regularMarketVolume)}</div></div>
    <div class="section-title">Related News</div>
    ${allNews.filter(a=>matches(a,ticker)).slice(0,5).map(a=>`
      <a class="news-card" href="${a.link}" target="_blank" rel="noopener" style="margin-bottom:10px;display:block">
        <div class="news-meta"><span class="news-source ${a.cls}">${a.source}</span><span class="news-time">${a.date?timeAgo(a.date):''}</span></div>
        <div class="news-title">${a.title}</div></a>`).join('')||'<div style="color:var(--muted);font-size:13px">No specific news found.</div>'}
  `;
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
</html>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(HTML.encode())

        elif self.path == '/api/quotes':
            data = get_quotes()
            # Serialize only the fields we need
            out = {}
            for sym, q in data.items():
                out[sym] = {
                    'regularMarketPrice':         q.get('regularMarketPrice'),
                    'regularMarketChange':         q.get('regularMarketChange'),
                    'regularMarketChangePercent':  q.get('regularMarketChangePercent'),
                    'regularMarketVolume':         q.get('regularMarketVolume'),
                    'fiftyTwoWeekLow':             q.get('fiftyTwoWeekLow'),
                    'fiftyTwoWeekHigh':            q.get('fiftyTwoWeekHigh'),
                    'regularMarketDayLow':         q.get('regularMarketDayLow'),
                    'regularMarketDayHigh':        q.get('regularMarketDayHigh'),
                }
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(out).encode())

        elif self.path == '/api/news':
            data = get_news()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())

        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, fmt, *args):
        pass  # suppress request logs


def open_browser():
    time.sleep(1.2)
    webbrowser.open(f'http://localhost:{PORT}')


if __name__ == '__main__':
    print(f'╔══════════════════════════════════════╗')
    print(f'║   PH Stock Dashboard                 ║')
    print(f'║   http://localhost:{PORT}              ║')
    print(f'║   Press Ctrl+C to stop               ║')
    print(f'╚══════════════════════════════════════╝')

    # Pre-fetch in background
    threading.Thread(target=get_quotes, daemon=True).start()
    threading.Thread(target=get_news,   daemon=True).start()

    # Open browser
    threading.Thread(target=open_browser, daemon=True).start()

    server = HTTPServer(('localhost', PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
