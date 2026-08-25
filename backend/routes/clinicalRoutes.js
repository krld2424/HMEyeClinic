import express from 'express';
import ClinicalRecord from '../models/ClinicalRecord.js';
import User from '../models/User.js';
import mongoose from 'mongoose';
import { requireAuth, allowRoles } from '../middleware/auth.js';

const router = express.Router();
const clinicalRoles = ['owner', 'optometrist'];
const recordTypes = ['medical-record', 'clinical-note', 'consultation', 'prescription'];

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
  const record = await ClinicalRecord.create({ patientId, authorId: req.user.id, type, title, details, status, issuedAt });
  return res.status(201).json({ message: 'Clinical record created.', record });
});

router.patch('/:id', requireAuth, allowRoles(...clinicalRoles), async (req, res) => {
  const record = await ClinicalRecord.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!record) return res.status(404).json({ message: 'Clinical record not found.' });
  return res.status(200).json({ record });
});

export default router;
