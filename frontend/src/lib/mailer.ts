import { env } from './env';

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Swap EMAIL_DRIVER to "resend" (and set RESEND_API_KEY) to send for real.
 * The console driver keeps local development free of external dependencies.
 */
export async function sendEmail(message: OutboundEmail): Promise<void> {
  if (env.EMAIL_DRIVER === 'console') {
    console.info(
      `\n--- EMAIL (console driver) ---\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n------------------------------\n`,
    );
    return;
  }

  if (!env.RESEND_API_KEY) {
    throw new Error('EMAIL_DRIVER is "resend" but RESEND_API_KEY is not set.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Email delivery failed (${response.status}): ${await response.text()}`);
  }
}

export function verificationEmail(to: string, url: string): OutboundEmail {
  return {
    to,
    subject: 'Confirm your SkyUp News email',
    text: `Welcome to SkyUp News.\n\nConfirm your email address to finish setting up your account:\n\n${url}\n\nThis link expires in 24 hours. If you did not create an account, you can ignore this message.`,
  };
}

export function passwordResetEmail(to: string, url: string): OutboundEmail {
  return {
    to,
    subject: 'Reset your SkyUp News password',
    text: `We received a request to reset your SkyUp News password.\n\n${url}\n\nThis link expires in 1 hour and can only be used once. If you did not request a reset, no action is needed — your password has not changed.`,
  };
}
