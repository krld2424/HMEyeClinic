import express from 'express';
import mongoose from 'mongoose';
import JobOrder, { getJobOrderStatus, jobOrderStatusOverrides } from '../models/JobOrder.js';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import { requireAuth, allowRoles } from '../middleware/auth.js';
import { broadcastRealtimeEvent } from '../config/realtime.js';

const router = express.Router();
const jobOrderRoles = ['owner', 'eye-care-assistant'];
const dateFields = ['transactionDate', 'orderDate', 'pickupByRiderDate', 'dueDate', 'deliveryDate', 'dateOfClaiming'];
const textFields = ['surname', 'name', 'contact', 'frameModelColor', 'lensType'];

router.use(requireAuth, allowRoles(...jobOrderRoles));

const todayDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const isValidDate = (value) => !value || (
  /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
);

const serializeJobOrder = (jobOrder) => {
  const record = typeof jobOrder.toObject === 'function' ? jobOrder.toObject() : jobOrder;
  const status = getJobOrderStatus(record);
  return {
    ...record,
    status,
    balanceDue: Number(record.balance || 0) > 0,
    overdue: Boolean(record.dueDate && record.dueDate < todayDate() && status !== 'Claimed'),
  };
};

const readJobOrder = (body = {}) => {
  const data = {};
  for (const field of textFields) data[field] = String(body[field] || '').trim();
  data.joNumber = String(body.joNumber || '').trim().toUpperCase();
  for (const field of dateFields) data[field] = String(body[field] || '').trim();
  data.balance = Number(body.balance ?? 0);
  data.statusOverride = String(body.statusOverride || '').trim();
  data.patientId = String(body.patientId || '').trim() || null;

  const missingField = ['surname', 'name', 'contact', 'joNumber', 'transactionDate', 'frameModelColor', 'lensType']
    .find((field) => !data[field]);
  if (missingField) return { error: `${missingField} is required.` };
  if (!/^[\p{N}\p{P}\p{S}]+$/u.test(data.joNumber)) {
    return { error: 'JO Number may contain numbers and special characters only.' };
  }
  if (!Number.isFinite(data.balance) || data.balance < 0) return { error: 'Balance must be zero or greater.' };
  if (data.statusOverride && !jobOrderStatusOverrides.includes(data.statusOverride)) {
    return { error: 'Choose a valid status override.' };
  }
  if (dateFields.some((field) => !isValidDate(data[field]))) return { error: 'Dates must use a valid YYYY-MM-DD date.' };
  if (data.patientId && !mongoose.isValidObjectId(data.patientId)) return { error: 'Choose a valid patient account.' };

  return { data };
};

const validatePatient = async (patientId) => {
  if (!patientId) return null;
  return User.exists({ _id: patientId, role: 'patient' });
};

const broadcastJobOrder = (req, jobOrder, action) => {
  const payload = serializeJobOrder(jobOrder);
  broadcastRealtimeEvent(req.app.get('io'), {
    type: 'job-order',
    action,
    entityId: String(jobOrder._id),
    payload,
    roles: jobOrderRoles,
  });
};

router.get('/', async (req, res) => {
  try {
    const archived = String(req.query.archived || '').toLowerCase() === 'true';
    const jobOrders = await JobOrder.find({ archived }).sort({ transactionDate: -1, createdAt: -1 });
    return res.status(200).json({ jobOrders: jobOrders.map(serializeJobOrder) });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load eyeglass job orders.', error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { data, error } = readJobOrder(req.body);
    if (error) return res.status(400).json({ message: error });
    if (data.patientId && !await validatePatient(data.patientId)) {
      return res.status(404).json({ message: 'Patient account not found.' });
    }

    const jobOrder = await JobOrder.create({ ...data, createdBy: req.user.id });
    await AuditLog.create({
      actorId: req.user.id,
      action: 'Created eyeglass job order',
      target: `job-order:${jobOrder._id}`,
      newData: serializeJobOrder(jobOrder),
    });
    broadcastJobOrder(req, jobOrder, 'created');
    return res.status(201).json({ message: 'Eyeglass job order created.', jobOrder: serializeJobOrder(jobOrder) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'That JO Number is already in use.' });
    return res.status(400).json({ message: error.message || 'Unable to create eyeglass job order.' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid job order ID.' });
    const { data, error } = readJobOrder(req.body);
    if (error) return res.status(400).json({ message: error });
    if (data.patientId && !await validatePatient(data.patientId)) {
      return res.status(404).json({ message: 'Patient account not found.' });
    }

    const jobOrder = await JobOrder.findById(req.params.id);
    if (!jobOrder || jobOrder.archived) return res.status(404).json({ message: 'Eyeglass job order not found.' });
    const previousData = serializeJobOrder(jobOrder);
    Object.assign(jobOrder, data);
    await jobOrder.save();
    await AuditLog.create({
      actorId: req.user.id,
      action: 'Updated eyeglass job order',
      target: `job-order:${jobOrder._id}`,
      previousData,
      newData: serializeJobOrder(jobOrder),
    });
    broadcastJobOrder(req, jobOrder, 'updated');
    return res.status(200).json({ message: 'Eyeglass job order updated.', jobOrder: serializeJobOrder(jobOrder) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'That JO Number is already in use.' });
    return res.status(400).json({ message: error.message || 'Unable to update eyeglass job order.' });
  }
});

router.patch('/:id/archive', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid job order ID.' });
    const jobOrder = await JobOrder.findById(req.params.id);
    if (!jobOrder) return res.status(404).json({ message: 'Eyeglass job order not found.' });
    const archived = typeof req.body?.archived === 'boolean' ? req.body.archived : true;
    if (archived && (getJobOrderStatus(jobOrder) !== 'Claimed' || Number(jobOrder.balance || 0) !== 0)) {
      return res.status(400).json({ message: 'Only claimed job orders with a zero balance can be archived.' });
    }

    const previousData = { archived: jobOrder.archived, status: getJobOrderStatus(jobOrder), balance: jobOrder.balance };
    jobOrder.archived = archived;
    await jobOrder.save();
    await AuditLog.create({
      actorId: req.user.id,
      action: archived ? 'Archived eyeglass job order' : 'Restored eyeglass job order',
      target: `job-order:${jobOrder._id}`,
      previousData,
      newData: { archived: jobOrder.archived, status: getJobOrderStatus(jobOrder), balance: jobOrder.balance },
    });
    broadcastJobOrder(req, jobOrder, archived ? 'archived' : 'restored');
    return res.status(200).json({ message: archived ? 'Eyeglass job order archived.' : 'Eyeglass job order restored.' });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Unable to archive eyeglass job order.' });
  }
});

export default router;
