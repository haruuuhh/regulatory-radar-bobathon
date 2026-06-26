/**
 * api/assess.js — Vercel Serverless Function
 *
 * POST /api/assess
 * Body: JSON  { partners: [...] }           — array of partner objects
 *    OR multipart/form-data with field "file" containing a .json or .csv file
 *
 * Query params:
 *   ?alert=true   — also fire Twilio SMS/WhatsApp per company (uses env vars)
 *
 * Returns: { assessed_at, finding_count, findings: [...] }
 */

import { assessPartners, csvToPartners } from './lib/assess.js';
import { getStaticRules } from './lib/rules.js';

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default async function handler(req, res) {
  // CORS — allow the dashboard (same origin) and any origin for demo purposes
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // ── parse body ──────────────────────────────────────────────────────────────
  let partners;
  try {
    const ct = req.headers['content-type'] ?? '';

    if (ct.includes('application/json')) {
      const body = req.body;
      // accept { partners: [...] }  or  [ ... ]  directly
      partners = Array.isArray(body) ? body : (body.partners ?? [body]);

    } else if (ct.includes('text/csv') || ct.includes('text/plain')) {
      const text = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      partners = csvToPartners(text);

    } else {
      // try JSON parse of raw body as fallback
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const parsed = JSON.parse(raw);
      partners = Array.isArray(parsed) ? parsed : (parsed.partners ?? [parsed]);
    }
  } catch (err) {
    return res.status(400).json({ error: 'Could not parse body', detail: err.message });
  }

  if (!partners || partners.length === 0)
    return res.status(400).json({ error: 'No partners found in request body.' });

  // ── assess ──────────────────────────────────────────────────────────────────
  const rules = getStaticRules();
  const findings = assessPartners(partners, rules);

  const result = {
    assessed_at: new Date().toISOString(),
    finding_count: findings.length,
    partner_count: partners.length,
    product_count: partners.reduce((n, p) => n + (p.products?.length ?? 0), 0),
    findings,
  };

  // ── optional Twilio alerts ──────────────────────────────────────────────────
  if (req.query.alert === 'true') {
    const alertResults = await fireAlerts(findings);
    result.alerts_fired = alertResults;
  }

  return res.status(200).json(result);
}

// ── Twilio alert firing ───────────────────────────────────────────────────────
async function fireAlerts(findings) {
  const SID      = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN    = process.env.TWILIO_AUTH_TOKEN;
  const FROM_SMS = process.env.TWILIO_FROM_SMS;
  const FROM_WA  = process.env.TWILIO_FROM_WHATSAPP;
  const TO       = process.env.ALERT_TARGET_PHONE;

  if (!SID || !TOKEN || !FROM_SMS || !TO)
    return [{ status: 'skipped', reason: 'Twilio env vars not configured' }];

  // group by partner → one consolidated message each
  const byPartner = {};
  for (const f of findings) {
    (byPartner[f.partner_id] = byPartner[f.partner_id] ?? { company: f.company, channel: f.alert.channel, gaps: [] }).gaps.push(f);
  }

  const log = [];
  for (const [pid, { company, channel, gaps }] of Object.entries(byPartner)) {
    const top = gaps.slice(0, 2);
    const body = `[RegulatoryRadar] ${company}: ${gaps.length} gap(s) detected.\n` +
      top.map((g) => `• ${g.product}: ${g.regulation.split('—')[0].trim()}${g.deadline ? ` (by ${g.deadline})` : ''}`).join('\n') +
      (gaps.length > 2 ? `\n…+${gaps.length - 2} more` : '');

    try {
      const from = channel === 'whatsapp' ? FROM_WA : FROM_SMS;
      const to   = channel === 'whatsapp' ? `whatsapp:${TO}` : TO;
      const auth = Buffer.from(`${SID}:${TOKEN}`).toString('base64');
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: from, To: to, Body: body }),
      });
      const data = await r.json();
      log.push({ partner_id: pid, company, status: data.status ?? 'sent', sid: data.sid });
    } catch (e) {
      log.push({ partner_id: pid, company, status: 'error', error: e.message });
    }
  }
  return log;
}
