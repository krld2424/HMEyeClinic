import { rateLimit } from 'express-rate-limit';

const createLimiter = (windowMs, limit, message, options = {}) => rateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  ...options,
  handler: (_req, res) => res.status(429).json({
    success: false,
    message,
  }),
});

const getLoginRateLimitKey = (req) => {
  const email = String(req.body?.email || req.query?.email || '').trim().toLowerCase();
  return `${req.ip || 'unknown'}:${email || 'anonymous'}`;
};

export const loginLimiter = createLimiter(
  15 * 60 * 1000,
  5,
  'Too many failed login attempts for this account. Please try again later.',
  {
    keyGenerator: (req) => getLoginRateLimitKey(req),
    skipSuccessfulRequests: true,
  }
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
