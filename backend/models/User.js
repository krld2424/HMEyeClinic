import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    firstName: String,
    lastName: String,
    middleInitial: String,
    suffix: String,
    age: Number,
    gender: String,
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    patientId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['patient', 'owner', 'optometrist', 'eye-care-assistant'],
      default: 'patient',
      required: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    specialty: {
      type: String,
      trim: true,
    },
    department: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    passwordResetOtpHash: String,
    passwordResetOtpExpiresAt: Date,
    passwordResetOtpAttempts: {
      type: Number,
      default: 0,
    },
    passwordResetTokenHash: String,
    passwordResetTokenExpiresAt: Date,
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model('User', userSchema);

export default User;
