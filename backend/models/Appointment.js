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
      required: true,
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
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'cancelled', 'rejected', 'rescheduled', 'no-show'],
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
