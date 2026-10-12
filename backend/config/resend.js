import { Resend } from 'resend';

export const sendPasswordResetOtp = async (email, otp) => {
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) {
    throw new Error('Resend password reset email is not configured.');
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: process.env.MAIL_FROM,
    to: email,
    subject: 'Your HM VisionSync password reset code',
    html: `<p>Your password reset code is <strong>${otp}</strong>.</p><p>This code expires in 10 minutes.</p>`,
  });

  if (result.error) throw new Error(result.error.message || 'Resend rejected the email.');
  return result.data;
};

export const sendPatientRegistrationOtp = async (email, otp) => {
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) {
    throw new Error('Resend patient registration email is not configured.');
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: process.env.MAIL_FROM,
    to: email,
    subject: 'Verify your HM VisionSync patient account',
    html: `<p>Your patient registration verification code is <strong>${otp}</strong>.</p><p>This code expires in 10 minutes. If you did not start this registration, you can ignore this email.</p>`,
  });

  if (result.error) throw new Error(result.error.message || 'Resend rejected the email.');
  return result.data;
};

export const sendWalkInAccountInvite = async ({ email, name, temporaryPassword, loginUrl = '' }) => {
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) {
    throw new Error('Patient account invitation email is not configured.');
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: process.env.MAIL_FROM,
    to: email,
    subject: 'Your Hernandez Mercado Eye Clinic account',
    html: `<p>Hello ${String(name).replace(/[&<>"']/g, '')},</p><p>Your patient account is ready. Use this temporary password to sign in: <strong>${String(temporaryPassword).replace(/[&<>"']/g, '')}</strong></p><p>You must reset your password before accessing your account.</p>${loginUrl ? `<p><a href="${loginUrl}">Sign in</a></p>` : ''}`,
  });
  if (result.error) throw new Error(result.error.message || 'Resend rejected the invitation email.');
  return result.data;
};
