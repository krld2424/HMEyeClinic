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
  getFormattedClinicHours,
  getClinicScheduleForDate,
} from '../config/clinicSchedule.js';

const router = express.Router();

router.get('/availability', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ message: 'A date is required.' });

    // Get available slots for this date based on clinic schedule
    const availableSlotTimes = getAvailableSlotsForDate(date);
    const scheduleInfo = getClinicScheduleForDate(date);

    // If clinic is not operating on this day
    if (!scheduleInfo.operatingDay) {
      return res.status(200).json({
        date,
        scheduleInfo,
        clinicHours: getFormattedClinicHours(date),
        slots: [],
      });
    }

    // Get booked appointments for this date
    const appointments = await Appointment.find({
      preferredDate: date,
      status: { $nin: ['cancelled', 'no-show'] },
    }).select('preferredTime');
    const bookedTimes = new Set(appointments.map((appointment) => appointment.preferredTime));

    // Map time slots to format (HH:MM -> 12-hour format)
    const slots = availableSlotTimes.map((time) => ({
      time24Hr: time,
      time: formatTime12Hour(time),
      available: !bookedTimes.has(formatTime12Hour(time)) && !bookedTimes.has(time),
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

    if (!name || !email || !service) {
      return res.status(400).json({
        message: 'Name, email, and service are required.',
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    if (preferredDate && preferredDate < today) {
      return res.status(400).json({ message: 'Appointment date must be today or a future date.' });
    }

    // Validate appointment time against clinic schedule if both date and time are provided
    if (preferredDate && preferredTime) {
      const scheduleInfo = getClinicScheduleForDate(preferredDate);

      // Check if clinic is operating on this day
      if (!scheduleInfo.operatingDay) {
        return res.status(400).json({
          message: 'The clinic is not open on Sunday. Sunday appointments must be requested through the appointment workflow. Please contact the clinic.',
        });
      }

      // Validate the time is within clinic hours
      const timeValidation = validateAppointmentTime(preferredDate, preferredTime);
      if (!timeValidation.valid) {
        return res.status(400).json({ message: timeValidation.error });
      }

      // Check for appointment conflicts
      const conflict = await Appointment.findOne({
        preferredDate,
        $or: [
          { preferredTime }, // Exact time match
          { preferredTime: formatTime12Hour(preferredTime) }, // Handle format conversion
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
      preferredTime,
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
  try {
    const appointments = await Appointment.find().sort({ preferredDate: 1, createdAt: -1 });
    return res.status(200).json({ appointments });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load appointments.', error: error.message });
  }
});

router.patch('/:id/status', requireAuth, allowRoles('owner', 'optometrist', 'eye-care-assistant'), async (req, res) => {
  try {
    const { status } = req.body;
    const allowedStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'rescheduled', 'no-show'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid appointment status.' });
    }

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found.' });
    }

    const previousStatus = appointment.status;
    appointment.status = status;
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

export default router;
