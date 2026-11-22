import nodemailer from 'nodemailer';

export interface EmailOtpResult {
  dispatched: boolean;
  configured: boolean;
  provider?: 'resend' | 'smtp';
  error?: string;
}

export function isEmailServiceConfigured(): boolean {
  if (process.env.RESEND_API_KEY?.trim()) return true;
  if (process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim()) {
    return true;
  }
  return false;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendSecurityOtpEmail(params: {
  to: string;
  code: string;
  subject: string;
  purposeLabel: string;
  detailsLine?: string;
}): Promise<EmailOtpResult> {
  const { to, code, subject, purposeLabel, detailsLine } = params;
  const fromAddress =
    process.env.RESEND_FROM_EMAIL?.trim() ||
    process.env.EMAIL_FROM?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    'security@autobid.app';
  const safePurpose = escapeHtml(purposeLabel);
  const safeDetails = detailsLine ? escapeHtml(detailsLine) : '';
  const safeCode = escapeHtml(code);

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 16px; background: #ffffff;">
      <h2 style="margin: 0 0 8px; color: #111827; font-size: 20px;">AutoBid Security Authorization</h2>
      <p style="margin: 0 0 16px; color: #4b5563; font-size: 14px;">Use the verification code below to authorize: <strong>${safePurpose}</strong>.</p>
      ${safeDetails ? `<p style="margin: 0 0 16px; color: #374151; font-size: 13px; background: #f9fafb; padding: 10px 12px; border-radius: 8px;">${safeDetails}</p>` : ''}
      <div style="background: #111827; color: #ffffff; font-family: monospace; font-size: 28px; font-weight: 800; letter-spacing: 6px; text-align: center; padding: 16px; border-radius: 12px; margin: 16px 0;">
        ${safeCode}
      </div>
      <p style="margin: 12px 0 0; color: #6b7280; font-size: 12px;">This code expires in 10 minutes. Never share this code with anyone. If you did not request this action, contact AutoBid Security immediately.</p>
    </div>
  `;

  // 1. Resend API (recommended for transactional emails)
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [to],
          subject,
          html: htmlBody
        })
      });
      if (!response.ok) {
        const text = await response.text();
        return { dispatched: false, configured: true, provider: 'resend', error: `Resend API error: ${text}` };
      }
      return { dispatched: true, configured: true, provider: 'resend' };
    } catch (err: any) {
      return { dispatched: false, configured: true, provider: 'resend', error: err?.message || 'Resend dispatch failed' };
    }
  }

  // 2. Nodemailer SMTP fallback
  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();
  if (smtpHost && smtpUser && smtpPass) {
    try {
      const port = Number(process.env.SMTP_PORT || 587);
      const secure = process.env.SMTP_SECURE === 'true' || port === 465;
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port,
        secure,
        auth: { user: smtpUser, pass: smtpPass }
      });

      await transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        html: htmlBody
      });
      return { dispatched: true, configured: true, provider: 'smtp' };
    } catch (err: any) {
      return { dispatched: false, configured: true, provider: 'smtp', error: err?.message || 'SMTP dispatch failed' };
    }
  }

  return {
    dispatched: false,
    configured: false,
    error: 'Email service not configured. Set RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS.'
  };
}
