import express from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import Appointment from '../models/Appointment.js';
import ClinicalRecord from '../models/ClinicalRecord.js';
import QueueCounter from '../models/QueueCounter.js';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import { requireAuth, optionalAuth, allowRoles } from '../middleware/auth.js';
import { sendAppointmentNotifications } from '../config/mailer.js';
import { appointmentCreationLimiter } from '../middleware/rateLimit.js';
import { broadcastRealtimeEvent, publicAppointmentPayload } from '../config/realtime.js';
import { createPatientNotification } from '../utils/patientNotification.js';
import { sendWalkInAccountInvite } from '../config/resend.js';
import {
  getAvailableSlotsForDate,
  validateAppointmentTime,
  formatTime12Hour,
  convert12HourTo24Hour,
  getFormattedClinicHours,
  getClinicScheduleForDate,
} from '../config/clinicSchedule.js';

const router = express.Router();
const queueActiveStatuses = ['checked_in', 'waiting', 'in_progress'];
const getWalkInQueueBufferMinutes = () => {
  const configured = Number(process.env.WALK_IN_QUEUE_BUFFER_MINUTES || 15);
  return Number.isFinite(configured) ? Math.min(15, Math.max(10, configured)) : 15;
};
const clinicDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const nextPatientId = async () => {
  const patients = await User.find({ role: 'patient', patientId: /^HME-\d{6}$/ }).select('patientId').sort({ patientId: -1 });
  const highest = patients.reduce((maximum, patient) => Math.max(maximum, Number(patient.patientId.slice(4))), 0);
  return `HME-${String(highest + 1).padStart(6, '0')}`;
};
const nextQueueNumber = async (day) => {
  try {
    const counter = await QueueCounter.findOneAndUpdate({ day }, { $inc: { sequence: 1 } }, { new: true, upsert: true, setDefaultsOnInsert: true });
    return counter.sequence;
  } catch (error) {
    if (error.code !== 11000) throw error;
    const counter = await QueueCounter.findOneAndUpdate({ day }, { $inc: { sequence: 1 } }, { new: true });
    return counter.sequence;
  }
};
const scheduledQueueTime = (appointment) => {
  const rawTime = String(appointment.preferredTime || '').trim();
  const normalizedTime = /AM|PM/i.test(rawTime) ? convert12HourTo24Hour(rawTime) : rawTime;
  const scheduled = appointment.preferredDate && normalizedTime
    ? new Date(`${appointment.preferredDate}T${normalizedTime}:00+08:00`).getTime()
    : NaN;
  return Number.isFinite(scheduled) ? scheduled : new Date(appointment.checkInTime || appointment.createdAt).getTime();
};
const queueSortTime = (appointment) => appointment.bookingType === 'walk_in' && appointment.checkInTime
  ? new Date(appointment.checkInTime).getTime()
  : scheduledQueueTime(appointment);
const activeQueueForDay = async (day) => {
  const start = new Date(`${day}T00:00:00+08:00`);
  const end = new Date(`${day}T23:59:59.999+08:00`);
  const records = await Appointment.find({ archived: { $ne: true }, status: { $in: queueActiveStatuses }, $or: [{ checkInTime: { $gte: start, $lte: end } }, { preferredDate: day }] }).lean();
  return records.sort((a, b) => queueSortTime(a) - queueSortTime(b) || String(a._id).localeCompare(String(b._id)));
};
const getWalkInCallAvailability = (appointment, queue, now = new Date()) => {
  if (appointment.bookingType !== 'walk_in') return { callable: true, availableAt: null, availableInMinutes: 0 };
  const position = queue.findIndex((item) => String(item._id) === String(appointment._id));
  if (position < 0) return { callable: true, availableAt: null, availableInMinutes: 0 };
  const bufferMs = getWalkInQueueBufferMinutes() * 60 * 1000;
  const blockedUntil = queue.slice(0, position).filter((item) => item.bookingType !== 'walk_in').reduce((latest, scheduled) => {
    const scheduledTime = scheduled.status === 'in_progress' && scheduled.calledAt
      ? new Date(scheduled.calledAt).getTime()
      : scheduledQueueTime(scheduled);
    return Math.max(latest, scheduledTime + bufferMs);
  }, 0);
  const availableAt = blockedUntil || null;
  return {
    callable: !availableAt || availableAt <= now.getTime(),
    availableAt: availableAt ? new Date(availableAt).toISOString() : null,
    availableInMinutes: availableAt > now.getTime() ? Math.ceil((availableAt - now.getTime()) / 60000) : 0,
  };
};

router.post('/walk-in', appointmentCreationLimiter, requireAuth, allowRoles('eye-care-assistant'), async (req, res) => {
  let patientUser;
  try {
    const { patient = {}, record = {}, accountRequested = false, accountEmail = '' } = req.body || {};
    const name = String(patient.name || '').trim();
    const surname = String(patient.surname || '').trim();
    const phone = String(patient.phone || '').trim();
    const service = String(record.service || patient.service || '').trim();
    const wantsAccount = accountRequested === true;
    const email = String(accountEmail || '').trim().toLowerCase();
    const accountEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    let canCreateAccount = wantsAccount && accountEmailValid && Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
    if (!name || !surname || !phone || !service) return res.status(400).json({ message: 'Name, surname, contact number, and service needed are required.' });

    if (patient.patientId) patientUser = await User.findOne({ _id: patient.patientId, role: 'patient' });
    if (!patientUser && phone) patientUser = await User.findOne({ role: 'patient', phone });
    if (!patientUser && accountEmailValid) {
      const existingEmail = await User.findOne({ email, role: 'patient' });
      if (existingEmail) patientUser = existingEmail;
      else if (await User.exists({ email })) canCreateAccount = false;
    }

    let temporaryPassword = '';
    if (patientUser && canCreateAccount && String(patientUser.email || '').endsWith('@patient.local')) {
      temporaryPassword = crypto.randomBytes(12).toString('base64url');
      patientUser.email = email;
      patientUser.password = await bcrypt.hash(temporaryPassword, 10);
      patientUser.mustResetPassword = true;
      await patientUser.save();
    }
    if (!patientUser) {
      temporaryPassword = canCreateAccount ? crypto.randomBytes(12).toString('base64url') : crypto.randomBytes(32).toString('hex');
      patientUser = await User.create({
        name: [name, surname].filter(Boolean).join(' '), firstName: name, lastName: surname,
        email: canCreateAccount ? email : `manual-${crypto.randomUUID()}@patient.local`,
        password: await bcrypt.hash(temporaryPassword, 10), role: 'patient', patientId: await nextPatientId(),
        phone, age: patient.age ? Number(patient.age) : undefined, gender: patient.gender,
        barangay: patient.brgy, town: patient.town, mustResetPassword: canCreateAccount,
      });
    }

    const patientRecord = await ClinicalRecord.create({
      patientId: patientUser._id, authorId: req.user.id, type: 'medical-record', title: 'Patient Record',
      details: JSON.stringify({ ...record, patientId: patientUser.patientId || String(patientUser._id), patientName: patientUser.name, surname, name, phone, age: patient.age, gender: patient.gender, brgy: patient.brgy, town: patient.town }),
      status: 'active', issuedAt: record.date || clinicDay(),
    });
    const day = clinicDay();
    const queueNumber = await nextQueueNumber(day);
    const queueToken = crypto.randomBytes(24).toString('hex');
    const appointment = await Appointment.create({
      name: patientUser.name, email: patientUser.email, phone, service, userId: patientUser._id,
      bookingType: 'walk_in', status: 'checked_in', preferredDate: day, queueNumber,
      checkInTime: new Date(), queueToken, patientRecordId: patientRecord._id, accountRequested: wantsAccount,
    });
    const appUrl = String(process.env.PUBLIC_APP_URL || req.get('origin') || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    let invitationSent = false;
    if (canCreateAccount && temporaryPassword) {
      try { await sendWalkInAccountInvite({ email, name: patientUser.name, temporaryPassword, loginUrl: `${appUrl}/login` }); invitationSent = true; }
      catch (error) { console.error('Walk-in account invite failed:', error.message); }
    }
    const ticketUrl = `${appUrl}/queue-status?token=${encodeURIComponent(queueToken)}`;
    const responseAppointment = publicAppointmentPayload(appointment);
    broadcastRealtimeEvent(req.app.get('io'), { type: 'appointment', action: 'created', entityId: String(appointment._id), payload: responseAppointment, roles: ['owner', 'optometrist', 'eye-care-assistant'] });
    broadcastRealtimeEvent(req.app.get('io'), { type: 'clinical-record', action: 'created', entityId: String(patientRecord._id), payload: { _id: String(patientRecord._id), patientId: String(patientUser._id), type: patientRecord.type, title: patientRecord.title }, roles: ['owner', 'optometrist', 'eye-care-assistant'] });
    return res.status(201).json({ message: 'Walk-in added to today’s queue.', appointment: responseAppointment, patientRecord, ticketUrl, invitationSent, accountLinked: Boolean(wantsAccount && !temporaryPassword) });
  } catch (error) {
    console.error('Walk-in registration error:', error);
    return res.status(500).json({ message: error.message || 'Unable to register the walk-in.' });
  }
});

router.get('/queue/today', requireAuth, allowRoles('owner', 'optometrist', 'eye-care-assistant'), async (req, res) => {
  try {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : clinicDay();
    const appointments = await activeQueueForDay(day);
    const now = new Date();
    return res.status(200).json({
      date: day,
      walkInBufferMinutes: getWalkInQueueBufferMinutes(),
      appointments: appointments.map((appointment, index) => ({
        ...publicAppointmentPayload(appointment),
        queuePosition: index + 1,
        waitMinutes: index * 15,
        ...getWalkInCallAvailability(appointment, appointments, now),
      })),
    });
  } catch (error) { return res.status(500).json({ message: 'Unable to load today’s queue.', error: error.message }); }
});

router.get('/queue/status/:token', async (req, res) => {
  try {
    const appointment = await Appointment.findOne({ queueToken: req.params.token, archived: { $ne: true } }).lean();
    if (!appointment) return res.status(404).json({ message: 'Queue ticket not found.' });
    const day = clinicDay(appointment.checkInTime || appointment.createdAt);
    const queue = await activeQueueForDay(day);
    const index = queue.findIndex((item) => String(item._id) === String(appointment._id));
    return res.status(200).json({ queueNumber: appointment.queueNumber, date: day, service: appointment.service, status: appointment.status, position: index < 0 ? null : index + 1, estimatedWaitMinutes: index < 0 ? 0 : index * 15 });
  } catch (error) { return res.status(500).json({ message: 'Unable to load queue status.', error: error.message }); }
});

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
    const archivedOnly = String(req.query.archived || '').toLowerCase() === 'true';
    const appointments = await Appointment.find({
      ...(archivedOnly ? {} : { archived: { $ne: true } }),
      $or: [{ userId: req.user.id }, { email: req.user.email }],
    }).sort({ createdAt: -1 });
    return res.status(200).json({ appointments, statuses: Appointment.schema.path('status').enumValues });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load your appointments.', error: error.message });
  }
});

router.get('/', requireAuth, allowRoles('owner', 'optometrist', 'eye-care-assistant'), async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  try {
    const archivedOnly = String(req.query.archived || '').toLowerCase() === 'true';
    const appointments = await Appointment.find({ ...(archivedOnly ? {} : { archived: { $ne: true } }) }).sort({ preferredDate: 1, createdAt: -1 });
    return res.status(200).json({ appointments, statuses: Appointment.schema.path('status').enumValues });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load appointments.', error: error.message });
  }
});

router.patch('/:id/archive', requireAuth, async (req, res) => {
  try {
    const action = typeof req.body?.archived === 'boolean' ? req.body.archived : true;
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found.' });
    if (!['owner', 'optometrist', 'eye-care-assistant'].includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission for this action.' });
    }
    const previous = { archived: appointment.archived, status: appointment.status };
    appointment.archived = action;
    if (action && appointment.status !== 'rejected') {
      appointment.status = 'cancelled';
    }
    await appointment.save();
    await AuditLog.create({
      actorId: req.user.id,
      action: action ? 'Archived appointment' : 'Restored appointment',
      target: `Appointment:${appointment._id}`,
      previousData: previous,
      newData: { archived: appointment.archived, status: appointment.status },
    });
    return res.status(200).json({ message: action ? 'Appointment archived.' : 'Appointment restored.', appointment });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Unable to archive appointment.' });
  }
});

router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status, preferredDate, preferredTime } = req.body;
    const allowedStatuses = ['pending', 'confirmed', 'checked_in', 'waiting', 'in_progress', 'completed', 'cancelled', 'rejected', 'rescheduled', 'no-show'];

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

    if (status === 'in_progress' && appointment.bookingType === 'walk_in') {
      const queue = await activeQueueForDay(clinicDay(appointment.checkInTime || new Date()));
      const availability = getWalkInCallAvailability(appointment.toObject(), queue);
      if (!availability.callable) {
        return res.status(409).json({
          message: `This walk-in can be called in ${availability.availableInMinutes} min.`,
          ...availability,
        });
      }
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
    const previousSchedule = {
      preferredDate: appointment.preferredDate,
      preferredTime: appointment.preferredTime,
    };
    appointment.status = status;
    if (status === 'in_progress' && previousStatus !== 'in_progress') appointment.calledAt = new Date();
    if (status === 'checked_in' && !appointment.checkInTime) {
      appointment.checkInTime = new Date();
      appointment.queueNumber = await nextQueueNumber(clinicDay(appointment.checkInTime));
      appointment.bookingType = appointment.bookingType || 'scheduled';
    }
    if (status === 'rejected') {
      appointment.archived = true;
    }
    if (status === 'rescheduled') {
      appointment.lastReschedule = {
        previousDate: appointment.preferredDate,
        previousTime: appointment.preferredTime,
        newDate: preferredDate,
        newTime: preferredTime,
        rescheduledAt: new Date(),
      };
      appointment.preferredDate = preferredDate;
      appointment.preferredTime = preferredTime;
    }
    await appointment.save();

    await AuditLog.create({
      actorId: req.user.id,
      action: status === 'rejected' ? 'Rejected appointment and archived it' : `Appointment status changed to ${status}`,
      target: `Appointment for ${appointment.name}`,
      details: `${appointment.service} (${appointment.email})`,
      previousData: { status: previousStatus, archived: appointment.archived, ...previousSchedule },
      newData: {
        status: appointment.status,
        archived: appointment.archived,
        preferredDate: appointment.preferredDate,
        preferredTime: appointment.preferredTime,
        ...(status === 'rescheduled' ? { lastReschedule: appointment.lastReschedule } : {}),
      },
    });

    if (!isPatient && (previousStatus !== status || status === 'rescheduled')) {
      const recipient = (appointment.userId && await User.findOne({ _id: appointment.userId, role: 'patient' }).select('_id'))
        || await User.findOne({ email: String(appointment.email || '').toLowerCase(), role: 'patient' }).select('_id');
      if (recipient) {
        const statusLabel = status.replace(/[-_]/g, ' ');
        const message = status === 'rescheduled'
          ? `Your ${appointment.service} appointment has been rescheduled to ${appointment.preferredDate}${appointment.preferredTime ? ` at ${appointment.preferredTime}` : ''}.`
          : `Your ${appointment.service} appointment status changed to ${statusLabel}.`;
        await createPatientNotification({
          recipientId: recipient._id,
          eventKey: `appointment-status:${appointment._id}:${previousStatus}:${status}:${appointment.updatedAt.getTime()}`,
          message,
          href: '/dashboard/patient/appointments',
        });
      }
    }

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
