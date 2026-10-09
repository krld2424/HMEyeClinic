import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { createPatientNotification } from '../utils/patientNotification.js';
import { requireAuth, allowRoles } from '../middleware/auth.js';
import { broadcastRealtimeEvent, publicUserPayload } from '../config/realtime.js';

const router = express.Router();
router.use(requireAuth, allowRoles('owner'));

const managedRoles = ['optometrist', 'eye-care-assistant'];

const nextPatientId = async () => {
  const patients = await User.find({ role: 'patient', patientId: /^HME-\d{6}$/ }).select('patientId').sort({ patientId: -1 });
  const highest = patients.reduce((maximum, patient) => Math.max(maximum, Number(patient.patientId.slice(4))), 0);
  return `HME-${String(highest + 1).padStart(6, '0')}`;
};

const broadcastUserChange = (req, user, action) => {
  broadcastRealtimeEvent(req.app.get('io'), {
    type: 'user',
    action,
    entityId: String(user._id),
    payload: publicUserPayload(user),
    roles: ['owner'],
    userIds: [String(user._id)],
  });
};

router.get('/users', async (req, res) => {
  try {
    const archivedOnly = String(req.query.archived || '').toLowerCase() === 'true';
    const patientsWithoutIds = await User.find({ role: 'patient', patientId: { $exists: false }, ...(archivedOnly ? {} : { archived: { $ne: true } }) });
    for (const patient of patientsWithoutIds) {
      patient.patientId = await nextPatientId();
      await patient.save();
    }

    const users = await User.find({ role: { $in: managedRoles }, ...(archivedOnly ? {} : { archived: { $ne: true } }) })
      .select('-password')
      .sort({ createdAt: -1 });
    return res.status(200).json({ users });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load managed accounts.', error: error.message });
  }
});

router.patch('/users/:id/archive', async (req, res) => {
  try {
    const archived = Boolean(req.body?.archived ?? true);
    const user = await User.findOne({ _id: req.params.id, role: { $ne: 'owner' } }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (req.user.role !== 'owner') return res.status(403).json({ message: 'Only the owner may archive staff accounts.' });
    user.archived = archived;
    user.isActive = archived ? false : user.isActive;
    await user.save();
    broadcastUserChange(req, user, archived ? 'archived' : 'restored');
    return res.status(200).json({ message: archived ? 'User archived.' : 'User restored.', user });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Unable to archive user.' });
  }
});

router.patch('/users/:id/status', async (req, res) => {
  try {
    const { isActive } = req.body;
    const previousUser = await User.findOne({ _id: req.params.id, role: { $ne: 'owner' } }).select('isActive role');
    if (!previousUser) return res.status(404).json({ message: 'User not found.' });
    const previousStatus = previousUser.isActive !== false;
    const nextStatus = Boolean(isActive);
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, role: { $ne: 'owner' } },
      { isActive: nextStatus },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (user.role === 'patient' && previousStatus !== user.isActive) {
      const statusLabel = user.isActive ? 'activated' : 'deactivated';
      await createPatientNotification({
        recipientId: user._id,
        eventKey: `account-status:${user._id}:${previousStatus}:${user.isActive}:${user.updatedAt.getTime()}`,
        message: `Your patient account has been ${statusLabel}.`,
        href: '/dashboard/patient/dashboard',
      });
    }
    broadcastUserChange(req, user, user.isActive ? 'updated' : 'deleted');
    return res.status(200).json({ user });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update user status.', error: error.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    const { name, email, password, role, phone, specialty, department, suffix } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'Name, email, password, and role are required.' });
    }

    if (!managedRoles.includes(role)) {
      return res.status(400).json({ message: 'Owner accounts can only create optometrist or eye care assistant users.' });
    }

    if (phone && !/^\+63 \d{3}-\d{3}-\d{4}$/.test(phone)) {
      return res.status(400).json({ message: 'Contact must use +63 000-000-0000 format.' });
    }

    const normalizedEmail = email.toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const user = await User.create({
      name,
      email: normalizedEmail,
      password: await bcrypt.hash(password, 10),
      role,
      phone,
      specialty,
      department,
      suffix,
    });

    broadcastUserChange(req, user, 'created');

    return res.status(201).json({
      message: `${role === 'optometrist' ? 'Optometrist' : 'Eye Care Assistant'} account created successfully.`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        specialty: user.specialty,
        department: user.department,
      },
    });
  } catch (error) {
    console.error('Admin user creation error:', error);
    return res.status(500).json({ message: 'Failed to create account.', error: error.message });
  }
});

export default router;
