import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import crypto from 'node:crypto';
import { sendPasswordResetOtp } from '../config/resend.js';
import { forgotPasswordLimiter, loginLimiter, otpLimiter, registrationLimiter } from '../middleware/rateLimit.js';
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

router.post('/register', registrationLimiter, async (req, res) => {
  try {
    const { name, firstName, lastName, middleInitial, suffix, age, gender, email, password, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required.' });
    }

    if (phone && !/^\+63 \d{3}-\d{3}-\d{4}$/.test(phone)) {
      return res.status(400).json({ message: 'Contact number must use +63 000-000-0000 format.' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      firstName,
      lastName,
      middleInitial,
      suffix,
      age,
      gender,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: 'patient',
      patientId: await nextPatientId(),
      phone,
    });

    const token = createToken(user);

    broadcastRealtimeEvent(req.app.get('io'), {
      type: 'user',
      action: 'created',
      entityId: String(user._id),
      payload: publicUserPayload(user),
      roles: ['owner'],
    });

    return res.status(201).json({
      message: 'Account created successfully.',
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
    console.error('Register error:', error);
    return res.status(500).json({ message: 'Registration failed.', error: error.message });
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
