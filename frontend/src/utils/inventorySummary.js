const isStoredBalance = (value) => value !== null
  && value !== undefined
  && String(value).trim() !== ''
  && Number.isFinite(Number(value));

export function summarizeInventoryByBrand(records) {
  const totalsByBrand = new Map();

  for (const { data = {} } of records || []) {
    const brand = String(data.brand || '').trim();
    const material = String(data.material || '').trim().toUpperCase();
    if (!brand || material === 'SUBTOTAL' || !isStoredBalance(data.beginningBalance) || !isStoredBalance(data.endingBalance)) continue;

    const totals = totalsByBrand.get(brand) || { beginningBalance: 0, endingBalance: 0 };
    totals.beginningBalance += Number(data.beginningBalance);
    totals.endingBalance += Number(data.endingBalance);
    totalsByBrand.set(brand, totals);
  }

  return [...totalsByBrand.entries()]
    .map(([brand, totals]) => ({ brand, ...totals }))
    .sort((first, second) => first.brand.localeCompare(second.brand));
}
