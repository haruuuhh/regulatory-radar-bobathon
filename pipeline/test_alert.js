/**
 * test_alert.js — fires one test message to SMS, WhatsApp, and email
 * using the credentials in .env.  Run once to confirm Twilio is wired up.
 *
 * Usage: node test_alert.js
 */

import 'dotenv/config';
import twilio from 'twilio';

const SID      = process.env.TWILIO_ACCOUNT_SID;
const TOKEN    = process.env.TWILIO_AUTH_TOKEN;
const FROM_SMS = process.env.TWILIO_FROM_SMS;
const FROM_WA  = process.env.TWILIO_FROM_WHATSAPP;
const TO_PHONE = process.env.ALERT_TARGET_PHONE;
const TO_EMAIL = process.env.ALERT_TARGET_EMAIL;

if (!SID || !TOKEN || !FROM_SMS || !TO_PHONE) {
  console.error('❌ Missing required env vars. Check .env');
  process.exit(1);
}

const client = twilio(SID, TOKEN);
const MSG = '🛰️ Regulatory Radar test alert — your Twilio integration is working! (GDGoC TUM Bobathon)';

async function trySend(label, fn) {
  try {
    const m = await fn();
    console.log(`  ✅ ${label} sent  →  SID: ${m.sid}  status: ${m.status}`);
  } catch (err) {
    console.error(`  ❌ ${label} failed  →  ${err.message}`);
  }
}

console.log('── Regulatory Radar — Twilio test ──────────────────────────────');
console.log(`   From SMS/WA : ${FROM_SMS}`);
console.log(`   To phone    : ${TO_PHONE}`);
console.log(`   To email    : ${TO_EMAIL ?? '(not set)'}`);
console.log('');

// 1. SMS
await trySend('SMS', () =>
  client.messages.create({ from: FROM_SMS, to: TO_PHONE, body: MSG })
);

// 2. WhatsApp  (Twilio sandbox: recipient must have sent "join <word>" first)
await trySend('WhatsApp', () =>
  client.messages.create({
    from: FROM_WA,
    to: `whatsapp:${TO_PHONE}`,
    body: MSG,
  })
);

// 3. Email via Twilio SendGrid  (only if SENDGRID_API_KEY + FROM_EMAIL are set)
//    Falls back to a second SMS to the email address if SendGrid isn't configured.
const SG_KEY    = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.TWILIO_FROM_EMAIL;

if (SG_KEY && FROM_EMAIL && TO_EMAIL) {
  // SendGrid REST call (no extra dependency)
  await trySend('Email (SendGrid)', async () => {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SG_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: TO_EMAIL }] }],
        from: { email: FROM_EMAIL },
        subject: '🛰️ Regulatory Radar — test alert',
        content: [{ type: 'text/plain', value: MSG }],
      }),
    });
    if (!res.ok) throw new Error(`SendGrid HTTP ${res.status}: ${await res.text()}`);
    return { sid: 'sendgrid-ok', status: 'sent' };
  });
} else {
  console.log(`  ⚠️  Email skipped — add SENDGRID_API_KEY + TWILIO_FROM_EMAIL to .env to enable.`);
  console.log(`     (Email address on file: ${TO_EMAIL ?? 'none'})`);
}

console.log('\n── Done ─────────────────────────────────────────────────────────');
