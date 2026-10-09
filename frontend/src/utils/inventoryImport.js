const requiredFields = [
  'brand',
  'material',
  'itemcode',
  'colorcode',
  'beginningbalance',
  'receipt',
  'sold',
];

const normalizeHeader = (value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');

export function parseInventoryImportRows(rows, brands, materials) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('The spreadsheet must include a header row.');
  }

  const headers = rows[0].map(normalizeHeader);
  const columns = new Map(headers.map((header, index) => [header, index]));
  const missing = requiredFields.filter((field) => !columns.has(field));
  if (missing.length) {
    throw new Error(`Missing required columns: ${missing.join(', ')}.`);
  }

  const normalizeChoice = (value, choices) => {
    const text = String(value ?? '').trim();
    return choices.find((choice) => choice.toLowerCase() === text.toLowerCase());
  };
  const records = rows.slice(1).filter((row) => row.some((value) => String(value ?? '').trim())).map((row, index) => {
    const value = (field) => row[columns.get(field)];
    const brand = normalizeChoice(value('brand'), brands);
    const material = normalizeChoice(value('material'), materials);
    const itemCode = String(value('itemcode') ?? '').trim();
    const colorCode = String(value('colorcode') ?? '').trim();
    const color = String(value('color') ?? '').trim();
    const rawBeginningBalance = value('beginningbalance');
    const beginningBalance = Number(rawBeginningBalance);
    const optionalQuantities = ['receipt', 'sold'].map(value).map((quantity) => (
      quantity === null || quantity === undefined || String(quantity).trim() === '' ? 0 : Number(quantity)
    ));

    if (!brand || !material || !itemCode) {
      throw new Error(`Invalid Brand, Material, or text value on row ${index + 2}.`);
    }
    if (rawBeginningBalance === null || rawBeginningBalance === undefined || String(rawBeginningBalance).trim() === ''
      || !Number.isFinite(beginningBalance) || beginningBalance < 0
      || optionalQuantities.some((quantity) => !Number.isFinite(quantity) || quantity < 0)) {
      throw new Error(`Beginning Balance, Receipt, and Sold must be non-negative numbers on row ${index + 2}.`);
    }

    const [receipt, sold] = optionalQuantities;
    return {
      brand,
      material,
      itemCode,
      colorCode,
      color,
      beginningBalance,
      receipt,
      sold,
      endingBalance: beginningBalance + receipt - sold,
    };
  });

  if (!records.length) throw new Error('The spreadsheet has no inventory rows to import.');
  return records;
}