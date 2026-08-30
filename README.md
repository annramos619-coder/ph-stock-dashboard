# PH Stock Market Dashboard

A local real-time dashboard for Philippine Stock Exchange (PSE) stocks and financial news.

## Features

- **Live PSE prices** — BDO, AREIT, RFM, RCR, DDMPR, VREIT, VLL, DNL, LTG, SGP
- **PSEi index** with live change
- **Top Gainers / Losers** from your watchlist
- **News feed** from BusinessWorld, Inquirer Business, PhilStar, Manila Bulletin
- **Stock-specific news tabs** — filter news by each ticker
- **Click any stock** for a detail modal with stats + related news
- **Auto-refresh** — prices every 5 min, news every 15 min

## Requirements

- [Node.js](https://nodejs.org/) (v18 or higher)

## How to Run

**Option 1 — Double-click launcher (Windows):**
```
START DASHBOARD.bat
```

**Option 2 — Terminal:**
```bash
node server.js
```

Then open your browser at: **http://localhost:8888**

## How It Works

- Prices are sourced from [phisix-api](https://phisix-api3.appspot.com/) — a free community API for PSE data
- News is pulled from RSS feeds of major Philippine financial publications
- Everything runs locally — no API keys, no subscriptions needed

## Data Sources

| Source | Data |
|--------|------|
| phisix-api3.appspot.com | Live PSE stock prices |
| BusinessWorld Online | Financial news |
| Inquirer Business | Financial news |
| PhilStar Business | Financial news |
| Manila Bulletin Business | Financial news |

## Project Structure

```
├── server.js              # Node.js server (prices + news APIs + serves HTML)
├── START DASHBOARD.bat    # Windows double-click launcher
└── ph-stock-dashboard.html  # Standalone HTML (backup, limited by CORS)
```

## Customizing Your Watchlist

Edit the `WATCHLIST` array near the top of `server.js`:

```js
const WATCHLIST = [
  { ticker: 'BDO', yf: 'BDO', name: 'BDO Unibank', sector: 'bank', color: '#4f7cff' },
  // add more PSE tickers here...
];
```

Sector values: `bank`, `reit`, `fmcg`, `prop`, `other`
