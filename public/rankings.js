// 同値は同順位（1, 1, 3）。元の結果配列を変更しない。
export function rankBy(rows, valueOf) {
  const sorted = rows.map(row => ({...row, value:valueOf(row)})).sort((a,b) => b.value-a.value);
  let rank = 0;
  return sorted.map((row,i) => {
    if (i===0 || row.value!==sorted[i-1].value) rank=i+1;
    return {...row,rank};
  });
}
export function customerCount(row, market) {
  return market==='total' ? row.customers : (row.markets?.[market]?.customers ?? (row.market===market ? row.customers : 0));
}
export function roundRanking(results, mode, market='total') {
  return rankBy(results, row => mode==='revenue' ? row.revenue : customerCount(row,market));
}
export function modelCompanies(results, model) {
  const rows=results.filter(row=>(row.businessModel||'paid')===model);
  // 無料モデルには価格の順位を付けない。
  return model==='free' ? rows : rankBy(rows,row=>row.price);
}
