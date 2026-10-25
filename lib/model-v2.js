// 独自の授業用モデル。原教材のアルゴリズムの再現ではありません。
export const RULES = Object.freeze({
  version: 2, rounds: 3, maxCompanies: 30, customersPerCompany: 6000,
  baseCost: 500000, variableCost: 100, freeRevenue: 180, conversionRate: 0.4,
  prices: [300, 500, 700], investments: [0, 500000, 1000000],
  modelReach: { free: 3, freemium: 1.8, paid: 1 },
});

// 前版の保存データは「有料・単一市場」として読み出せる。
export function normalizeDecision(d) {
  return { iosPercent: d.iosPercent ?? (d.market === 'android' ? 0 : 100),
    businessModel: d.businessModel ?? 'paid', price: d.price,
    development: d.development, advertising: d.advertising };
}
export function validDecision(d) {
  return !!d && Number.isInteger(d.iosPercent) && d.iosPercent >= 0 && d.iosPercent <= 100
    && ['free', 'freemium', 'paid'].includes(d.businessModel)
    && (d.businessModel === 'free' ? d.price === 0 : RULES.prices.includes(d.price))
    && RULES.investments.includes(d.development) && RULES.investments.includes(d.advertising);
}
export function unitRevenue(d) {
  return d.businessModel === 'free' ? RULES.freeRevenue
    : d.businessModel === 'freemium' ? d.price * RULES.conversionRate : d.price;
}
export function score(d, market) {
  const ios = market === 'ios';
  const effort = (ios ? d.iosPercent : 100 - d.iosPercent) / 100;
  const priceFactor = d.businessModel === 'free' ? 1
    : (500 / d.price) ** ((ios ? 0.6 : 1.5) * (d.businessModel === 'freemium' ? 0.5 : 1));
  return effort * RULES.modelReach[d.businessModel] * priceFactor
    * (1 + (ios ? 0.8 : 0.35) * d.development / 500000)
    * (1 + 0.4 * d.advertising / 500000);
}
export function economics(d, customers) {
  const fixedCost = RULES.baseCost + d.development + d.advertising;
  const variableCost = customers * RULES.variableCost;
  const revenuePerCustomer = unitRevenue(d);
  const revenue = customers * revenuePerCustomer;
  return { customers, fixedCost, variableCost, revenue, revenuePerCustomer,
    cost: fixedCost + variableCost, profit: revenue - fixedCost - variableCost,
    breakEven: Math.ceil(fixedCost / (revenuePerCustomer - RULES.variableCost)) };
}
export function settle(companies, rawDecisions) {
  const decisions = Object.fromEntries(Object.entries(rawDecisions).map(([id,d]) => [id, normalizeDecision(d)]));
  if (!companies.length || companies.some(c => !validDecision(decisions[c.id]))) throw new Error('全社の有効な意思決定が必要です。');
  const pool = companies.length * RULES.customersPerCompany / 2;
  const allocation = Object.fromEntries(companies.map(c => [c.id, {}]));
  for (const market of ['ios', 'android']) {
    const entrants = companies.filter(c => score(decisions[c.id], market) > 0);
    const totalScore = entrants.reduce((sum,c) => sum + score(decisions[c.id],market), 0);
    const shares = entrants.map(c => {
      const raw = pool * score(decisions[c.id],market) / totalScore;
      return { company:c, customers:Math.floor(raw), remainder:raw-Math.floor(raw) };
    });
    const remaining = pool - shares.reduce((sum,s) => sum+s.customers,0);
    const ordered = [...shares].sort((a,b) => b.remainder-a.remainder);
    for(let i=0; i<remaining && ordered.length; i++) ordered[i].customers++;
    for(const c of companies) allocation[c.id][market] = {
      customers: shares.find(s=>s.company.id===c.id)?.customers || 0,
      competitors: entrants.length, score: score(decisions[c.id],market),
    };
  }
  const results = companies.map(c => {
    const d=decisions[c.id], markets=allocation[c.id];
    return { companyId:c.id, name:c.name, ...d, markets,
      ...economics(d,markets.ios.customers+markets.android.customers) };
  });
  return { results, marketPool:pool, unserved:companies.length*RULES.customersPerCompany-results.reduce((sum,r)=>sum+r.customers,0) };
}
export function ranking(companies, history) {
  const rows = companies.map(c => ({companyId:c.id,name:c.name,
    profit:history.reduce((sum,h)=>sum+(h.results.find(r=>r.companyId===c.id)?.profit||0),0)}));
  rows.sort((a,b)=>b.profit-a.profit||a.name.localeCompare(b.name,'ja'));
  rows.forEach((r,i)=>{r.rank=i&&r.profit===rows[i-1].profit?rows[i-1].rank:i+1;});
  return rows;
}
