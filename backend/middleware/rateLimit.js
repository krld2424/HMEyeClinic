import { rateLimit } from 'express-rate-limit';

const createLimiter = (windowMs, limit, message) => rateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    success: false,
    message,
  }),
});

export const loginLimiter = createLimiter(
  15 * 60 * 1000,
  5,
  'Too many login attempts. Please try again later.'
);

export const registrationLimiter = createLimiter(
  60 * 60 * 1000,
  5,
  'Too many registration attempts. Please try again later.'
);

export const forgotPasswordLimiter = createLimiter(
  60 * 60 * 1000,
  3,
  'Too many password reset requests. Please try again later.'
);

export const otpLimiter = createLimiter(
  10 * 60 * 1000,
  5,
  'Too many OTP requests. Please try again later.'
);

export const appointmentCreationLimiter = createLimiter(
  10 * 60 * 1000,
  10,
  'Too many appointment requests. Please try again later.'
);

export const generalApiLimiter = createLimiter(
  15 * 60 * 1000,
  100,
  'Too many requests. Please try again later.'
);
