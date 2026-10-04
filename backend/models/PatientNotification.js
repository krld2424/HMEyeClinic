import mongoose from 'mongoose';

const patientNotificationSchema = new mongoose.Schema({
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  eventKey: { type: String, required: true, unique: true },
  message: { type: String, required: true },
  href: { type: String, required: true },
  readAt: { type: Date, default: null },
}, { timestamps: true });

patientNotificationSchema.index({ recipientId: 1, readAt: 1, createdAt: -1 });

const PatientNotification = mongoose.models.PatientNotification || mongoose.model('PatientNotification', patientNotificationSchema);

export default PatientNotification;