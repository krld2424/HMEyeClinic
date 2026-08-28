const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const todayDate = () => new Date().toISOString().slice(0, 10);

const isActivePayment = (payment) => payment?.data?.status !== 'reversed' && payment?.data?.status !== 'cancelled';

const lineTotal = (item) => {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);
  const discount = Number(item.discount || 0);
  const tax = Number(item.tax || 0);
  return money(Math.max(quantity * unitPrice - discount + tax, 0));
};

const normalizeInvoiceItems = (items) => {
  if (typeof items === 'string' && items.trim()) {
    return [{ description: items.trim(), quantity: 1, unitPrice: 0, discount: 0, tax: 0, lineTotal: 0 }];
  }
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const discount = Number(item.discount || 0);
    const tax = Number(item.tax || 0);
    return {
      description: String(item.description || item.name || item.sku || 'Item').trim(),
      quantity,
      unitPrice: money(unitPrice),
      discount: money(discount),
      tax: money(tax),
      lineTotal: lineTotal({ quantity, unitPrice, discount, tax }),
    };
  });
};

const invoiceTotalFromItems = (items) => money(normalizeInvoiceItems(items).reduce((sum, item) => sum + item.lineTotal, 0));

const invoiceStatus = (invoice, paid) => {
  const data = invoice.data || {};
  if (data.status === 'cancelled') return 'cancelled';
  const total = money(data.total || 0);
  const paidAmount = money(paid || 0);
  const balance = money(Math.max(total - paidAmount, 0));
  if (balance === 0 && total >= 0 && paidAmount >= total) return 'paid';
  if (data.dueDate && data.dueDate < todayDate() && balance > 0) return 'overdue';
  if (paidAmount > 0 && balance > 0) return 'partially-paid';
  return 'unpaid';
};

const daysOverdue = (invoice) => {
  const data = invoice.data || {};
  if (!data.dueDate || ['paid', 'cancelled'].includes(data.status)) return 0;
  const due = new Date(`${data.dueDate}T00:00:00`);
  const today = new Date(`${todayDate()}T00:00:00`);
  const days = Math.floor((today - due) / 86400000);
  return days > 0 ? days : 0;
};

export {
  money,
  todayDate,
  isActivePayment,
  lineTotal,
  normalizeInvoiceItems,
  invoiceTotalFromItems,
  invoiceStatus,
  daysOverdue,
};
