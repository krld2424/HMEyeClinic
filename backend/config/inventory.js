const inventoryBrands = [
  'ADIDAS', 'ALTER EGO', 'BABY', 'DALE AND ADY', 'FISHER PRICE', 'HYPE!', 'IOS',
  'JECKSEN', 'JECKSEN KIDS', 'KIDS', 'LAFONT', "LET'S GROOVE", 'MUSTAFA', 'PROMO',
  'RC', 'SEZEN', 'TOKYOFLEX', 'VALETTE', 'YOKOTA', 'YORK',
];

const inventoryMaterials = [
  'Acetate', 'Alloy Metal', 'Aviator', 'Cats Eye', 'Clubmaster', 'Combination',
  'Double Bar', 'Injected Metal on Temple', 'Light', 'Metal', 'Oval', 'Oversize',
  'Oversize Square', 'Plastic', 'Sports', 'Stainless', 'SUBTOTAL', 'Titanium',
  'TR Metal', 'TR90', 'Ultem', 'Women', 'Wood',
];

const isInventoryNumber = (value) => value !== '' && value !== null && value !== undefined
  && Number.isFinite(Number(value)) && Number(value) >= 0;

const endingBalance = (data) => Number(data.beginningBalance || 0) + Number(data.receipt || 0) - Number(data.sold || 0);

const normalizeInventoryData = (data, { migrate = false } = {}) => {
  const beginningBalance = isInventoryNumber(data.beginningBalance)
    ? Number(data.beginningBalance)
    : migrate && isInventoryNumber(data.quantity) ? Number(data.quantity) : 0;
  const receipt = isInventoryNumber(data.receipt) ? Number(data.receipt) : 0;
  const sold = isInventoryNumber(data.sold) ? Number(data.sold) : 0;
  return {
    brand: inventoryBrands.includes(data.brand) ? data.brand : '',
    material: inventoryMaterials.includes(data.material) ? data.material : '',
    itemCode: String(data.itemCode || (migrate ? data.sku : '') || '').trim(),
    colorCode: String(data.colorCode || '').trim(),
    color: String(data.color || '').trim(),
    beginningBalance,
    receipt,
    sold,
    endingBalance: beginningBalance + receipt - sold,
  };
};

export {
  inventoryBrands,
  inventoryMaterials,
  isInventoryNumber,
  endingBalance,
  normalizeInventoryData,
};
