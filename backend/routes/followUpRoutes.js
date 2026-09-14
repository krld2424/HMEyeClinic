import express from 'express';
import FollowUp from '../models/FollowUp.js';
import User from '../models/User.js';
import { requireAuth, allowRoles } from '../middleware/auth.js';
import { getClinicScheduleForDate } from '../config/clinicSchedule.js';
import { broadcastRealtimeEvent } from '../config/realtime.js';
import { sendFollowUpReminder } from '../config/mailer.js';

const router = express.Router();
const clinicalRoles = ['owner', 'optometrist'];
const followUpStatuses = ['requested', 'scheduled', 'completed', 'rejected', 'cancelled'];

const getReminderDate = (scheduledDate, reminderDaysBefore = 3) => {
  if (!scheduledDate) return null;
  const reminderDate = new Date(`${scheduledDate}T00:00:00`);
  reminderDate.setDate(reminderDate.getDate() - Number(reminderDaysBefore || 0));
  return reminderDate.toISOString().slice(0, 10);
};

const maybeSendReminder = async (followUp) => {
  if (!followUp?.scheduledDate || followUp.reminderStatus === 'sent' || followUp.reminderStatus === 'cancelled') return followUp;

  const reminderDate = getReminderDate(followUp.scheduledDate, followUp.reminderDaysBefore ?? 3);
  const today = new Date().toISOString().slice(0, 10);

  if (!reminderDate || reminderDate > today) {
    followUp.reminderScheduledFor = reminderDate;
    followUp.reminderStatus = 'pending';
    await followUp.save();
    return followUp;
  }

  try {
    const result = await sendFollowUpReminder({
      patientName: followUp.patientName,
      email: followUp.patientEmail,
      scheduledDate: followUp.scheduledDate,
      reason: followUp.reason,
      reminderDaysBefore: followUp.reminderDaysBefore ?? 3,
    });

    followUp.reminderScheduledFor = reminderDate;
    followUp.reminderStatus = 'sent';
    followUp.reminderSentAt = new Date();
    followUp.reminderChannel = 'email';
    followUp.reminderLog = [
      ...(followUp.reminderLog || []),
      { status: result.sent ? 'sent' : 'failed', channel: 'email', sentAt: new Date(), message: result.message || 'Follow-up reminder processed.' },
    ];
    await followUp.save();
    return followUp;
  } catch (error) {
    followUp.reminderScheduledFor = reminderDate;
    followUp.reminderStatus = 'failed';
    followUp.reminderLog = [
      ...(followUp.reminderLog || []),
      { status: 'failed', channel: 'email', sentAt: new Date(), message: error.message || 'Reminder failed to send.' },
    ];
    await followUp.save();
    return followUp;
  }
};

router.post('/', requireAuth, allowRoles('patient'), async (req, res) => {
  try {
    const { reason, preferredDate, scheduledDate, reminderDaysBefore } = req.body;
    if (!reason) return res.status(400).json({ message: 'A reason is required.' });

    const today = new Date().toISOString().slice(0, 10);
    if (preferredDate && preferredDate < today) {
      return res.status(400).json({ message: 'Preferred date must be today or a future date.' });
    }
    if (scheduledDate && scheduledDate < today) {
      return res.status(400).json({ message: 'Scheduled date must be today or a future date.' });
    }

    if (preferredDate) {
      const scheduleInfo = getClinicScheduleForDate(preferredDate);
      if (!scheduleInfo.operatingDay) {
        return res.status(400).json({
          message: 'The clinic does not operate on Sunday. Please select a weekday or Saturday.',
        });
      }
    }

    if (scheduledDate) {
      const scheduleInfo = getClinicScheduleForDate(scheduledDate);
      if (!scheduleInfo.operatingDay) {
        return res.status(400).json({
          message: 'The clinic does not operate on Sunday. Please select a weekday or Saturday.',
        });
      }
    }

    const patient = await User.findById(req.user.id).select('name email');
    if (!patient) return res.status(404).json({ message: 'Patient account not found.' });

    const followUp = await FollowUp.create({
      patientId: req.user.id,
      patientName: patient.name,
      patientEmail: patient.email,
      reason,
      preferredDate,
      scheduledDate,
      reminderDaysBefore: Number(reminderDaysBefore || 3),
      reminderScheduledFor: scheduledDate ? getReminderDate(scheduledDate, Number(reminderDaysBefore || 3)) : null,
      status: scheduledDate ? 'scheduled' : 'requested',
    });

    if (followUp.scheduledDate) await maybeSendReminder(followUp);

    broadcastRealtimeEvent(req.app.get('io'), {
      type: 'follow-up',
      action: 'created',
      entityId: String(followUp._id),
      payload: {
        _id: String(followUp._id),
        id: String(followUp._id),
        patientId: followUp.patientId,
        patientName: followUp.patientName,
        patientEmail: followUp.patientEmail,
        reason: followUp.reason,
        preferredDate: followUp.preferredDate,
        status: followUp.status,
      },
      roles: ['owner', 'optometrist'],
      userIds: [String(req.user.id)].filter(Boolean),
      emails: [patient.email].filter(Boolean),
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
    const { status, scheduledDate, notes, reminderDaysBefore } = req.body;
    if (status && !followUpStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid follow-up status.' });
    }
    if (scheduledDate && scheduledDate < new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ message: 'Scheduled date must be today or a future date.' });
    }

    const update = {
      ...(status && { status }),
      ...(scheduledDate && { scheduledDate }),
      ...(notes !== undefined && { notes }),
      ...(reminderDaysBefore !== undefined && { reminderDaysBefore: Number(reminderDaysBefore || 3) }),
    };

    const followUp = await FollowUp.findById(req.params.id);
    if (!followUp) return res.status(404).json({ message: 'Follow-up request not found.' });

    Object.assign(followUp, update);
    if (scheduledDate) {
      followUp.reminderScheduledFor = getReminderDate(scheduledDate, Number(followUp.reminderDaysBefore || 3));
      followUp.reminderStatus = 'pending';
      if (followUp.status === 'scheduled') {
        await maybeSendReminder(followUp);
      }
    }
    await followUp.save();

    broadcastRealtimeEvent(req.app.get('io'), {
      type: 'follow-up',
      action: 'updated',
      entityId: String(followUp._id),
      payload: {
        _id: String(followUp._id),
        id: String(followUp._id),
        patientId: followUp.patientId,
        patientName: followUp.patientName,
        patientEmail: followUp.patientEmail,
        status: followUp.status,
        scheduledDate: followUp.scheduledDate,
        notes: followUp.notes,
      },
      roles: ['owner', 'optometrist'],
      userIds: [String(followUp.patientId)].filter(Boolean),
      emails: [followUp.patientEmail].filter(Boolean),
    });

    return res.status(200).json({ message: 'Follow-up updated.', followUp });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update follow-up request.', error: error.message });
  }
});

export default router;
