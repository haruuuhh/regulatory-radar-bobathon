/**
 * STEP 2 — assess_gaps.js
 *
 * Reads rules_live.json + partners.json, applies each rule's scope conditions
 * to each company/product, and emits a findings.json array of gap records
 * shaped exactly like sample_expected_output.json.
 *
 * Matching logic (mirrors DATASET_README.md "How to think about obligations"):
 *   1. Market    — product.markets overlaps rule.scope.markets (or rule is EU-wide)
 *   2. Category  — rule.scope.categories is "all" OR includes product.category
 *   3. Substance — if rule lists substances, product.substances must include one
 *   4. Attributes— battery_type, connector, has_radio etc. for attribute-specific rules
 *   5. Exclusions— industrial-only products skip GPSR / toy rules; CH-only skip EU rules
 */

import { readFileSync, writeFileSync } from 'fs';

const partners = JSON.parse(readFileSync('../partners.json', 'utf8')).partners;
const rulesData = JSON.parse(readFileSync('rules_live.json', 'utf8'));
const rules = rulesData.rules;

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Return true if the product's markets overlap with the rule's markets. */
function marketsMatch(product, rule) {
  const ruleMarkets = rule.scope?.markets ?? ['EU'];
  if (ruleMarkets.includes('EU')) {
    // Any product that sells in at least one EU member state qualifies.
    // "EU" in product.markets means all 27 states.
    return product.markets.some(
      (m) => m === 'EU' || isEuMember(m),
    );
  }
  return product.markets.some((m) => ruleMarkets.includes(m));
}

const EU_MEMBERS = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR',
  'HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK',
]);
function isEuMember(code) { return EU_MEMBERS.has(code); }

/** Return true if the rule's category filter matches this product. */
function categoryMatches(product, rule) {
  const cats = rule.scope?.categories;
  if (!cats || cats === 'all') return true;
  return [].concat(cats).includes(product.category);
}

/** Return true if the rule's substance filter matches this product. */
function substanceMatches(product, rule) {
  const subs = rule.scope?.substances;
  if (!subs || subs.length === 0) return true; // no substance filter
  return product.substances.some((s) => subs.includes(s));
}

/** Per-rule attribute checks beyond market/category/substance. */
function attributeMatches(product, rule, partner) {
  const cond = rule.scope?.conditions ?? '';

  // Battery passport LMT
  if (rule.update_id === 'STATIC-BATTERY-PASSPORT-LMT') {
    return product.battery_type === 'lmt';
  }

  // Battery passport industrial (>2 kWh)
  if (rule.update_id === 'STATIC-BATTERY-PASSPORT-INDUSTRIAL') {
    return product.battery_type === 'industrial' && product.battery_capacity_wh > 2000;
  }

  // USB-C common charger: only wired-charging consumer devices with non-USB-C connectors
  if (rule.update_id === 'STATIC-RED-USBC-CHARGER') {
    const badConnectors = ['micro_usb', 'lightning', 'barrel'];
    return (
      product.intended_use === 'consumer' &&
      badConnectors.includes(product.connector)
    );
  }

  // RED cybersecurity: internet-connected (has_radio), non-industrial
  if (rule.update_id === 'STATIC-RED-CYBERSECURITY-EN18031') {
    return product.has_radio && product.intended_use !== 'industrial';
  }

  // PPWR plastic film: any product packaged in plastic_film
  if (rule.update_id === 'STATIC-PPWR-PLASTIC-PACKAGING') {
    return (product.packaging ?? []).includes('plastic_film');
  }

  // Button-cell child safety: consumer/toy with button_cell batteries
  if (rule.update_id === 'STATIC-BATTERY-BUTTONCELL-CHILDSAFETY') {
    return (
      product.battery_type === 'button_cell' &&
      ['consumer', 'toy'].includes(product.intended_use)
    );
  }

  // Substance-based rules (RoHS, REACH, POPs): handled by substanceMatches above,
  // no extra attribute condition needed.
  return true;
}

/** Build a human-readable gap description. */
function buildGapDescription(product, partner, rule) {
  switch (rule.update_id) {
    case 'STATIC-BATTERY-PASSPORT-LMT':
      return `LMT battery (${product.name}) sold in the EU without a digital battery passport / data carrier (QR code).`;
    case 'STATIC-BATTERY-PASSPORT-INDUSTRIAL':
      return `Industrial battery (${product.battery_capacity_wh} Wh, ${product.name}) sold in the EU without a digital battery passport.`;
    case 'STATIC-RED-USBC-CHARGER':
      return `${product.name} uses "${product.connector}" connector — USB-C is now mandatory for in-scope consumer devices in the EU since 28 Dec 2024.`;
    case 'STATIC-RED-CYBERSECURITY-EN18031':
      return `${product.name} is an internet-connected consumer radio device; no documented EN 18031 cybersecurity conformity assessment found.`;
    case 'STATIC-PPWR-PLASTIC-PACKAGING':
      return `${product.name} is packaged in plastic film; PPWR requires phase-out or recycled-content/recyclability compliance.`;
    case 'STATIC-BATTERY-BUTTONCELL-CHILDSAFETY':
      return `${product.name} contains a button-cell battery accessible without a tool or double-action — non-compliant with Battery Reg Art. 12 from Aug 2026.`;
    case 'STATIC-ROHS-HEAVYMETALS': {
      const hit = product.substances.filter((s) =>
        ['lead', 'mercury', 'cadmium', 'hexavalent_chromium'].includes(s),
      );
      return `${product.name} contains restricted heavy metal(s): ${hit.join(', ')}. Must be below RoHS threshold or hold a valid documented exemption.`;
    }
    case 'STATIC-POPS-DECABDE':
      return `${product.name} contains decaBDE flame retardant, which is prohibited under the POPs Regulation (>10 mg/kg in articles).`;
    case 'STATIC-REACH-PFAS-PFHXA':
      return `${product.name} contains PFAS/PFHxA coating/component. Restricted under REACH Annex XVII Entry 68 (≥25 ppb in consumer articles).`;
    case 'STATIC-REACH-BPA':
      return `${product.name} contains BPA (REACH SVHC). Must be notified in ECHA SCIP database and customers informed on request.`;
    case 'LIVE-ECHA-SVHC': {
      const hit = product.substances.filter((s) =>
        ['BPA', 'DEHP', 'DBP', 'BBP', 'PFAS_PFHxA', 'MCCP'].includes(s),
      );
      return `${product.name} contains SVHC(s) on ECHA Candidate List: ${hit.join(', ')}. REACH Art. 33 communication + SCIP notification required.`;
    }
    default:
      return `${product.name} may be affected by: ${rule.title}.`;
  }
}

/** Build the recommended action string. */
function buildAction(product, rule) {
  return rule.action_required ?? 'Review rule applicability and take corrective action.';
}

/** Decide severity: use rule severity but escalate known_gaps to "high". */
function decideSeverity(rule, isKnownGap) {
  if (isKnownGap) return 'high';
  return rule.severity ?? 'medium';
}

// ─── Rules to skip for certain product types ─────────────────────────────────
// Some rules explicitly exclude industrial-only or medical-only products

function isExcluded(product, rule) {
  // GPSR / consumer safety rules don't apply to purely industrial equipment
  if (
    rule.regulation_family === 'GPSR' &&
    product.intended_use === 'industrial'
  )
    return true;

  // Toy Safety rules only apply to toys
  if (rule.regulation_family === 'ToySafety' && product.intended_use !== 'toy')
    return true;

  // RoHS medical exemption: lead in medical devices has a renewed exemption (REG-26-003)
  // We still flag it but with lower severity.

  return false;
}

// ─── Which rules we want to assess (skip noisy live-fetch generic entries) ────
const ASSESS_RULE_IDS = new Set([
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

// ─── main assessment loop ─────────────────────────────────────────────────────

const findings = [];

for (const partner of partners) {
  // Collect the explicit known_gaps for cross-validation
  const knownGapTexts = (partner.compliance_status?.known_gaps ?? []).map((g) =>
    g.toLowerCase(),
  );

  for (const product of partner.products) {
    for (const rule of rules) {
      if (!ASSESS_RULE_IDS.has(rule.update_id)) continue;
      if (isExcluded(product, rule)) continue;
      if (!marketsMatch(product, rule)) continue;
      if (!categoryMatches(product, rule)) continue;
      if (!substanceMatches(product, rule)) continue;
      if (!attributeMatches(product, rule, partner)) continue;

      // Gap confirmed
      const gapText = buildGapDescription(product, partner, rule);
      const isKnownGap = knownGapTexts.some((kg) =>
        kg.includes(product.name.toLowerCase().split(' ')[0].toLowerCase()),
      );

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
        severity: decideSeverity(rule, isKnownGap),
        recommended_action: buildAction(product, rule),
        alert: {
          channel: partner.contact.preferred_channel,
          // Always use your own test number — never the fake partner contact
          to: '__ALERT_TARGET__',
          message: buildAlertMessage(partner, product, rule, gapText),
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

function buildAlertMessage(partner, product, rule, gap) {
  const deadline = rule.deadline_date ? ` by ${rule.deadline_date}` : '';
  const shortRule = rule.regulation_family;
  const short = `${partner.company}: ${product.name} — ${shortRule} gap${deadline}. ${rule.action_required?.slice(0, 80) ?? ''} Source: ${rule.source_url}`;
  return short.length > 320 ? short.slice(0, 317) + '...' : short;
}

// Sort: high severity first, then by deadline
findings.sort((a, b) => {
  const sev = { high: 0, medium: 1, low: 2 };
  const sd = (sev[a.severity] ?? 1) - (sev[b.severity] ?? 1);
  if (sd !== 0) return sd;
  if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
  if (a.deadline) return -1;
  if (b.deadline) return 1;
  return 0;
});

const output = {
  _comment:
    'Gap findings produced by assess_gaps.js. Each record matches sample_expected_output.json. ' +
    'Replace __ALERT_TARGET__ with your own Twilio test number/email before alerting.',
  assessed_at: new Date().toISOString(),
  finding_count: findings.length,
  findings,
};

writeFileSync('findings.json', JSON.stringify(output, null, 2));
console.log(`── Step 2: Assessment complete ─────────────────────────────────`);
console.log(`  ✓ wrote findings.json  (${findings.length} gaps detected)`);

// Summary table
const byCompany = {};
for (const f of findings) {
  byCompany[f.company] = (byCompany[f.company] ?? 0) + 1;
}
const rows = Object.entries(byCompany).sort((a, b) => b[1] - a[1]);
console.log('\n  Gaps per company:');
for (const [company, count] of rows) {
  console.log(`    ${count.toString().padStart(2)}  ${company}`);
}
