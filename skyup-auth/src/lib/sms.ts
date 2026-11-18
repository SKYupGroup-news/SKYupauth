import { env } from './env';

/**
 * Swap SMS_DRIVER to "twilio" (and set the TWILIO_* variables) to send for real.
 */
export async function sendSms(to: string, body: string): Promise<void> {
  if (env.SMS_DRIVER === 'console') {
    console.info(`\n--- SMS (console driver) ---\nTo: ${to}\n\n${body}\n----------------------------\n`);
    return;
  }

  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM_NUMBER: from } = env;
  if (!sid || !token || !from) {
    throw new Error('SMS_DRIVER is "twilio" but TWILIO_* variables are incomplete.');
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    },
  );

  if (!response.ok) {
    throw new Error(`SMS delivery failed (${response.status}): ${await response.text()}`);
  }
}

export function otpMessage(code: string): string {
  return `${code} is your SkyUp News verification code. It expires in 5 minutes. Never share this code with anyone.`;
}
