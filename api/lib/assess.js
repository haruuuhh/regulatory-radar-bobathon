/**
 * api/lib/assess.js
 * Shared gap-detection logic used by both the CLI (assess_gaps.js) and
 * the Vercel serverless API (api/assess.js).
 *
 * Export: assessPartners(partners, rules) → findings[]
 */

// ── EU member states ──────────────────────────────────────────────────────────
const EU_MEMBERS = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR',
  'HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK',
]);
const isEuMember = (c) => EU_MEMBERS.has(c);

// ── Rules to assess (skip noisy live-fetch generic entries) ───────────────────
export const ASSESS_RULE_IDS = new Set([
  'STATIC-ROHS-HEAVYMETALS',
  'STATIC-BATTERY-PASSPORT-LMT',
  'STATIC-BATTERY-PASSPORT-INDUSTRIAL',
  'STATIC-RED-USBC-CHARGER',
  'STATIC-RED-CYBERSECURITY-EN18031',
  'STATIC-PPWR-PLASTIC-PACKAGING',
  'STATIC-POPS-DECABDE',
  'STATIC-BATTERY-BUTTONCELL-CHILDSAFETY',
  'STATIC-REACH-PFAS-PFHXA',
  'STATIC-REACH-BPA',
  'LIVE-ECHA-SVHC',
]);

// ── Matching helpers ──────────────────────────────────────────────────────────
function marketsMatch(product, rule) {
  const rm = rule.scope?.markets ?? ['EU'];
  if (rm.includes('EU'))
    return (product.markets ?? ['EU']).some((m) => m === 'EU' || isEuMember(m));
  return (product.markets ?? ['EU']).some((m) => rm.includes(m));
}

function categoryMatches(product, rule) {
  const cats = rule.scope?.categories;
  if (!cats || cats === 'all') return true;
  return [].concat(cats).includes(product.category);
}

function substanceMatches(product, rule) {
  const subs = rule.scope?.substances;
  if (!subs || subs.length === 0) return true;
  return (product.substances ?? []).some((s) => subs.includes(s));
}

function attributeMatches(product, rule) {
  if (rule.update_id === 'STATIC-BATTERY-PASSPORT-LMT')
    return product.battery_type === 'lmt';

  if (rule.update_id === 'STATIC-BATTERY-PASSPORT-INDUSTRIAL')
    return product.battery_type === 'industrial' && (product.battery_capacity_wh ?? 0) > 2000;

  if (rule.update_id === 'STATIC-RED-USBC-CHARGER')
    return product.intended_use === 'consumer' &&
      ['micro_usb','lightning','barrel'].includes(product.connector);

  if (rule.update_id === 'STATIC-RED-CYBERSECURITY-EN18031')
    return product.has_radio && product.intended_use !== 'industrial';

  if (rule.update_id === 'STATIC-PPWR-PLASTIC-PACKAGING')
    return (product.packaging ?? []).includes('plastic_film');

  if (rule.update_id === 'STATIC-BATTERY-BUTTONCELL-CHILDSAFETY')
    return product.battery_type === 'button_cell' &&
      ['consumer','toy'].includes(product.intended_use);

  return true;
}

function isExcluded(product, rule) {
  if (rule.regulation_family === 'GPSR' && product.intended_use === 'industrial') return true;
  if (rule.regulation_family === 'ToySafety' && product.intended_use !== 'toy') return true;
  return false;
}

// ── Gap description builders ──────────────────────────────────────────────────
function buildGap(product, rule) {
  const n = product.name;
  switch (rule.update_id) {
    case 'STATIC-BATTERY-PASSPORT-LMT':
      return `${n} (LMT battery) sold in the EU without a digital battery passport / data carrier (QR code).`;
    case 'STATIC-BATTERY-PASSPORT-INDUSTRIAL':
      return `${n} (${product.battery_capacity_wh} Wh industrial battery) sold in the EU without a digital battery passport.`;
    case 'STATIC-RED-USBC-CHARGER':
      return `${n} uses "${product.connector}" connector — USB-C is mandatory for in-scope EU consumer devices since 28 Dec 2024.`;
    case 'STATIC-RED-CYBERSECURITY-EN18031':
      return `${n} is an internet-connected consumer radio device with no documented EN 18031 cybersecurity conformity assessment.`;
    case 'STATIC-PPWR-PLASTIC-PACKAGING':
      return `${n} is packaged in plastic film — PPWR requires phase-out or recycled-content/recyclability compliance.`;
    case 'STATIC-BATTERY-BUTTONCELL-CHILDSAFETY':
      return `${n} contains a button-cell battery accessible without a tool — non-compliant with Battery Reg Art. 12 from Aug 2026.`;
    case 'STATIC-ROHS-HEAVYMETALS': {
      const hit = (product.substances ?? []).filter((s) =>
        ['lead','mercury','cadmium','hexavalent_chromium'].includes(s));
      return `${n} contains restricted heavy metal(s): ${hit.join(', ')}. Must be below RoHS threshold or hold a valid exemption.`;
    }
    case 'STATIC-POPS-DECABDE':
      return `${n} contains decaBDE flame retardant — prohibited under POPs Regulation (>10 mg/kg in articles).`;
    case 'STATIC-REACH-PFAS-PFHXA':
      return `${n} contains PFAS/PFHxA — restricted under REACH Annex XVII Entry 68 (≥25 ppb in consumer articles).`;
    case 'STATIC-REACH-BPA':
      return `${n} contains BPA (REACH SVHC) — must be notified in ECHA SCIP database; inform customers on request.`;
    case 'LIVE-ECHA-SVHC': {
      const hit = (product.substances ?? []).filter((s) =>
        ['BPA','DEHP','DBP','BBP','PFAS_PFHxA','MCCP'].includes(s));
      return `${n} contains SVHC(s) on ECHA Candidate List: ${hit.join(', ')}. REACH Art. 33 communication + SCIP notification required.`;
    }
    default:
      return `${n} may be affected by: ${rule.title}.`;
  }
}

function buildAlertMessage(partner, product, rule) {
  const deadline = rule.deadline_date ? ` by ${rule.deadline_date}` : '';
  const msg = `[RegulatoryRadar] ${partner.company}: ${product.name} — ${rule.regulation_family} gap${deadline}. ${(rule.action_required ?? '').slice(0,80)} Source: ${rule.source_url}`;
  return msg.length > 320 ? msg.slice(0,317) + '...' : msg;
}

// ── CSV parser ────────────────────────────────────────────────────────────────
// Parses the flat partners.csv (one row per product) into the partners[] shape.
export function csvToPartners(csvText) {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));

  const get = (row, key) => {
    const i = headers.indexOf(key);
    if (i < 0) return undefined;
    return row[i]?.trim().replace(/^"|"$/g, '') ?? '';
  };

  const partnerMap = {};

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    // naive CSV split (handles simple quoted fields)
    const row = line.match(/(".*?"|[^,]+)(?=,|$)/g) ?? line.split(',');

    const pid = get(row, 'partner_id') || get(row, 'company');
    if (!pid) continue;

    if (!partnerMap[pid]) {
      partnerMap[pid] = {
        partner_id: pid,
        company: get(row, 'company') || pid,
        hq_country: get(row, 'hq_country') || 'EU',
        sells_in: (get(row, 'sells_in') || 'EU').split('|').map((s) => s.trim()),
        contact: {
          name: get(row, 'contact_name') || 'Compliance',
          email: get(row, 'email') || get(row, 'contact_email') || '',
          phone: get(row, 'phone') || get(row, 'contact_phone') || '',
          preferred_channel: get(row, 'preferred_channel') || 'email',
        },
        products: [],
        compliance_status: null,
      };
    }

    const productId = get(row, 'product_id') || `${pid}-${partnerMap[pid].products.length + 1}`;
    partnerMap[pid].products.push({
      product_id: productId,
      name: get(row, 'product_name') || get(row, 'name') || productId,
      category: get(row, 'category') || 'appliance',
      substances: (get(row, 'substances') || '').split('|').filter(Boolean),
      has_battery: get(row, 'has_battery') === 'true',
      battery_type: get(row, 'battery_type') || 'none',
      battery_capacity_wh: parseFloat(get(row, 'battery_capacity_wh') || '0') || 0,
      has_radio: get(row, 'has_radio') === 'true',
      connector: get(row, 'connector') || 'none',
      packaging: (get(row, 'packaging') || '').split('|').filter(Boolean),
      intended_use: get(row, 'intended_use') || 'consumer',
      markets: (get(row, 'markets') || 'EU').split('|').map((s) => s.trim()),
      compliance_streams: (get(row, 'compliance_streams') || '').split('|').filter(Boolean),
    });
  }

  return Object.values(partnerMap);
}

// ── Main assessment function ──────────────────────────────────────────────────
export function assessPartners(partners, rules) {
  const findings = [];

  for (const partner of partners) {
    const knownGapTexts = (partner.compliance_status?.known_gaps ?? [])
      .map((g) => g.toLowerCase());

    for (const product of (partner.products ?? [])) {
      for (const rule of rules) {
        if (!ASSESS_RULE_IDS.has(rule.update_id)) continue;
        if (isExcluded(product, rule)) continue;
        if (!marketsMatch(product, rule)) continue;
        if (!categoryMatches(product, rule)) continue;
        if (!substanceMatches(product, rule)) continue;
        if (!attributeMatches(product, rule)) continue;

        const gapText = buildGap(product, rule);
        const isKnownGap = knownGapTexts.some((kg) =>
          kg.includes(product.name.split(' ')[0].toLowerCase()));

        findings.push({
          company: partner.company,
          partner_id: partner.partner_id,
          product_id: product.product_id,
          product: product.name,
          regulation: `${rule.title} [${rule.reference}]`,
          requirement: rule.summary.split('.')[0] + '.',
          source_url: rule.source_url,
          gap: gapText,
          deadline: rule.deadline_date,
          severity: isKnownGap ? 'high' : (rule.severity ?? 'medium'),
          recommended_action: rule.action_required ?? 'Review rule applicability and take corrective action.',
          alert: {
            channel: partner.contact?.preferred_channel ?? 'sms',
            to: partner.contact?.phone || partner.contact?.email || '',
            message: buildAlertMessage(partner, product, rule),
          },
          _meta: {
            known_gap_confirmed: isKnownGap,
            assessed_at: new Date().toISOString(),
            rule_source: rule.source,
          },
        });
      }
    }
  }

  // sort: high first, then nearest deadline
  findings.sort((a, b) => {
    const s = { high: 0, medium: 1, low: 2 };
    const sd = (s[a.severity] ?? 1) - (s[b.severity] ?? 1);
    if (sd !== 0) return sd;
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return 0;
  });

  return findings;
}
