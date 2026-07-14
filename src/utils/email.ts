import { config } from '../config.js';
import { logger } from './logger.js';

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!config.smtp.host) {
    logger.warn(`SMTP not configured. Skipping email to ${to}: ${subject}`);
    return false;
  }

  try {
    const { createTransport } = await import('nodemailer');
    const transporter = createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });

    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject,
      html,
    });

    logger.info(`Email sent to ${to}: ${subject}`);
    return true;
  } catch (err) {
    logger.error(`Failed to send email to ${to}:`, err);
    return false;
  }
}

export function verificationEmailTemplate(code: string): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">
      <h1 style="color: #f177ae;">thaypley</h1>
      <p>Your verification code is:</p>
      <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 24px; background: #f5f5f5; border-radius: 8px; margin: 16px 0;">
        ${code}
      </div>
      <p style="color: #666;">This code expires in 15 minutes.</p>
    </div>
  `;
}

export function passwordResetEmailTemplate(resetUrl: string): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">
      <h1 style="color: #f177ae;">thaypley</h1>
      <p>Click below to reset your password:</p>
      <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #f177ae; color: white; text-decoration: none; border-radius: 6px; margin: 16px 0;">
        Reset Password
      </a>
      <p style="color: #666;">This link expires in 1 hour.</p>
    </div>
  `;
}
