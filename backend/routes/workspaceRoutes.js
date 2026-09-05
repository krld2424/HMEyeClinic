import express from 'express';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import ClinicSettings from '../models/ClinicSettings.js';
import Appointment from '../models/Appointment.js';
import ClinicalRecord from '../models/ClinicalRecord.js';
import FollowUp from '../models/FollowUp.js';
import ClinicOperation from '../models/ClinicOperation.js';
import { requireAuth, allowRoles } from '../middleware/auth.js';
import { broadcastRealtimeEvent, publicUserPayload } from '../config/realtime.js';

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
  broadcastRealtimeEvent(req.app.get('io'), {
    type: 'user',
    action: 'updated',
    entityId: String(user._id),
    payload: publicUserPayload(user),
    roles: ['owner'],
    userIds: [String(user._id)],
  });
  return res.status(200).json({ message: 'Profile updated.', user });
});

router.get('/dashboard-summary', allowRoles('patient', 'owner', 'optometrist', 'eye-care-assistant'), async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 6);
    const weekStartDate = weekStart.toISOString().slice(0, 10);
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const weekEnd = nextWeek.toISOString().slice(0, 10);
    const activeAppointmentFilter = { status: { $nin: ['cancelled', 'no-show'] } };
    const isPatient = req.user.role === 'patient';
    const canViewClinical = ['owner', 'optometrist'].includes(req.user.role);
    const patientAppointmentFilter = { $or: [{ userId: req.user.id }, { email: req.user.email }] };

    if (isPatient) {
      const appointmentFilter = { ...patientAppointmentFilter };
      const [appointments, records, followUps] = await Promise.all([
        Appointment.find(appointmentFilter).sort({ preferredDate: 1, preferredTime: 1 }).limit(5),
        ClinicalRecord.countDocuments({ patientId: req.user.id }),
        FollowUp.countDocuments({ patientId: req.user.id, status: { $in: ['requested', 'scheduled'] } }),
      ]);
      const upcomingAppointments = appointments.filter((appointment) => appointment.preferredDate >= today && !['cancelled', 'no-show'].includes(appointment.status));
      return res.status(200).json({
        role: req.user.role,
        metrics: {
          appointments: appointments.length,
          upcomingAppointments: upcomingAppointments.length,
          clinicalRecords: records,
          followUps,
        },
        upcomingAppointments: upcomingAppointments.slice(0, 5),
      });
    }

    const isOwner = req.user.role === 'owner';
    const todayStart = new Date(`${today}T00:00:00.000Z`);
    const todayEnd = new Date(`${today}T23:59:59.999Z`);

    const sharedQueries = [
      User.countDocuments({ role: 'patient' }),
      Appointment.countDocuments({ preferredDate: today, ...activeAppointmentFilter }),
      Appointment.countDocuments({ status: 'pending' }),
      Appointment.countDocuments({ preferredDate: today, status: 'completed' }),
      ClinicalRecord.countDocuments(),
      FollowUp.countDocuments({ status: { $in: ['requested', 'scheduled'] }, $or: [{ preferredDate: { $lte: today } }, { scheduledDate: { $lte: today } }] }),
      Appointment.find({ preferredDate: { $gte: today, $lte: weekEnd }, ...activeAppointmentFilter }).sort({ preferredDate: 1, preferredTime: 1 }).limit(5),
      Appointment.aggregate([
        { $match: { preferredDate: { $gte: weekStartDate, $lte: today } } },
        { $group: { _id: '$preferredDate', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Appointment.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ];

    const ownerQueries = isOwner ? [
      Appointment.countDocuments({ preferredDate: today }),
      Appointment.countDocuments({ preferredDate: today, status: { $in: ['pending', 'confirmed', 'rescheduled'] } }),
      Appointment.countDocuments({ preferredDate: today, status: 'cancelled' }),
      ClinicOperation.find({ recordType: 'inventory-item' }).select('data').lean(),
      ClinicOperation.find({
        recordType: 'payment',
        $or: [
          { 'data.paymentDate': today },
          { createdAt: { $gte: todayStart, $lte: todayEnd } },
        ],
      }).select('data createdAt').lean(),
      ClinicOperation.find({ recordType: 'payment' }).sort({ createdAt: -1 }).limit(5).select('data createdAt').lean(),
      ClinicOperation.find({ recordType: 'invoice' }).select('data').lean(),
      ClinicOperation.find({ recordType: 'payment' }).select('data createdAt').lean(),
      ClinicOperation.countDocuments({
        recordType: 'purchase-order',
        $or: [
          { 'data.status': { $in: ['draft', 'ordered', 'partially-received'] } },
          { status: { $in: ['draft', 'ordered', 'partially-received'] } },
        ],
      }),
      ClinicOperation.countDocuments({ recordType: 'supplier', $or: [{ 'data.status': { $ne: 'inactive' } }, { 'data.status': { $exists: false } }] }),
      User.countDocuments({ role: { $in: ['optometrist', 'eye-care-assistant'] }, isActive: { $ne: false } }),
      AuditLog.find().populate('actorId', 'name role').sort({ createdAt: -1 }).limit(5).lean(),
    ] : [];

    const [
      totalPatients, todayAppointments, pendingAppointments, completedToday,
      clinicalRecords, followUpsDue, upcomingAppointments, trend, statusCounts,
      ...ownerResults
    ] = await Promise.all([...sharedQueries, ...ownerQueries]);

    const response = {
      role: req.user.role,
      metrics: {
        totalPatients,
        todayAppointments,
        pendingAppointments,
        completedToday,
        ...(canViewClinical && { clinicalRecords, followUpsDue }),
      },
      upcomingAppointments,
      trend,
      statusCounts,
    };

    if (isOwner) {
      const [
        todayTotal, pendingToday, cancelledToday, inventoryItems, todayPayments, recentPayments, allInvoices,
        allPayments, pendingPurchaseOrders, activeSuppliers, activeStaff, recentActivity,
      ] = ownerResults;

      const inventoryAlerts = inventoryItems.filter((item) => {
        const quantity = Number(item.data?.quantity || 0);
        const threshold = Number(item.data?.reorderLevel || item.data?.minimumStock || 0);
        return quantity <= 0 || (threshold > 0 && quantity <= threshold);
      }).map((item) => ({
        name: item.data?.name || 'Unknown item',
        sku: item.data?.sku || '',
        quantity: Number(item.data?.quantity || 0),
      }));

      const activePayments = allPayments.filter((payment) => payment.data?.status !== 'reversed' && payment.data?.status !== 'cancelled');
      const openInvoices = allInvoices.filter((invoice) => !['paid', 'cancelled'].includes(invoice.data?.status));
      response.ownerMetrics = {
        todayTotal,
        pendingToday,
        cancelledToday,
        todayRevenue: todayPayments.filter((payment) => payment.data?.status !== 'reversed').reduce((sum, payment) => sum + Number(payment.data?.amount || 0), 0),
        lowStockCount: inventoryAlerts.length,
        outstandingBalance: openInvoices.reduce((sum, invoice) => sum + Number(invoice.data?.balance ?? invoice.data?.total ?? 0), 0),
        billing: {
          totalInvoiced: allInvoices.filter((invoice) => invoice.data?.status !== 'cancelled').reduce((sum, invoice) => sum + Number(invoice.data?.total || 0), 0),
          totalCollected: activePayments.reduce((sum, payment) => sum + Number(payment.data?.amount || 0), 0),
          outstanding: openInvoices.reduce((sum, invoice) => sum + Number(invoice.data?.balance ?? 0), 0),
          overdueAmount: allInvoices.filter((invoice) => invoice.data?.status === 'overdue').reduce((sum, invoice) => sum + Number(invoice.data?.balance || 0), 0),
          paidInvoices: allInvoices.filter((invoice) => invoice.data?.status === 'paid').length,
          unpaidInvoices: allInvoices.filter((invoice) => ['unpaid', 'overdue'].includes(invoice.data?.status)).length,
        },
        pendingPurchaseOrders,
        activeSuppliers,
        activeStaff,
        inventoryAlerts: inventoryAlerts.slice(0, 5),
        recentTransactions: recentPayments.filter((payment) => payment.data?.status !== 'reversed').map((payment) => ({
          amount: Number(payment.data?.amount || 0),
          method: payment.data?.method || 'Payment',
          createdAt: payment.createdAt,
        })),
        recentActivity: recentActivity.map((log) => ({
          action: log.action,
          actor: log.actorId?.name || 'System',
          createdAt: log.createdAt,
        })),
      };
    }

    return res.status(200).json(response);
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load dashboard analytics.' });
  }
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
