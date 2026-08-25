import express from 'express';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import ClinicSettings from '../models/ClinicSettings.js';
import Appointment from '../models/Appointment.js';
import { requireAuth, allowRoles } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/profile', allowRoles('patient'), async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  if (!user) return res.status(404).json({ message: 'Profile not found.' });
  return res.status(200).json({ user });
});

router.patch('/profile', allowRoles('patient'), async (req, res) => {
  const { name, phone, age, gender } = req.body;
  const user = await User.findByIdAndUpdate(req.user.id, { name, phone, age, gender }, { new: true, runValidators: true }).select('-password');
  if (!user) return res.status(404).json({ message: 'Profile not found.' });
  return res.status(200).json({ message: 'Profile updated.', user });
});

router.get('/permissions', allowRoles('owner'), async (req, res) => {
  return res.status(200).json({ permissions: [
    { role: 'owner', access: 'All clinic administration and clinical workflows' },
    { role: 'optometrist', access: 'Appointments, consultations, clinical notes, prescriptions, follow-ups' },
    { role: 'eye-care-assistant', access: 'Appointments and clinic operations' },
    { role: 'patient', access: 'Personal appointments, medical records, prescriptions, and follow-ups' },
  ] });
});

router.get('/audit-logs', allowRoles('owner'), async (req, res) => {
  const [logs, appointments] = await Promise.all([
    AuditLog.find().populate('actorId', 'name email role').sort({ createdAt: -1 }).limit(200),
    Appointment.find({ status: { $in: ['confirmed', 'completed', 'cancelled', 'rescheduled', 'no-show'] } }).sort({ updatedAt: -1 }).limit(200),
  ]);
  const appointmentLogs = appointments.map((appointment) => ({
    _id: `appointment-${appointment._id}`,
    action: `Appointment status: ${appointment.status}`,
    target: `Appointment for ${appointment.name}`,
    details: `${appointment.service} (${appointment.email})`,
    previousData: null,
    newData: { status: appointment.status },
    createdAt: appointment.updatedAt,
  }));
  const combinedLogs = [...logs, ...appointmentLogs].sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt)).slice(0, 200);
  return res.status(200).json({ logs: combinedLogs });
});

router.get('/clinic-settings', allowRoles('owner'), async (req, res) => {
  let settings = await ClinicSettings.findOne();
  if (!settings) settings = await ClinicSettings.create({});
  return res.status(200).json({ settings });
});

router.patch('/clinic-settings', allowRoles('owner'), async (req, res) => {
  const settings = await ClinicSettings.findOneAndUpdate({}, req.body, { new: true, upsert: true, runValidators: true });
  await AuditLog.create({ actorId: req.user.id, action: 'Updated clinic settings', target: 'ClinicSettings' });
  return res.status(200).json({ message: 'Clinic settings updated.', settings });
});

export default router;
