import express from 'express';
import Appointment from '../models/Appointment.js';
import AuditLog from '../models/AuditLog.js';
import { requireAuth, optionalAuth, allowRoles } from '../middleware/auth.js';
import { sendAppointmentNotifications } from '../config/mailer.js';
import { appointmentCreationLimiter } from '../middleware/rateLimit.js';
import { broadcastRealtimeEvent, publicAppointmentPayload } from '../config/realtime.js';
import {
  getAvailableSlotsForDate,
  validateAppointmentTime,
  formatTime12Hour,
  convert12HourTo24Hour,
  getFormattedClinicHours,
  getClinicScheduleForDate,
} from '../config/clinicSchedule.js';

const router = express.Router();

router.get('/availability', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ message: 'A date is required.' });

    const availableSlotTimes = getAvailableSlotsForDate(date, new Date());
    const scheduleInfo = getClinicScheduleForDate(date);

    if (!scheduleInfo.operatingDay) {
      return res.status(200).json({
        date,
        scheduleInfo,
        clinicHours: getFormattedClinicHours(date),
        slots: [],
      });
    }

    const appointments = await Appointment.find({
      preferredDate: date,
      status: { $nin: ['cancelled', 'no-show'] },
    }).select('preferredTime');

    const bookedTimes = new Set();
    appointments.forEach((appointment) => {
      const rawTime = String(appointment.preferredTime || '').trim();
      if (!rawTime) return;
      const normalized = rawTime.includes('AM') || rawTime.includes('PM') ? convert12HourTo24Hour(rawTime) : rawTime;
      bookedTimes.add(rawTime);
      bookedTimes.add(normalized);
      bookedTimes.add(formatTime12Hour(normalized));
    });

    const slots = availableSlotTimes.map((time) => ({
      time24Hr: time,
      time: formatTime12Hour(time),
      available: !bookedTimes.has(time) && !bookedTimes.has(formatTime12Hour(time)) && !bookedTimes.has(convert12HourTo24Hour(formatTime12Hour(time))),
    }));

    return res.status(200).json({
      date,
      scheduleInfo,
      clinicHours: getFormattedClinicHours(date),
      slots,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load availability.', error: error.message });
  }
});

router.post('/', appointmentCreationLimiter, optionalAuth, async (req, res) => {
  try {
    const { name, email, phone, service, preferredDate, preferredTime, message } = req.body;
    const userId = req.user?.id;
    const normalizedPreferredTime = preferredTime && (String(preferredTime).includes('AM') || String(preferredTime).includes('PM'))
      ? convert12HourTo24Hour(String(preferredTime))
      : String(preferredTime || '').trim();

    if (!name || !email || !service) {
      return res.status(400).json({
        message: 'Name, email, and service are required.',
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    if (preferredDate && preferredDate < today) {
      return res.status(400).json({ message: 'Appointment date must be today or a future date.' });
    }

    if (preferredDate && normalizedPreferredTime) {
      const scheduleInfo = getClinicScheduleForDate(preferredDate);

      if (!scheduleInfo.operatingDay) {
        return res.status(400).json({
          message: 'The clinic is not open on Sunday. Sunday appointments must be requested through the appointment workflow. Please contact the clinic.',
        });
      }

      const timeValidation = validateAppointmentTime(preferredDate, normalizedPreferredTime);
      if (!timeValidation.valid) {
        return res.status(400).json({ message: timeValidation.error });
      }

      const conflict = await Appointment.findOne({
        preferredDate,
        $or: [
          { preferredTime: normalizedPreferredTime },
          { preferredTime: formatTime12Hour(normalizedPreferredTime) },
          { preferredTime: convert12HourTo24Hour(formatTime12Hour(normalizedPreferredTime)) },
        ],
        status: { $nin: ['cancelled', 'no-show'] },
      });

      if (conflict) {
        return res.status(409).json({ message: 'That appointment time is already booked. Please select another time.' });
      }
    }

    const appointment = await Appointment.create({
      name,
      email,
      phone,
      service,
      preferredDate,
      preferredTime: normalizedPreferredTime,
      message,
      userId,
    });

    broadcastRealtimeEvent(req.app.get('io'), {
      type: 'appointment',
      action: 'created',
      entityId: String(appointment._id),
      payload: publicAppointmentPayload(appointment),
      roles: ['owner', 'optometrist', 'eye-care-assistant'],
      userIds: [userId].filter(Boolean),
      emails: [appointment.email].filter(Boolean),
    });

    try {
      await sendAppointmentNotifications(appointment);
    } catch (emailError) {
      console.error('Appointment email notification error:', emailError.message);
    }

    return res.status(201).json({
      message: 'Appointment request received successfully.',
      appointment,
    });
  } catch (error) {
    console.error('Appointment submission error:', error);
    return res.status(500).json({
      message: 'Failed to submit appointment request.',
      error: error.message,
    });
  }
});

router.get('/mine', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  try {
    const appointments = await Appointment.find({
      $or: [{ userId: req.user.id }, { email: req.user.email }],
    }).sort({ createdAt: -1 });
    return res.status(200).json({ appointments });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load your appointments.', error: error.message });
  }
});

router.get('/', requireAuth, allowRoles('owner', 'optometrist', 'eye-care-assistant'), async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  try {
    const appointments = await Appointment.find().sort({ preferredDate: 1, createdAt: -1 });
    return res.status(200).json({ appointments });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load appointments.', error: error.message });
  }
});

router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status, preferredDate, preferredTime } = req.body;
    const allowedStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'rescheduled', 'no-show'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid appointment status.' });
    }

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found.' });
    }

    const isOwner = req.user.role === 'owner';
    const isPatient = req.user.role === 'patient';
    const isOwnAppointment = String(appointment.userId || '') === String(req.user.id) || appointment.email === req.user.email;

    if (appointment.status === 'completed' && status !== 'completed') {
      return res.status(403).json({ message: 'Completed appointments are locked. Use the owner correction workflow to change them.' });
    }

    if (isPatient) {
      if (!isOwnAppointment) {
        return res.status(403).json({ message: 'You can only update your own appointments.' });
      }
      if (appointment.status !== 'pending' || status !== 'cancelled') {
        return res.status(403).json({ message: 'You can only cancel a pending appointment.' });
      }
    } else if (!['owner', 'optometrist', 'eye-care-assistant'].includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission for this action.' });
    }

    if (status === 'rescheduled') {
      if (!preferredDate || !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) {
        return res.status(400).json({ message: 'A new appointment date is required.' });
      }
      if (!preferredTime || !/^\d{2}:\d{2}$/.test(preferredTime)) {
        return res.status(400).json({ message: 'A new appointment time is required.' });
      }
      const today = new Date().toISOString().slice(0, 10);
      if (preferredDate < today) {
        return res.status(400).json({ message: 'The new appointment date must be today or later.' });
      }
    }

    if (status === 'rescheduled') {
      const scheduleInfo = getClinicScheduleForDate(preferredDate);
      if (!scheduleInfo.operatingDay) return res.status(400).json({ message: 'The clinic is not open on the selected date.' });
      const timeValidation = validateAppointmentTime(preferredDate, preferredTime);
      if (!timeValidation.valid) return res.status(400).json({ message: timeValidation.error });
      const conflict = await Appointment.findOne({
        _id: { $ne: appointment._id },
        preferredDate,
        $or: [{ preferredTime }, { preferredTime: formatTime12Hour(preferredTime) }],
        status: { $nin: ['cancelled', 'no-show'] },
      });
      if (conflict) return res.status(409).json({ message: 'That appointment time is already booked. Please select another time.' });
    }

    const previousStatus = appointment.status;
    appointment.status = status;
    if (status === 'rescheduled') {
      appointment.preferredDate = preferredDate;
      appointment.preferredTime = preferredTime;
    }
    await appointment.save();

    await AuditLog.create({
      actorId: req.user.id,
      action: `Appointment status changed to ${status}`,
      target: `Appointment for ${appointment.name}`,
      details: `${appointment.service} (${appointment.email})`,
      previousData: { status: previousStatus },
      newData: { status: appointment.status },
    });

    const appointmentAction = status === 'rescheduled' ? 'rescheduled' : status === 'completed' ? 'completed' : 'status-updated';
    broadcastRealtimeEvent(req.app.get('io'), {
      type: 'appointment',
      action: appointmentAction,
      entityId: String(appointment._id),
      payload: publicAppointmentPayload(appointment),
      roles: ['owner', 'optometrist', 'eye-care-assistant'],
      userIds: [appointment.userId].filter(Boolean),
      emails: [appointment.email].filter(Boolean),
    });

    return res.status(200).json({ appointment });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update appointment.', error: error.message });
  }
});

router.patch('/:id/correct-status', requireAuth, allowRoles('owner'), async (req, res) => {
  try {
    const { status = 'pending', reason } = req.body;
    const normalizedReason = String(reason || '').trim();
    const allowedStatuses = ['pending', 'confirmed', 'cancelled', 'rescheduled', 'no-show'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid corrected status.' });
    }
    if (!normalizedReason) {
      return res.status(400).json({ message: 'A reason is required to correct a completed appointment.' });
    }

    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found.' });
    }
    if (appointment.status !== 'completed') {
      return res.status(400).json({ message: 'Only completed appointments can be corrected via this workflow.' });
    }

    const previousStatus = appointment.status;
    appointment.status = status;
    await appointment.save();

    await AuditLog.create({
      actorId: req.user.id,
      action: 'Appointment status corrected',
      target: `Appointment for ${appointment.name}`,
      details: `${appointment.service} (${appointment.email}) — reason: ${normalizedReason}`,
      previousData: { status: previousStatus, reason: normalizedReason },
      newData: { status: appointment.status, reason: normalizedReason },
    });

    broadcastRealtimeEvent(req.app.get('io'), {
      type: 'appointment',
      action: 'status-corrected',
      entityId: String(appointment._id),
      payload: publicAppointmentPayload(appointment),
      roles: ['owner', 'optometrist', 'eye-care-assistant'],
      userIds: [appointment.userId].filter(Boolean),
      emails: [appointment.email].filter(Boolean),
    });

    return res.status(200).json({ appointment });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to correct appointment status.', error: error.message });
  }
});

export default router;
