import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import ClinicalRecord from '../models/ClinicalRecord.js';
import User from '../models/User.js';
import mongoose from 'mongoose';
import { requireAuth, allowRoles } from '../middleware/auth.js';
import { broadcastRealtimeEvent } from '../config/realtime.js';

const router = express.Router();
const clinicalRoles = ['owner', 'optometrist'];
const recordTypes = ['medical-record', 'clinical-note', 'consultation', 'prescription'];

const nextPatientId = async () => {
  const patients = await User.find({ role: 'patient', patientId: /^HME-\d{6}$/ }).select('patientId').sort({ patientId: -1 });
  const highest = patients.reduce((maximum, patient) => Math.max(maximum, Number(patient.patientId.slice(4))), 0);
  return `HME-${String(highest + 1).padStart(6, '0')}`;
};

router.get('/mine', requireAuth, allowRoles('patient'), async (req, res) => {
  const type = recordTypes.includes(req.query.type) ? req.query.type : undefined;
  const records = await ClinicalRecord.find({ patientId: req.user.id, ...(type && { type }) }).sort({ createdAt: -1 });
  return res.status(200).json({ records });
});

router.get('/', requireAuth, allowRoles(...clinicalRoles), async (req, res) => {
  const type = recordTypes.includes(req.query.type) ? req.query.type : undefined;
  const records = await ClinicalRecord.find({ ...(type && { type }) }).sort({ createdAt: -1 });
  return res.status(200).json({ records });
});

router.get('/patient-search', requireAuth, allowRoles(...clinicalRoles), async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 2) return res.status(200).json({ patients: [] });
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const patients = await User.find({ role: 'patient', $or: [{ name: expression }, { email: expression }, { patientId: expression }, { phone: expression }] })
    .select('_id name firstName lastName email patientId phone age gender')
    .sort({ name: 1 })
    .limit(10)
    .lean();
  return res.status(200).json({ patients });
});

router.post('/patient-record', requireAuth, allowRoles(...clinicalRoles), async (req, res) => {
  try {
    const { patientId, patient, record } = req.body;
    const patientLookup = patientId ? [{ patientId }, ...(mongoose.isValidObjectId(patientId) ? [{ _id: patientId }] : [])] : [];
    let patientUser = patientLookup.length ? await User.findOne({ role: 'patient', $or: patientLookup }) : null;

    if (!patientUser) {
      if (!patient?.name || !patient?.phone) return res.status(400).json({ message: 'Select an account or provide the patient name and contact number.' });
      patientUser = await User.create({
        name: patient.name,
        firstName: patient.firstName,
        lastName: patient.lastName,
        middleInitial: patient.middleInitial,
        suffix: patient.suffix,
        email: `manual-${crypto.randomUUID()}@patient.local`,
        password: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
        role: 'patient',
        patientId: await nextPatientId(),
        phone: patient.phone,
        age: patient.age ? Number(patient.age) : undefined,
        gender: patient.gender,
      });
    }

    const recordData = { ...record, patientId: patientUser.patientId || String(patientUser._id), patientName: patientUser.name };
    const clinicalRecord = await ClinicalRecord.create({
      patientId: patientUser._id,
      authorId: req.user.id,
      type: 'medical-record',
      title: 'Patient Record',
      details: JSON.stringify(recordData),
      status: 'active',
      issuedAt: record?.date || new Date().toISOString().slice(0, 10),
    });

    broadcastRealtimeEvent(req.app.get('io'), {
      type: 'clinical-record',
      action: 'created',
      entityId: String(clinicalRecord._id),
      payload: { _id: String(clinicalRecord._id), id: String(clinicalRecord._id), patientId: String(patientUser._id), authorId: clinicalRecord.authorId, type: clinicalRecord.type, title: clinicalRecord.title, status: clinicalRecord.status, issuedAt: clinicalRecord.issuedAt },
      roles: ['owner', 'optometrist'],
      userIds: [String(patientUser._id)],
    });
    return res.status(201).json({ message: 'Patient record created.', patient: patientUser, record: clinicalRecord });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to create patient record.' });
  }
});

router.post('/', requireAuth, allowRoles(...clinicalRoles), async (req, res) => {
  const { patientId, type, title, details, status, issuedAt } = req.body;
  if (!patientId || !recordTypes.includes(type) || !title || !details) return res.status(400).json({ message: 'Patient, record type, title, and details are required.' });
  const patient = await User.findOne({
    role: 'patient',
    $or: [
      { patientId },
      ...(mongoose.isValidObjectId(patientId) ? [{ _id: patientId }] : []),
    ],
  });
  if (!patient) return res.status(404).json({ message: 'Patient not found.' });
  const record = await ClinicalRecord.create({ patientId: patient._id, authorId: req.user.id, type, title, details, status, issuedAt });
  broadcastRealtimeEvent(req.app.get('io'), {
    type: 'clinical-record',
    action: 'created',
    entityId: String(record._id),
    payload: {
      _id: String(record._id),
      id: String(record._id),
      patientId: String(patient._id),
      authorId: record.authorId,
      type: record.type,
      title: record.title,
      status: record.status,
      issuedAt: record.issuedAt,
    },
    roles: ['owner', 'optometrist'],
    userIds: [String(patient._id)],
  });
  return res.status(201).json({ message: 'Clinical record created.', record });
});

router.patch('/:id', requireAuth, allowRoles(...clinicalRoles), async (req, res) => {
  const record = await ClinicalRecord.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!record) return res.status(404).json({ message: 'Clinical record not found.' });
  broadcastRealtimeEvent(req.app.get('io'), {
    type: 'clinical-record',
    action: 'updated',
    entityId: String(record._id),
    payload: {
      _id: String(record._id),
      id: String(record._id),
      patientId: record.patientId,
      authorId: record.authorId,
      type: record.type,
      title: record.title,
      status: record.status,
      issuedAt: record.issuedAt,
    },
    roles: ['owner', 'optometrist'],
    userIds: [String(record.patientId)],
  });
  return res.status(200).json({ record });
});

router.delete('/:id', requireAuth, allowRoles(...clinicalRoles), async (req, res) => {
  const record = await ClinicalRecord.findById(req.params.id);
  if (!record) return res.status(404).json({ message: 'Clinical record not found.' });

  const deletedRecord = record.toObject();
  await record.deleteOne();

  broadcastRealtimeEvent(req.app.get('io'), {
    type: 'clinical-record',
    action: 'deleted',
    entityId: String(deletedRecord._id),
    payload: {
      _id: String(deletedRecord._id),
      id: String(deletedRecord._id),
      patientId: deletedRecord.patientId,
      authorId: deletedRecord.authorId,
      type: deletedRecord.type,
      title: deletedRecord.title,
      status: deletedRecord.status,
    },
    roles: ['owner', 'optometrist'],
    userIds: [String(deletedRecord.patientId)],
  });

  return res.status(200).json({ message: 'Clinical record deleted.', record: deletedRecord });
});

export default router;
