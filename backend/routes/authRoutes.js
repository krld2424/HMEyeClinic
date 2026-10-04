import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import PatientRegistrationOtp from '../models/PatientRegistrationOtp.js';
import crypto from 'node:crypto';
import { sendPasswordResetOtp, sendPatientRegistrationOtp } from '../config/resend.js';
import { forgotPasswordLimiter, loginLimiter, otpLimiter, patientRegistrationOtpLimiter, registrationLimiter } from '../middleware/rateLimit.js';
import { broadcastRealtimeEvent, publicUserPayload } from '../config/realtime.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'hm-visionsync-dev-secret';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be configured in production.');
}

const createToken = (user) =>
  jwt.sign(
    {
      id: user._id,
      role: user.role,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

const nextPatientId = async () => {
  const patients = await User.find({ role: 'patient', patientId: /^HME-\d{6}$/ }).select('patientId').sort({ patientId: -1 });
  const highest = patients.reduce((maximum, patient) => Math.max(maximum, Number(patient.patientId.slice(4))), 0);
  return `HME-${String(highest + 1).padStart(6, '0')}`;
};

const genericResetResponse = {
  success: true,
  message: 'If the account exists, a password reset code has been sent.',
};

const hashValue = (value) => crypto.createHash('sha256').update(value).digest('hex');

const registrationOtpLifetimeMs = 10 * 60 * 1000;
const registrationResendCooldownMs = 60 * 1000;
const pendingRegistrationLifetimeMs = 24 * 60 * 60 * 1000;

const readPatientRegistration = (body) => {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim();
  const age = Number(body.age);
  const phone = String(body.phone || '').trim();

  if (!name || !email || !password) {
    return { error: 'Name, email, and password are required.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Enter a valid email address.' };
  }
  if (!Number.isInteger(age) || age < 0 || age > 120) {
    return { error: 'Age must be a whole number between 0 and 120.' };
  }
  if (phone && !/^\+63 \d{3}-\d{3}-\d{4}$/.test(phone)) {
    return { error: 'Contact number must use +63 000-000-0000 format.' };
  }

  return {
    registration: {
      name,
      firstName: String(body.firstName || '').trim(),
      lastName: String(body.lastName || '').trim(),
      middleInitial: String(body.middleInitial || '').trim(),
      suffix: String(body.suffix || '').trim(),
      barangay: String(body.barangay || '').trim(),
      town: String(body.town || '').trim(),
      age,
      gender: String(body.gender || '').trim(),
      email,
      password,
      phone,
    },
  };
};

const verifyTurnstileToken = async (turnstileToken, remoteIp) => {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !turnstileToken) return false;

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        response: turnstileToken,
        remoteip: remoteIp,
      }),
    });

    const verification = await response.json();
    return Boolean(verification.success);
  } catch (error) {
    console.error('Turnstile verification error:', error.message);
    return false;
  }
};

router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(200).json(genericResetResponse);

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(200).json(genericResetResponse);

    const otp = crypto.randomInt(100000, 1000000).toString();
    user.passwordResetOtpHash = hashValue(otp);
    user.passwordResetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    user.passwordResetOtpAttempts = 0;
    user.passwordResetTokenHash = undefined;
    user.passwordResetTokenExpiresAt = undefined;
    await user.save();

    try {
      await sendPasswordResetOtp(user.email, otp);
    } catch (error) {
      user.passwordResetOtpHash = undefined;
      user.passwordResetOtpExpiresAt = undefined;
      user.passwordResetOtpAttempts = 0;
      await user.save();
      console.error('Password reset email error:', error.message);
    }
  } catch (error) {
    console.error('Forgot password error:', error.message);
  }

  return res.status(200).json(genericResetResponse);
});

router.post('/verify-otp', otpLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const otp = String(req.body.otp || '').trim();
  const user = await User.findOne({ email });
  const invalidResponse = { success: false, message: 'Invalid or expired verification code.' };

  if (!user || !/^\d{6}$/.test(otp) || !user.passwordResetOtpHash || !user.passwordResetOtpExpiresAt || user.passwordResetOtpExpiresAt <= new Date()) {
    return res.status(400).json(invalidResponse);
  }

  if (user.passwordResetOtpAttempts >= 5 || hashValue(otp) !== user.passwordResetOtpHash) {
    user.passwordResetOtpAttempts += 1;
    await user.save();
    return res.status(400).json(invalidResponse);
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  user.passwordResetOtpHash = undefined;
  user.passwordResetOtpExpiresAt = undefined;
  user.passwordResetOtpAttempts = 0;
  user.passwordResetTokenHash = hashValue(resetToken);
  user.passwordResetTokenExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();

  return res.status(200).json({ success: true, message: 'Code verified.', resetToken });
});

router.post('/reset-password', async (req, res) => {
  const resetToken = String(req.body.resetToken || '').trim();
  const password = String(req.body.password || '');
  const validPassword = password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
  if (!resetToken || !validPassword) return res.status(400).json({ success: false, message: 'Password must be 8+ characters with uppercase, lowercase, number, and special character.' });

  const user = await User.findOne({
    passwordResetTokenHash: hashValue(resetToken),
    passwordResetTokenExpiresAt: { $gt: new Date() },
  });
  if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired password reset session.' });

  user.password = await bcrypt.hash(password, 10);
  user.passwordResetTokenHash = undefined;
  user.passwordResetTokenExpiresAt = undefined;
  await user.save();
  return res.status(200).json({ success: true, message: 'Password reset successfully.' });
});

router.post('/register', registrationLimiter, patientRegistrationOtpLimiter, async (req, res) => {
  try {
    const { registration, error } = readPatientRegistration(req.body);
    if (error) return res.status(400).json({ success: false, message: error });

    const existingUser = await User.findOne({ email: registration.email });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    const existingPending = await PatientRegistrationOtp.findOne({ email: registration.email });
    const now = new Date();
    if (existingPending && existingPending.registrationExpiresAt > now) {
      return res.status(200).json({
        success: true,
        verificationRequired: true,
        message: 'A verification code has already been sent to this email.',
      });
    }
    if (existingPending) await existingPending.deleteOne();

    const otp = crypto.randomInt(100000, 1000000).toString();
    const pendingRegistration = await PatientRegistrationOtp.create({
      ...registration,
      password: await bcrypt.hash(registration.password, 10),
      otpHash: hashValue(otp),
      otpExpiresAt: new Date(now.getTime() + registrationOtpLifetimeMs),
      otpAttempts: 0,
      resendAvailableAt: new Date(now.getTime() + registrationResendCooldownMs),
      registrationExpiresAt: new Date(now.getTime() + pendingRegistrationLifetimeMs),
    });

    try {
      await sendPatientRegistrationOtp(registration.email, otp);
    } catch (error) {
      await pendingRegistration.deleteOne();
      console.error('Patient registration email error:', error.message);
      return res.status(503).json({
        success: false,
        message: 'Email verification is temporarily unavailable. Please try again later.',
      });
    }

    return res.status(200).json({
      success: true,
      verificationRequired: true,
      message: 'A verification code has been sent to your email address.',
    });
  } catch (error) {
    console.error('Register error:', error);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'A registration for this email is already being verified.' });
    }
    return res.status(500).json({ success: false, message: 'Unable to start registration. Please try again.' });
  }
});

router.post('/register/resend-otp', patientRegistrationOtpLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

  try {
    const pendingRegistration = await PatientRegistrationOtp.findOne({ email });
    const now = new Date();
    if (!pendingRegistration || pendingRegistration.registrationExpiresAt <= now) {
      if (pendingRegistration) await pendingRegistration.deleteOne();
      return res.status(400).json({ success: false, message: 'No pending registration found. Please start again.' });
    }

    const retryAfterSeconds = Math.ceil((pendingRegistration.resendAvailableAt - now) / 1000);
    if (retryAfterSeconds > 0) {
      return res.status(429).json({
        success: false,
        message: `Please wait ${retryAfterSeconds} seconds before requesting another code.`,
        retryAfterSeconds,
      });
    }

    if (await User.exists({ email })) {
      await pendingRegistration.deleteOne();
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    const previousOtpState = {
      otpHash: pendingRegistration.otpHash,
      otpExpiresAt: pendingRegistration.otpExpiresAt,
      otpAttempts: pendingRegistration.otpAttempts,
      resendAvailableAt: pendingRegistration.resendAvailableAt,
    };
    const otp = crypto.randomInt(100000, 1000000).toString();
    pendingRegistration.otpHash = hashValue(otp);
    pendingRegistration.otpExpiresAt = new Date(now.getTime() + registrationOtpLifetimeMs);
    pendingRegistration.otpAttempts = 0;
    pendingRegistration.resendAvailableAt = new Date(now.getTime() + registrationResendCooldownMs);
    await pendingRegistration.save();

    try {
      await sendPatientRegistrationOtp(email, otp);
    } catch (error) {
      Object.assign(pendingRegistration, previousOtpState, { resendAvailableAt: now });
      await pendingRegistration.save();
      console.error('Patient registration resend email error:', error.message);
      return res.status(503).json({ success: false, message: 'Unable to send a new code right now. Please try again later.' });
    }

    return res.status(200).json({ success: true, message: 'A new verification code has been sent.' });
  } catch (error) {
    console.error('Patient registration resend error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to resend the verification code. Please try again.' });
  }
});

router.post('/register/verify-otp', patientRegistrationOtpLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const otp = String(req.body.otp || '').trim();
  if (!email || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ success: false, message: 'Enter the 6-digit verification code sent to your email.' });
  }

  try {
    const pendingRegistration = await PatientRegistrationOtp.findOne({ email });
    const now = new Date();
    if (!pendingRegistration || pendingRegistration.registrationExpiresAt <= now) {
      if (pendingRegistration) await pendingRegistration.deleteOne();
      return res.status(400).json({ success: false, message: 'No pending registration found. Please start again.' });
    }
    if (pendingRegistration.otpExpiresAt <= now) {
      return res.status(400).json({ success: false, message: 'This verification code has expired. Request a new code.' });
    }
    if (pendingRegistration.otpAttempts >= 5) {
      return res.status(429).json({ success: false, message: 'Too many incorrect codes. Request a new code to continue.' });
    }
    if (hashValue(otp) !== pendingRegistration.otpHash) {
      pendingRegistration.otpAttempts += 1;
      await pendingRegistration.save();
      const remainingAttempts = Math.max(0, 5 - pendingRegistration.otpAttempts);
      return res.status(400).json({
        success: false,
        message: remainingAttempts
          ? `Incorrect verification code. ${remainingAttempts} attempts remaining.`
          : 'Too many incorrect codes. Request a new code to continue.',
      });
    }

    if (await User.exists({ email })) {
      await pendingRegistration.deleteOne();
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    const user = await User.create({
      name: pendingRegistration.name,
      firstName: pendingRegistration.firstName,
      lastName: pendingRegistration.lastName,
      middleInitial: pendingRegistration.middleInitial,
      suffix: pendingRegistration.suffix,
      barangay: pendingRegistration.barangay,
      town: pendingRegistration.town,
      age: pendingRegistration.age,
      gender: pendingRegistration.gender,
      email: pendingRegistration.email,
      password: pendingRegistration.password,
      role: 'patient',
      patientId: await nextPatientId(),
      phone: pendingRegistration.phone,
    });
    await pendingRegistration.deleteOne();

    broadcastRealtimeEvent(req.app.get('io'), {
      type: 'user',
      action: 'created',
      entityId: String(user._id),
      payload: publicUserPayload(user),
      roles: ['owner'],
    });

    return res.status(201).json({
      success: true,
      message: 'Email verified and patient account created successfully.',
      token: createToken(user),
      user: {
        id: user._id,
        patientId: user.patientId,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Patient registration verification error:', error);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }
    return res.status(500).json({ success: false, message: 'Unable to verify the code. Please try again.' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'This account is inactive. Contact clinic administration.' });
    }

    if (role && user.role !== role) {
      return res.status(403).json({ message: `This account is not assigned to the ${role} role.` });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    if (user.role === 'patient' && !user.patientId) {
      user.patientId = await nextPatientId();
      await user.save();
    }

    const token = createToken(user);

    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: {
        id: user._id,
        patientId: user.patientId,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Login failed.', error: error.message });
  }
});

export default router;
