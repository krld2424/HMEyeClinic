import mongoose from 'mongoose';

const followUpSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    patientName: {
      type: String,
      required: true,
      trim: true,
    },
    patientEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    preferredDate: {
      type: String,
      trim: true,
    },
    scheduledDate: {
      type: String,
      trim: true,
    },
    relatedRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClinicalRecord',
      default: null,
    },
    reminderDaysBefore: {
      type: Number,
      min: 0,
      default: 3,
    },
    reminderScheduledFor: {
      type: String,
      trim: true,
      default: null,
    },
    reminderStatus: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'cancelled'],
      default: 'pending',
    },
    reminderChannel: {
      type: String,
      default: 'email',
    },
    reminderSentAt: {
      type: Date,
      default: null,
    },
    reminderLog: [
      {
        status: { type: String, enum: ['sent', 'failed'], required: true },
        channel: { type: String, default: 'email' },
        sentAt: { type: Date, default: Date.now },
        message: { type: String, trim: true },
      },
    ],
    notes: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['requested', 'scheduled', 'completed', 'rejected', 'cancelled'],
      default: 'requested',
    },
  },
  { timestamps: true }
);

const FollowUp = mongoose.models.FollowUp || mongoose.model('FollowUp', followUpSchema);

export default FollowUp;
