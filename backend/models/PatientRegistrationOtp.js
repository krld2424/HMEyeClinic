import mongoose from 'mongoose';

const patientRegistrationOtpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: { type: String, required: true },
    firstName: String,
    lastName: String,
    middleInitial: String,
    suffix: String,
    age: { type: Number, required: true },
    gender: String,
    password: { type: String, required: true },
    phone: String,
    otpHash: { type: String, required: true },
    otpExpiresAt: { type: Date, required: true },
    otpAttempts: { type: Number, default: 0 },
    resendAvailableAt: { type: Date, required: true },
    registrationExpiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

patientRegistrationOtpSchema.index({ registrationExpiresAt: 1 }, { expireAfterSeconds: 0 });

const PatientRegistrationOtp = mongoose.models.PatientRegistrationOtp
  || mongoose.model('PatientRegistrationOtp', patientRegistrationOtpSchema);

export default PatientRegistrationOtp;