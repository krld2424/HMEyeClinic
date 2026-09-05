import express from 'express';
import mongoose from 'mongoose';
import ClinicOperation from '../models/ClinicOperation.js';
import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';
import InvoiceTemplate from '../models/InvoiceTemplate.js';
import { requireAuth, allowRoles } from '../middleware/auth.js';
import { sendPaymentReminder } from '../config/mailer.js';
import { broadcastRealtimeEvent } from '../config/realtime.js';
import { inventoryBrands, inventoryMaterials, isInventoryNumber, normalizeInventoryData } from '../config/inventory.js';
import {
  money,
  todayDate,
  isActivePayment,
  normalizeInvoiceItems,
  invoiceTotalFromItems,
  invoiceStatus,
  daysOverdue,
} from '../utils/billing.js';

const router = express.Router();
const operationTypes = [
  'supplier',
  'purchase-order',
  'receiving',
  'inventory-item',
  'stock-in',
  'stock-out',
  'stock-adjustment',
  'stock-reservation',
  'stock-return',
  'stock-transfer',
  'invoice',
  'payment',
];
const inventoryChangeTypes = ['receiving', 'stock-in', 'stock-out', 'stock-adjustment', 'stock-reservation', 'stock-return', 'stock-transfer'];

router.use(requireAuth, allowRoles('owner'));

const isPositiveNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const isNonNegativeNumber = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;

const validateItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) return 'At least one item is required.';
  if (items.some((item) => !item || (!item.inventoryItemId && !item.sku) || !isPositiveNumber(item.quantity))) {
    return 'Each item requires an inventoryItemId or sku and a positive quantity.';
  }
  return null;
};

const validateRecord = (recordType, data) => {
  if (!data || typeof data !== 'object') return 'Record data is required.';

  if (recordType === 'supplier' && !data.name) return 'Supplier name is required.';
  if (recordType === 'supplier' && data.phone && !/^\+63 \d{3}-\d{3}-\d{4}$/.test(data.phone)) return 'Contact number must use +63 000-000-0000 format.';
  if (recordType === 'purchase-order' && ((!data.supplierId && !data.supplierName) || validateItems(data.items))) {
    return 'Purchase orders require a supplier and at least one item.';
  }
  if (recordType === 'inventory-item') {
    if (!inventoryBrands.includes(data.brand)) return 'Choose a valid brand.';
    if (!inventoryMaterials.includes(data.material)) return 'Choose a valid material.';
    if (!data.itemCode || !data.colorCode || !data.color) return 'Brand, material, item code, color code, and color are required.';
    if (![data.beginningBalance, data.receipt, data.sold].every(isInventoryNumber)) return 'Beginning Balance, Receipt, and Sold must be non-negative numbers.';
  }
  if (inventoryChangeTypes.includes(recordType) && validateItems(data.items)) return validateItems(data.items);
  if (recordType === 'receiving' && !data.reference) return 'Receiving requires a unique reference.';
  if (recordType === 'invoice') {
    if (!data.patientName && !data.patientId) return 'Invoices require a customer.';
    const items = normalizeInvoiceItems(data.items);
    if (!items.length || items.some((item) => !item.description || !isPositiveNumber(item.quantity))) {
      return 'Invoices require at least one service or product with a quantity.';
    }
  }
  if (recordType === 'payment' && (!data.invoiceId || !isPositiveNumber(data.amount))) {
    return 'Payments require an invoice and a positive amount.';
  }
  return null;
};

const nextDocumentNumber = async (recordType, prefix) => {
  const year = new Date().getFullYear();
  const start = `${prefix}-${year}-`;
  const latest = await ClinicOperation.find({ recordType, operationKey: new RegExp(`^${start}`) }).sort({ operationKey: -1 }).limit(1);
  const last = latest[0]?.operationKey || '';
  const next = Number(last.slice(start.length) || 0) + 1;
  return `${start}${String(next).padStart(4, '0')}`;
};

// The billing form can retain a previous hidden template ID after a template
// has been replaced. There is only one active template, so safely resolve a
// missing but valid ID to the current default instead of rejecting the invoice.
const resolveInvoiceTemplate = async (templateId) => {
  if (templateId && !mongoose.isValidObjectId(templateId)) throw new Error('Invalid invoice template.');
  return (templateId ? await InvoiceTemplate.findById(templateId) : null)
    || await InvoiceTemplate.findOne({ isDefault: true });
};

const refreshInvoice = async (invoiceId) => {
  if (!mongoose.isValidObjectId(invoiceId)) throw new Error('Invalid invoiceId.');
  const invoice = await ClinicOperation.findOne({ _id: invoiceId, recordType: 'invoice' });
  if (!invoice) throw new Error('Invoice not found.');
  const payments = await ClinicOperation.find({ recordType: 'payment', 'data.invoiceId': invoiceId.toString() });
  const paid = money(payments.filter(isActivePayment).reduce((sum, payment) => sum + Number(payment.data.amount || 0), 0));
  const items = normalizeInvoiceItems(invoice.data.items);
  const computedTotal = items.some((item) => item.unitPrice > 0 || item.lineTotal > 0) ? invoiceTotalFromItems(items) : money(invoice.data.total || 0);
  const total = computedTotal || money(invoice.data.total || 0);
  const balance = money(Math.max(total - paid, 0));
  const status = invoiceStatus({ data: { ...invoice.data, total } }, paid);
  invoice.data = {
    ...invoice.data,
    items,
    total,
    paid,
    balance,
    status,
    amountPaid: paid,
    remainingBalance: balance,
  };
  await invoice.save();
  return invoice;
};

const inventoryFilter = (item) => {
  if (item.inventoryItemId && mongoose.isValidObjectId(item.inventoryItemId)) {
    return { _id: item.inventoryItemId, recordType: 'inventory-item' };
  }
  return { recordType: 'inventory-item', $or: [{ 'data.itemCode': item.itemCode || item.sku }, { 'data.sku': item.sku }] };
};

const applyInventoryChange = async (recordType, items, metadata = {}) => {
  const operations = [];
  const changes = [];
  for (const item of items) {
    const filter = inventoryFilter(item);
    const inventoryItem = await ClinicOperation.findOne(filter);
    if (!inventoryItem) throw new Error(`Inventory item not found: ${item.inventoryItemId || item.sku}.`);

    const currentQuantity = Number(inventoryItem.data.endingBalance ?? inventoryItem.data.quantity ?? 0);
    const quantity = Number(item.quantity);
    const currentReserved = Number(inventoryItem.data.reserved || 0);
    let nextQuantity = quantity;
    let nextReserved = currentReserved;
    if (['receiving', 'stock-in', 'stock-return'].includes(recordType)) nextQuantity = currentQuantity + quantity;
    if (recordType === 'stock-out') nextQuantity = currentQuantity - quantity;
    if (recordType === 'stock-reservation') {
      nextQuantity = currentQuantity - quantity;
      nextReserved = currentReserved + quantity;
    }
    if (recordType === 'stock-adjustment') {
      nextQuantity = item.adjustmentType === 'set'
        ? quantity
        : currentQuantity + (item.adjustmentType === 'decrease' ? -quantity : quantity);
    }
    if (recordType === 'stock-transfer') nextQuantity = currentQuantity - quantity;
    if (nextQuantity < 0) throw new Error(`Insufficient stock for ${inventoryItem.data.name}.`);
    if (nextReserved < 0) throw new Error(`Reserved stock cannot be negative for ${inventoryItem.data.name}.`);

    const nextReceipt = Number(inventoryItem.data.receipt || 0) + (['receiving', 'stock-in', 'stock-return'].includes(recordType) ? quantity : 0);
    const nextSold = Number(inventoryItem.data.sold || 0) + (['stock-out', 'stock-reservation', 'stock-transfer'].includes(recordType) ? quantity : 0);
    const inventoryUpdate = { 'data.endingBalance': nextQuantity, 'data.receipt': nextReceipt, 'data.sold': nextSold, 'data.reserved': nextReserved };
    if (recordType === 'receiving' && metadata.batchLotNumber) inventoryUpdate['data.batchLotNumber'] = metadata.batchLotNumber;
    if (recordType === 'receiving' && metadata.expirationDate) inventoryUpdate['data.expirationDate'] = metadata.expirationDate;
    operations.push({
      updateOne: {
        filter: { _id: inventoryItem._id, recordType: 'inventory-item', 'data.endingBalance': currentQuantity },
        update: { $set: inventoryUpdate },
      },
    });
    changes.push({
      ...item,
      inventoryItemId: String(inventoryItem._id),
      sku: inventoryItem.data.sku,
      itemName: inventoryItem.data.itemCode,
      brand: inventoryItem.data.brand,
      material: inventoryItem.data.material,
      itemCode: inventoryItem.data.itemCode,
      colorCode: inventoryItem.data.colorCode,
      color: inventoryItem.data.color,
      beginningBalance: inventoryItem.data.beginningBalance,
      receipt: nextReceipt,
      sold: nextSold,
      endingBalance: nextQuantity,
      previousStock: currentQuantity,
      newStock: nextQuantity,
      previousReserved: currentReserved,
      newReserved: nextReserved,
    });
  }

  const result = await ClinicOperation.bulkWrite(operations);
  if (result.modifiedCount !== items.length) throw new Error('Inventory changed while this operation was being processed.');
  return changes;
};

const reverseInventoryChange = async (recordType, items) => {
  const reverseType = ['receiving', 'stock-in', 'stock-return'].includes(recordType) ? 'stock-out' : 'stock-in';
  if (recordType === 'stock-adjustment') {
    throw new Error('Stock adjustments must be corrected with a new adjustment rather than deleted.');
  }
  await applyInventoryChange(reverseType, items);
};

router.get('/', async (req, res) => {
  try {
    if (req.query.type && !operationTypes.includes(req.query.type)) {
      return res.status(400).json({ message: 'Invalid operation type.' });
    }
    const filter = operationTypes.includes(req.query.type) ? { recordType: req.query.type } : {};
    const records = await ClinicOperation.find(filter).populate('createdBy', 'name role email').sort({ createdAt: -1 });
    if (req.query.type === 'invoice') {
      await Promise.all(records.map((record) => refreshInvoice(record._id).catch(() => record)));
      const refreshed = await ClinicOperation.find({ recordType: 'invoice' }).populate('createdBy', 'name role email').sort({ createdAt: -1 });
      return res.status(200).json({ records: refreshed.map((record) => ({ ...record.toObject(), daysOverdue: daysOverdue(record) })) });
    }
    return res.status(200).json({ records });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load clinic operations.', error: error.message });
  }
});

router.get('/billing/summary', async (_req, res) => {
  try {
    const [invoices, payments] = await Promise.all([
      ClinicOperation.find({ recordType: 'invoice' }),
      ClinicOperation.find({ recordType: 'payment' }),
    ]);
    await Promise.all(invoices.map((invoice) => refreshInvoice(invoice._id).catch(() => invoice)));
    const freshInvoices = await ClinicOperation.find({ recordType: 'invoice' });
    const activePayments = payments.filter(isActivePayment);
    const totalInvoiced = money(freshInvoices.filter((invoice) => invoice.data.status !== 'cancelled').reduce((sum, invoice) => sum + Number(invoice.data.total || 0), 0));
    const totalCollected = money(activePayments.reduce((sum, payment) => sum + Number(payment.data.amount || 0), 0));
    const outstanding = money(freshInvoices.filter((invoice) => !['paid', 'cancelled'].includes(invoice.data.status)).reduce((sum, invoice) => sum + Number(invoice.data.balance || 0), 0));
    const overdueAmount = money(freshInvoices.filter((invoice) => invoice.data.status === 'overdue').reduce((sum, invoice) => sum + Number(invoice.data.balance || 0), 0));
    return res.status(200).json({
      summary: {
        totalInvoiced,
        totalCollected,
        outstanding,
        overdueAmount,
        paidInvoices: freshInvoices.filter((invoice) => invoice.data.status === 'paid').length,
        unpaidInvoices: freshInvoices.filter((invoice) => ['unpaid', 'overdue'].includes(invoice.data.status)).length,
        partiallyPaidInvoices: freshInvoices.filter((invoice) => invoice.data.status === 'partially-paid').length,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load billing summary.', error: error.message });
  }
});

router.post('/payment/:id/reverse', async (req, res) => {
  try {
    const payment = await ClinicOperation.findOne({ _id: req.params.id, recordType: 'payment' });
    if (!payment) return res.status(404).json({ message: 'Payment not found.' });
    if (!isActivePayment(payment)) return res.status(400).json({ message: 'This payment has already been reversed.' });
    const previousData = payment.data;
    payment.data = {
      ...payment.data,
      status: 'reversed',
      reversedAt: new Date().toISOString(),
      reversedBy: req.user.id,
      reversalReason: req.body?.reason || 'Payment reversed',
    };
    await payment.save();
    const invoice = await refreshInvoice(payment.data.invoiceId);
    await AuditLog.create({
      actorId: req.user.id,
      action: 'Reversed payment',
      target: `payment:${payment._id}`,
      previousData,
      newData: payment.data,
    });
    broadcastRealtimeEvent(req.app.get('io'), {
      type: 'payment',
      action: 'updated',
      entityId: String(payment._id),
      payload: { _id: String(payment._id), id: String(payment._id), invoiceId: payment.data.invoiceId, amount: payment.data.amount, status: payment.data.status },
      roles: ['owner'],
    });
    return res.status(200).json({ message: 'Payment reversed.', record: payment, invoice });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Unable to reverse payment.' });
  }
});

router.post('/invoice/:id/cancel', async (req, res) => {
  try {
    const invoice = await ClinicOperation.findOne({ _id: req.params.id, recordType: 'invoice' });
    if (!invoice) return res.status(404).json({ message: 'Invoice not found.' });
    const current = await refreshInvoice(invoice._id);
    if (Number(current.data.paid || 0) > 0) {
      return res.status(400).json({ message: 'Invoices with recorded payments cannot be cancelled. Reverse payments first.' });
    }
    current.data = { ...current.data, status: 'cancelled' };
    await current.save();
    await AuditLog.create({ actorId: req.user.id, action: 'Cancelled invoice', target: `invoice:${current._id}`, previousData: invoice.data, newData: current.data });
    broadcastRealtimeEvent(req.app.get('io'), {
      type: 'invoice',
      action: 'updated',
      entityId: String(current._id),
      payload: { _id: String(current._id), id: String(current._id), invoiceNumber: current.data.invoiceNumber, status: current.data.status, patientName: current.data.patientName },
      roles: ['owner'],
    });
    return res.status(200).json({ message: 'Invoice cancelled.', record: current });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Unable to cancel invoice.' });
  }
});

router.post('/invoice/:id/reminder', async (req, res) => {
  try {
    const invoice = await refreshInvoice(req.params.id);
    if (['paid', 'cancelled'].includes(invoice.data.status)) {
      return res.status(400).json({ message: 'Reminders are only sent for unpaid invoices.' });
    }
    const customer = invoice.data.patientId
      ? await User.findOne({ $or: [{ _id: mongoose.isValidObjectId(invoice.data.patientId) ? invoice.data.patientId : null }, { patientId: invoice.data.patientId }] }).select('name email')
      : await User.findOne({ name: invoice.data.patientName, role: 'patient' }).select('name email');
    const result = await sendPaymentReminder({
      name: invoice.data.patientName || customer?.name,
      email: invoice.data.customerEmail || customer?.email,
      invoiceNumber: invoice.data.invoiceNumber,
      balance: invoice.data.balance,
      dueDate: invoice.data.dueDate,
    });
    await AuditLog.create({
      actorId: req.user.id,
      action: 'Sent payment reminder',
      target: `invoice:${invoice._id}`,
      details: result.message,
      newData: { invoiceNumber: invoice.data.invoiceNumber, email: invoice.data.customerEmail || customer?.email },
    });
    return res.status(200).json({ message: result.message, sent: result.sent });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Unable to send payment reminder.' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const operation = await ClinicOperation.findById(req.params.id);
    if (!operation) return res.status(404).json({ message: 'Clinic operation not found.' });
    if (inventoryChangeTypes.includes(operation.recordType)) return res.status(400).json({ message: 'Inventory movements cannot be edited. Create a correcting movement instead.' });
    if (operation.recordType === 'payment') {
      return res.status(400).json({ message: 'Payments cannot be edited. Reverse the payment and record a replacement instead.' });
    }
    if (operation.recordType === 'invoice' && operation.data.status === 'cancelled') {
      return res.status(400).json({ message: 'Cancelled invoices cannot be edited.' });
    }
    if (operation.recordType === 'invoice' && Number(operation.data.paid || 0) > 0) {
      return res.status(400).json({ message: 'Invoices with payments can only be updated after reversing those payments.' });
    }
    const previousData = operation.data;
    const data = req.body || {};
    if (operation.recordType === 'inventory-item') {
      if (![data.beginningBalance, data.receipt, data.sold].every(isInventoryNumber)) {
        return res.status(400).json({ message: 'Beginning Balance, Receipt, and Sold must be non-negative numbers.' });
      }
      Object.assign(data, normalizeInventoryData(data));
      const duplicate = await ClinicOperation.exists({ _id: { $ne: operation._id }, recordType: 'inventory-item', 'data.itemCode': data.itemCode });
      if (duplicate) return res.status(409).json({ message: `Item Code ${data.itemCode} already exists.` });
    }
    if (operation.recordType === 'invoice') {
      data.items = normalizeInvoiceItems(data.items);
      data.total = invoiceTotalFromItems(data.items) || money(data.total || 0);
      data.invoiceNumber = operation.data.invoiceNumber;
      data.status = 'unpaid';
      if (data.templateId || await InvoiceTemplate.exists({ isDefault: true })) {
        const template = await resolveInvoiceTemplate(data.templateId);
        if (!template) return res.status(400).json({ message: 'Selected invoice template was not found.' });
        data.templateId = template._id.toString();
        data.templateName = template.name;
        data.templateSnapshot = template.templateData;
      }
    }
    const validationError = validateRecord(operation.recordType, data);
    if (validationError) return res.status(400).json({ message: validationError });
    operation.data = data;
    await operation.save();
    const result = operation.recordType === 'invoice' ? await refreshInvoice(operation._id) : operation;
    await AuditLog.create({ actorId: req.user.id, action: `Updated ${operation.recordType}`, target: `${operation.recordType}:${operation._id}`, previousData, newData: data });
    broadcastRealtimeEvent(req.app.get('io'), {
      type: operation.recordType,
      action: 'updated',
      entityId: String(operation._id),
      payload: {
        _id: String(operation._id),
        id: String(operation._id),
        recordType: operation.recordType,
        operationKey: operation.operationKey,
        data: result?.data || operation.data,
      },
      roles: ['owner'],
    });
    return res.status(200).json({ record: result });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Unable to update clinic operation.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const operation = await ClinicOperation.findById(req.params.id);
    if (!operation) return res.status(404).json({ message: 'Clinic operation not found.' });
    if (operation.recordType === 'payment') {
      return res.status(400).json({ message: 'Payments cannot be deleted. Reverse the payment instead.' });
    }
    if (operation.recordType === 'invoice' && Number(operation.data.paid || 0) > 0) {
      return res.status(400).json({ message: 'Invoices with payments cannot be deleted. Cancel only after reversing payments.' });
    }
    if (operation.inventoryApplied) await reverseInventoryChange(operation.recordType, operation.data.items);
    const deletedOperation = { _id: String(operation._id), recordType: operation.recordType, operationKey: operation.operationKey, data: operation.data };
    await operation.deleteOne();
    await AuditLog.create({ actorId: req.user.id, action: `Removed ${operation.recordType}`, target: `${operation.recordType}:${operation._id}`, previousData: operation.data });
    broadcastRealtimeEvent(req.app.get('io'), {
      type: operation.recordType,
      action: 'deleted',
      entityId: String(operation._id),
      payload: deletedOperation,
      roles: ['owner'],
    });
    return res.status(200).json({ message: 'Clinic operation removed.' });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Unable to remove clinic operation.' });
  }
});

router.post('/:recordType', async (req, res) => {
  const { recordType } = req.params;
  const data = req.body || {};
  if (!operationTypes.includes(recordType)) return res.status(400).json({ message: 'Invalid operation type.' });
  const validationError = validateRecord(recordType, data);
  if (validationError) return res.status(400).json({ message: validationError });

  try {
    if (recordType === 'invoice') {
      data.items = normalizeInvoiceItems(data.items);
      data.total = invoiceTotalFromItems(data.items) || money(data.total || 0);
      data.invoiceNumber = data.invoiceNumber || await nextDocumentNumber('invoice', 'INV');
      data.invoiceDate = data.invoiceDate || todayDate();
      data.dueDate = data.dueDate || data.invoiceDate;
      data.paid = 0;
      data.balance = data.total;
      data.status = 'unpaid';
      if (data.templateId || await InvoiceTemplate.exists({ isDefault: true })) {
        const template = await resolveInvoiceTemplate(data.templateId);
        if (!template) return res.status(400).json({ message: 'Selected invoice template was not found.' });
        data.templateId = template._id.toString();
        data.templateName = template.name;
        data.templateSnapshot = template.templateData;
      }
      data.amountPaid = 0;
      data.remainingBalance = data.total;
    }

    if (recordType === 'payment') {
      if (!mongoose.isValidObjectId(data.invoiceId)) return res.status(400).json({ message: 'Invalid invoiceId.' });
      const invoice = await refreshInvoice(data.invoiceId);
      if (invoice.data.status === 'cancelled') return res.status(400).json({ message: 'Cancelled invoices cannot accept payments.' });
      const amount = money(data.amount);
      const balance = money(invoice.data.balance || invoice.data.total || 0);
      if (amount > balance) return res.status(400).json({ message: `Payment cannot exceed the remaining balance of ${balance.toFixed(2)}.` });
      data.invoiceId = invoice._id.toString();
      data.invoiceNumber = invoice.data.invoiceNumber;
      data.patientName = data.patientName || invoice.data.patientName;
      data.patientId = data.patientId || invoice.data.patientId;
      data.amount = amount;
      data.method = data.method || 'Cash';
      data.paymentDate = data.paymentDate || todayDate();
      data.receiptNumber = data.receiptNumber || await nextDocumentNumber('payment', 'RCPT');
      data.status = 'recorded';
      data.recordedBy = req.user.email || req.user.id;
    }

    const operation = await ClinicOperation.create({
      recordType,
      operationKey: recordType === 'receiving' ? data.reference : recordType === 'invoice' ? data.invoiceNumber : recordType === 'payment' ? data.receiptNumber : data.operationKey,
      data,
      createdBy: req.user.id,
    });

    if (inventoryChangeTypes.includes(recordType)) {
      try {
        const itemChanges = await applyInventoryChange(recordType, data.items, data);
        operation.data = { ...operation.data, items: itemChanges, processedAt: new Date().toISOString(), processedBy: req.user.email || req.user.id };
        operation.inventoryApplied = true;
        await operation.save();
      } catch (error) {
        await ClinicOperation.findByIdAndDelete(operation._id);
        return res.status(400).json({ message: error.message });
      }
    }

    const result = recordType === 'invoice' ? await refreshInvoice(operation._id) : operation;
    if (recordType === 'payment') await refreshInvoice(data.invoiceId);
    await AuditLog.create({
      actorId: req.user.id,
      action: `Created ${recordType}`,
      target: `${recordType}:${operation._id}`,
      newData: data,
    });

    broadcastRealtimeEvent(req.app.get('io'), {
      type: recordType,
      action: 'created',
      entityId: String(operation._id),
      payload: {
        _id: String(operation._id),
        id: String(operation._id),
        recordType,
        operationKey: operation.operationKey,
        data: result?.data || data,
      },
      roles: ['owner'],
    });

    return res.status(201).json({ record: result });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: recordType === 'inventory-item' ? 'An inventory item already uses that Item Code.' : 'A receiving record with that reference already exists.' });
    return res.status(500).json({ message: `Failed to create ${recordType}.`, error: error.message });
  }
});

export default router;
