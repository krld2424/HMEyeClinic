import express from 'express';
import Appointment from '../models/Appointment.js';
import AuditLog from '../models/AuditLog.js';
import { requireAuth, optionalAuth, allowRoles } from '../middleware/auth.js';
import { sendAppointmentNotifications } from '../config/mailer.js';
import { appointmentCreationLimiter } from '../middleware/rateLimit.js';

const router = express.Router();
const appointmentSlots = ['09:00 AM', '10:30 AM', '01:00 PM', '02:30 PM', '04:00 PM'];

router.get('/availability', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ message: 'A date is required.' });

    const appointments = await Appointment.find({
      preferredDate: date,
      status: { $nin: ['cancelled', 'no-show'] },
    }).select('preferredTime');
    const booked = new Set(appointments.map((appointment) => appointment.preferredTime));

    return res.status(200).json({
      date,
      slots: appointmentSlots.map((time) => ({ time, available: !booked.has(time) })),
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

    if (preferredDate && preferredTime) {
      const conflict = await Appointment.findOne({
        preferredDate,
        preferredTime,
        status: { $nin: ['cancelled', 'no-show'] },
      });

      if (conflict) {
        return res.status(409).json({ message: 'That appointment time is already booked.' });
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

    return res.status(200).json({ appointment });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update appointment.', error: error.message });
  }
});

export default router;
