import express from 'express';
import FollowUp from '../models/FollowUp.js';
import User from '../models/User.js';
import { requireAuth, allowRoles } from '../middleware/auth.js';

const router = express.Router();
const clinicalRoles = ['owner', 'optometrist'];
const followUpStatuses = ['requested', 'scheduled', 'completed', 'rejected', 'cancelled'];

router.post('/', requireAuth, allowRoles('patient'), async (req, res) => {
  try {
    const { reason, preferredDate } = req.body;
    if (!reason) return res.status(400).json({ message: 'A reason is required.' });

    const today = new Date().toISOString().slice(0, 10);
    if (preferredDate && preferredDate < today) {
      return res.status(400).json({ message: 'Preferred date must be today or a future date.' });
    }

    const patient = await User.findById(req.user.id).select('name email');
    if (!patient) return res.status(404).json({ message: 'Patient account not found.' });

    const followUp = await FollowUp.create({
      patientId: req.user.id,
      patientName: patient.name,
      patientEmail: patient.email,
      reason,
      preferredDate,
    });

    return res.status(201).json({ message: 'Follow-up request submitted.', followUp });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to submit follow-up request.', error: error.message });
  }
});

router.get('/mine', requireAuth, allowRoles('patient'), async (req, res) => {
  try {
    const followUps = await FollowUp.find({ patientId: req.user.id }).sort({ createdAt: -1 });
    return res.status(200).json({ followUps });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load your follow-up requests.', error: error.message });
  }
});

router.get('/', requireAuth, allowRoles(...clinicalRoles), async (req, res) => {
  try {
    const followUps = await FollowUp.find().sort({ createdAt: -1 });
    return res.status(200).json({ followUps });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load follow-up requests.', error: error.message });
  }
});

router.patch('/:id', requireAuth, allowRoles(...clinicalRoles), async (req, res) => {
  try {
    const { status, scheduledDate, notes } = req.body;
    if (status && !followUpStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid follow-up status.' });
    }
    if (scheduledDate && scheduledDate < new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ message: 'Scheduled date must be today or a future date.' });
    }

    const followUp = await FollowUp.findByIdAndUpdate(
      req.params.id,
      { ...(status && { status }), ...(scheduledDate && { scheduledDate }), ...(notes !== undefined && { notes }) },
      { new: true, runValidators: true }
    );
    if (!followUp) return res.status(404).json({ message: 'Follow-up request not found.' });
    return res.status(200).json({ message: 'Follow-up updated.', followUp });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update follow-up request.', error: error.message });
  }
});

export default router;
