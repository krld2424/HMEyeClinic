import nodemailer from 'nodemailer';

const hasMailConfig = Boolean(
  process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASSWORD
);

const transporter = hasMailConfig
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    })
  : null;

export const sendAppointmentNotifications = async (appointment) => {
  if (!transporter) {
    console.warn('SMTP is not configured. Appointment email notifications were skipped.');
    return;
  }

  const clinicRecipient = process.env.CLINIC_NOTIFICATION_EMAIL || process.env.SMTP_USER;
  const details = `Service: ${appointment.service}\nPreferred date: ${appointment.preferredDate || 'Not provided'}\nPhone: ${appointment.phone || 'Not provided'}\nMessage: ${appointment.message || 'None'}`;

  await Promise.all([
    transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: clinicRecipient,
      subject: `New eye exam request from ${appointment.name}`,
      text: `${details}\n\nPatient email: ${appointment.email}`,
    }),
    transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: appointment.email,
      subject: 'Hernandez Mercado Eye Clinic request received',
      text: `Hello ${appointment.name},\n\nWe received your appointment request. Our clinic team will contact you to confirm the schedule.\n\n${details}`,
    }),
  ]);
};

export const sendPaymentReminder = async ({ name, email, invoiceNumber, balance, dueDate }) => {
  if (!transporter) {
    return { sent: false, message: 'Email notifications are not configured. A clinic reminder was logged instead.' };
  }
  if (!email) {
    return { sent: false, message: 'This customer does not have an email address on file.' };
  }
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: email,
    subject: `Payment reminder for invoice ${invoiceNumber}`,
    text: `Hello ${name || 'valued customer'},\n\nThis is a reminder that invoice ${invoiceNumber} has an outstanding balance of ${balance}. Due date: ${dueDate || 'not specified'}.\n\nPlease contact Hernandez Mercado Eye Clinic to complete payment.\n`,
  });
  return { sent: true, message: `Payment reminder sent to ${email}.` };
};
