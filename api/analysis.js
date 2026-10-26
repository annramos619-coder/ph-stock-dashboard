const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://www.investagrams.com/',
      },
      timeout: 12000,
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
  const ticker = (req.query?.ticker || '').toUpperCase();
  if (!ticker) return res.status(400).json({ error: 'ticker required' });

  try {
    const raw = await get(`https://webapi.investagrams.com/InvestaApi/Stock/ViewStock?stockCode=${ticker}&exchangeType=0`);
    const data = JSON.parse(raw);

    const f = data.StockFundamentalAnalysisInfo || {};
    const t = data.StockTechnicalAnalysisInfo || {};
    const h = data.LatestStockHistory || {};
    const info = data.StockInfo || {};

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');
    res.status(200).json({
      ticker,
      name: info.StockName,
      sector: info.SectorString,
      subsector: info.SubsectorString,
      // Price
      price: h.Last,
      change: h.Change,
      changePct: h.ChangePercentage,
      open: h.Open,
      high: h.High,
      low: h.Low,
      high52: t.High52,
      low52: t.Low52,
      volume: h.Volume,
      marketCap: h.MarketCap,
      netForeign: h.NetForeign,
      // Fundamentals
      eps: f.EarningsPerShare,
      epsGrowth: f.EarningsPerShareGrowth,
      pe: f.PriceEarningsRatio,
      peType: f.PriceEarningsRatioTypeString,
      pb: f.PriceBookValue,
      pbType: f.PriceToBookRatioTypeString,
      bookValue: f.BookValue,
      roe: f.ReturnOnEquity,
      deRatio: f.DebtToEquityRatio,
      deType: f.DebtToEquityRatioTypeString,
      currentRatio: f.CurrentRatio,
      currentRatioType: f.CurrentRatioTypeString,
      netIncome: f.NetIncome,
      netIncomeGrowth: f.NetIncomeGrowth,
      totalRevenue: f.TotalRevenue,
      totalLiabilities: f.TotalLiabilities,
      totalAssets: f.TotalAssets,
      equity: f.StockholdersEquity,
      divYield: f.CashDivYieldTTM,
      isConsistentDiv: f.IsConsistentCashDiv,
      quarter: f.QuarterYearDisplay,
      // Technical
      recommendation: t.Recommendation,
      trendShort: t.TrendShort,
      trendMedium: t.TrendMedium,
      trendLong: t.TrendLong,
      support1: t.Support1,
      support2: t.Support2,
      resistance1: t.Resistance1,
      resistance2: t.Resistance2,
      ma20: t.Ma20,
      ma20Trend: t.Ma20Trend,
      ma50: t.Ma50,
      ma50Trend: t.Ma50Trend,
      ma100: t.Ma100,
      ma100Trend: t.Ma100Trend,
      ma200: t.Ma200,
      ma200Trend: t.Ma200Trend,
      rsi: t.Rsi14,
      rsiTrend: t.RsiTrendString,
      macdMomentum: t.MacdMomentumTrendString,
      atrVolatility: t.Atr14PercentageVolatilityLevel,
      adxTrend: t.Adx14TrendString,
      // Returns
      ytd: t.YearToDate,
      mtd: t.MonthToDate,
      wtd: t.WeekToDate,
      r7d: t.Return7Days,
      r1y: t.Return1Year,
      r3y: t.Return3Years,
      // Chart
      chart20dUrl: t.Chart20DaysImageUrl,
      chart50dUrl: t.Chart50DaysImageUrl,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
