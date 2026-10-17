import nodemailer from 'nodemailer';
import { config } from '../config.ts';

const transport = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

export async function sendSignInCode(email: string, code: string): Promise<void> {
  if (!transport) {
    // Development: no mail server configured, so print the code for the developer.
    console.log(`\n[email] Sign-in code for ${email}: ${code}\n`);
    return;
  }
  await transport.sendMail({
    from: config.smtp.from,
    to: email,
    subject: `${code} is your CampusBite sign-in code`,
    text: `Your CampusBite sign-in code is ${code}.\n\nIt expires in 10 minutes. If you didn't ask for it, you can ignore this email.`,
    html: `<p>Your CampusBite sign-in code is</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p>`,
  });
}
