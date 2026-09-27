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
