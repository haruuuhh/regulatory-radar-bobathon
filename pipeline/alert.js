/**
 * STEP 3 — alert.js
 *
 * Reads findings.json and fires one Twilio notification per finding.
 * Channels: sms | whatsapp | email  (matching partner.contact.preferred_channel)
 *
 * IMPORTANT: All alerts are sent to YOUR OWN test numbers/email set in .env,
 * never to the fake @example.com partner contacts.
 *
 * Set DRY_RUN=true in .env (or environment) to skip Twilio and just log.
 */

import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import twilio from 'twilio';

const DRY_RUN = process.env.DRY_RUN === 'true';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
const FROM_SMS           = process.env.TWILIO_FROM_SMS;
const FROM_WHATSAPP      = process.env.TWILIO_FROM_WHATSAPP ?? 'whatsapp:+14155238886';
const TARGET_PHONE       = process.env.ALERT_TARGET_PHONE;
const TARGET_EMAIL       = process.env.ALERT_TARGET_EMAIL;

// ─── validate env ─────────────────────────────────────────────────────────────
if (!DRY_RUN) {
  const missing = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_SMS', 'ALERT_TARGET_PHONE']
    .filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`❌ Missing env vars: ${missing.join(', ')}`);
    console.error('   Copy .env.example → .env and fill in your Twilio credentials.');
    console.error('   Or set DRY_RUN=true to test without sending.');
    process.exit(1);
  }
}

const client = DRY_RUN ? null : twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// ─── load findings ────────────────────────────────────────────────────────────
const { findings } = JSON.parse(readFileSync('findings.json', 'utf8'));

console.log(`── Step 3: Sending alerts (DRY_RUN=${DRY_RUN}) ─────────────────`);
console.log(`  ${findings.length} findings to alert on`);

// ─── deduplicate: one alert per company per channel ───────────────────────────
// Group findings by partner_id so we send one consolidated message per partner
// rather than spamming them with every individual gap.
const byPartner = {};
for (const f of findings) {
  (byPartner[f.partner_id] = byPartner[f.partner_id] ?? []).push(f);
}

const log = [];

async function sendSms(to, body) {
  if (DRY_RUN) {
    console.log(`  [DRY-RUN SMS → ${to}] ${body}`);
    return { sid: 'dry-run', status: 'dry-run' };
  }
  const msg = await client.messages.create({ from: FROM_SMS, to, body });
  return { sid: msg.sid, status: msg.status };
}

async function sendWhatsApp(to, body) {
  const toWa = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  if (DRY_RUN) {
    console.log(`  [DRY-RUN WA → ${toWa}] ${body}`);
    return { sid: 'dry-run', status: 'dry-run' };
  }
  const msg = await client.messages.create({ from: FROM_WHATSAPP, to: toWa, body });
  return { sid: msg.sid, status: msg.status };
}

// ─── build a consolidated alert message per partner ───────────────────────────
function buildConsolidatedMessage(partnerFindings) {
  const company = partnerFindings[0].company;
  const count   = partnerFindings.length;
  // Take the top 2 gaps (highest severity / nearest deadline)
  const top = partnerFindings.slice(0, 2);
  const lines = top.map(
    (f) =>
      `• ${f.product}: ${f._meta?.known_gap_confirmed ? '⚠' : ''}${f.regulation.split('—')[0].trim()}` +
      (f.deadline ? ` (by ${f.deadline})` : ''),
  );
  const msg =
    `[RegulatoryRadar] ${company}: ${count} compliance gap(s) detected.\n` +
    lines.join('\n') +
    (count > 2 ? `\n…and ${count - 2} more.` : '') +
    `\nFull report: see findings.json`;
  return msg.length > 1600 ? msg.slice(0, 1597) + '...' : msg;
}

// ─── main send loop ───────────────────────────────────────────────────────────
for (const [partnerId, pFindings] of Object.entries(byPartner)) {
  const channel = pFindings[0].alert.channel;
  const company = pFindings[0].company;
  const message = buildConsolidatedMessage(pFindings);

  // Resolve actual target (always your own test destination from .env)
  const to =
    channel === 'email'
      ? (TARGET_EMAIL ?? TARGET_PHONE)
      : (TARGET_PHONE ?? TARGET_EMAIL);

  if (!to) {
    console.warn(`  ⚠ ${company}: no target configured for channel "${channel}" — skipping`);
    log.push({ partner_id: partnerId, company, channel, status: 'skipped', reason: 'no target' });
    continue;
  }

  try {
    let result;
    if (channel === 'whatsapp') {
      result = await sendWhatsApp(to, message);
    } else {
      // sms and email both go over SMS in this demo (swap for SendGrid if needed)
      result = await sendSms(to, message);
    }
    console.log(`  ✓ ${company} [${channel}] → ${result.sid}`);
    log.push({
      partner_id: partnerId,
      company,
      channel,
      to,
      message,
      twilio_sid: result.sid,
      status: result.status,
      sent_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`  ✗ ${company}: ${err.message}`);
    log.push({
      partner_id: partnerId,
      company,
      channel,
      to,
      status: 'error',
      error: err.message,
      sent_at: new Date().toISOString(),
    });
  }
}

writeFileSync('alerts_log.json', JSON.stringify(log, null, 2));
const sent = log.filter((l) => l.status !== 'error' && l.status !== 'skipped').length;
console.log(`\n  ✓ wrote alerts_log.json  (${sent} sent, ${log.length - sent} failed/skipped)`);
