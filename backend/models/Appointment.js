import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      default: '',
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    service: {
      type: String,
      required: true,
      trim: true,
    },
    preferredDate: {
      type: String,
      trim: true,
    },
    preferredTime: {
      type: String,
      trim: true,
    },
    lastReschedule: {
      previousDate: { type: String, trim: true },
      previousTime: { type: String, trim: true },
      newDate: { type: String, trim: true },
      newTime: { type: String, trim: true },
      rescheduledAt: { type: Date },
    },
    message: {
      type: String,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    bookingType: { type: String, enum: ['scheduled', 'walk_in'], default: 'scheduled', index: true },
    queueNumber: { type: Number, index: true },
    checkInTime: { type: Date, index: true },
    calledAt: { type: Date },
    queueToken: { type: String, unique: true, sparse: true, index: true },
    patientRecordId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClinicalRecord' },
    accountRequested: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'checked_in', 'waiting', 'in_progress', 'completed', 'cancelled', 'rejected', 'rescheduled', 'no-show'],
      default: 'pending',
    },
    archived: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

const Appointment = mongoose.models.Appointment || mongoose.model('Appointment', appointmentSchema);

export default Appointment;
