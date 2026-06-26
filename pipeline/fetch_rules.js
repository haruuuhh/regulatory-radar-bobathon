/**
 * STEP 1 — fetch_rules.js
 *
 * Pulls current EU regulatory requirements from live public sources and writes
 * them to rules_live.json.  Each rule record has the same shape as the entries
 * in regulatory_updates.json so assess_gaps.js can consume both.
 *
 * Live sources used:
 *   1. ECHA SVHC Candidate List  (Excel download → extract substance names)
 *   2. EUR-Lex OJ RSS feed       (detect Battery / RED / RoHS updates)
 *   3. Safety Gate XML feed      (GPSR product-safety recalls)
 *
 * Static rules (well-established, cite the canonical EUR-Lex URL):
 *   4. RoHS heavy metals
 *   5. Battery Regulation 2023/1542 – LMT + industrial passport
 *   6. RED common-charger delegated act (USB-C mandate)
 *   7. PPWR plastic packaging
 *   8. POPs decaBDE
 *   9. Button-cell child safety (Battery Reg Art. 12)
 */

import { writeFileSync } from 'fs';
import { XMLParser } from 'fast-xml-parser';

const FETCHED_AT = new Date().toISOString();

// ─── helpers ─────────────────────────────────────────────────────────────────

async function fetchText(url, label) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'RegulatoryRadar/1.0 (bobathon research)' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`  ✓ fetched ${label}`);
    return res.text();
  } catch (err) {
    console.warn(`  ⚠ could not fetch ${label}: ${err.message}`);
    return null;
  }
}

// ─── source 1: ECHA SVHC Candidate List (JSON/CSV via ECHA API) ──────────────
// ECHA provides a CSV/Excel download; we use their documented REST endpoint
// to get the latest SVHC list as JSON.

async function fetchEchaSvhc() {
  const url =
    'https://echa.europa.eu/candidate-list-table/-/dislist/details/0b0236e18663449a';
  // ECHA's public Candidate List in CSV-like format is at:
  const csvUrl =
    'https://echa.europa.eu/documents/10162/17232/svhc_candidate_list_en.csv';
  const text = await fetchText(csvUrl, 'ECHA SVHC CSV');

  // Regardless of whether the live CSV loaded, we emit a well-documented rule
  // record citing the Candidate List page.  If we got data, count entries.
  let substanceCount = '?';
  if (text) {
    const lines = text.trim().split('\n').filter(Boolean);
    substanceCount = Math.max(0, lines.length - 1); // subtract header
  }

  return {
    update_id: 'LIVE-ECHA-SVHC',
    fetched_at: FETCHED_AT,
    source: 'ECHA',
    source_url: 'https://echa.europa.eu/candidate-list-table',
    regulation_family: 'REACH',
    reference: 'Regulation (EC) 1907/2006, Article 59 — SVHC Candidate List',
    title: `ECHA SVHC Candidate List (${substanceCount} substances as of ${FETCHED_AT.slice(0, 10)})`,
    summary:
      'The SVHC Candidate List is updated twice yearly. Substances of Very High Concern ' +
      'above 0.1 % w/w in articles trigger REACH Article 33 communication duties. ' +
      'Current SVHC in this portfolio: BPA (Bisphenol A), DEHP, DBP, BBP (phthalates), PFAS_PFHxA.',
    change_type: 'live_fetch',
    effective_date: null,
    deadline_date: null,
    severity: 'high',
    action_required:
      'Check all products containing BPA, DEHP, DBP, BBP, PFAS_PFHxA against current Candidate List; ' +
      'communicate SVHC presence to customers/ECHA SCIP database.',
    scope: {
      categories: 'all',
      substances: ['BPA', 'DEHP', 'DBP', 'BBP', 'PFAS_PFHxA', 'MCCP'],
      markets: ['EU'],
      conditions:
        'Applies when SVHC concentration ≥ 0.1 % w/w in any article placed on the EU market.',
    },
  };
}

// ─── source 2: EUR-Lex OJ RSS ─────────────────────────────────────────────────

async function fetchEurlexRss() {
  const url = 'https://eur-lex.europa.eu/oj/daily-view/P2/rss/rss.xml';
  const text = await fetchText(url, 'EUR-Lex OJ RSS');
  const results = [];

  if (text) {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const feed = parser.parse(text);
    const items = feed?.rss?.channel?.item ?? [];
    const relevant = [].concat(items).filter((it) => {
      const t = (it.title ?? '').toLowerCase();
      return (
        t.includes('battery') ||
        t.includes('rohs') ||
        t.includes('reach') ||
        t.includes('radio') ||
        t.includes('charger') ||
        t.includes('ecodesign') ||
        t.includes('packaging')
      );
    });
    for (const item of relevant.slice(0, 5)) {
      results.push({
        update_id: `LIVE-OJRSS-${item.guid ?? Math.random().toString(36).slice(2)}`,
        fetched_at: FETCHED_AT,
        source: 'EUR-Lex OJ RSS',
        source_url: item.link ?? 'https://eur-lex.europa.eu/oj',
        regulation_family: 'unknown',
        reference: item.title ?? '',
        title: item.title ?? 'EUR-Lex OJ item',
        summary: item.description ?? '',
        change_type: 'live_fetch',
        effective_date: item.pubDate ?? null,
        deadline_date: null,
        severity: 'medium',
        action_required: 'Review linked OJ publication for applicability to your products.',
        scope: { categories: 'all', substances: [], markets: ['EU'], conditions: '' },
      });
    }
  }

  return results;
}

// ─── source 3: Safety Gate XML feed ──────────────────────────────────────────

async function fetchSafetyGate() {
  // Weekly XML export — electronics category filter
  const url =
    'https://ec.europa.eu/safety-gate-alerts/screen/xmlExport?lang=en&search=&category=Electronics';
  const text = await fetchText(url, 'Safety Gate XML');
  const results = [];

  if (text) {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const feed = parser.parse(text);
    // The Safety Gate XML structure: <RAPEX><NOTIFICATION>...
    const notifications = feed?.RAPEX?.NOTIFICATION ?? feed?.notifications?.notification ?? [];
    const list = [].concat(notifications).slice(0, 3);
    for (const n of list) {
      const title =
        n.PRODUCT_NAME ?? n.productName ?? n.title ?? 'Safety Gate recall';
      const url2 = n.NOTIFICATION_URL ?? n.url ?? 'https://ec.europa.eu/safety-gate-alerts';
      results.push({
        update_id: `LIVE-SAFEGATE-${n.REFERENCE ?? Math.random().toString(36).slice(2)}`,
        fetched_at: FETCHED_AT,
        source: 'Safety Gate / RAPEX',
        source_url: url2,
        regulation_family: 'GPSR',
        reference: 'Regulation (EU) 2023/988 – General Product Safety',
        title: `Safety Gate recall: ${title}`,
        summary:
          'Product flagged in Safety Gate weekly electronics recalls. Indicates potential GPSR non-compliance.',
        change_type: 'live_fetch',
        effective_date: null,
        deadline_date: null,
        severity: 'high',
        action_required: 'Assess whether your similar products share the identified hazard.',
        scope: {
          categories: ['smart_home', 'toy_electronic', 'wearable', 'appliance'],
          substances: [],
          markets: ['EU'],
          conditions: 'Consumer products with a safety risk to health or property.',
        },
      });
    }
  }

  return results;
}

// ─── static rules (well-established, authoritative source URLs) ───────────────

function staticRules() {
  return [
    {
      update_id: 'STATIC-ROHS-HEAVYMETALS',
      fetched_at: FETCHED_AT,
      source: 'EUR-Lex',
      source_url: 'https://eur-lex.europa.eu/eli/dir/2011/65/oj',
      regulation_family: 'RoHS',
      reference: 'Directive 2011/65/EU, Annex II',
      title: 'RoHS — restriction of lead, mercury, cadmium, hexavalent chromium',
      summary:
        'EEE placed on the EU market must not contain lead >0.1 %, mercury >0.1 %, ' +
        'cadmium >0.01 %, hexavalent chromium >0.1 % by weight in homogeneous materials. ' +
        'Exemptions exist for specific medical and industrial uses but must be documented.',
      change_type: 'in_force',
      effective_date: '2011-07-21',
      deadline_date: null,
      severity: 'high',
      action_required:
        'All EU-market EEE must be below threshold or hold a valid documented exemption.',
      scope: {
        categories: 'all',
        substances: ['lead', 'mercury', 'cadmium', 'hexavalent_chromium'],
        markets: ['EU'],
        conditions:
          'Covers consumer and industrial EEE. Medical devices and monitoring equipment have transitional exemptions.',
      },
    },
    {
      update_id: 'STATIC-BATTERY-PASSPORT-LMT',
      fetched_at: FETCHED_AT,
      source: 'EUR-Lex',
      source_url: 'https://eur-lex.europa.eu/eli/reg/2023/1542/oj',
      regulation_family: 'Battery',
      reference: 'Regulation (EU) 2023/1542, Article 77',
      title: 'Battery Regulation — LMT battery passport (deadline 18 Feb 2027)',
      summary:
        'Light-means-of-transport (LMT) batteries (e-bikes, e-scooters, etc.) placed on ' +
        'the EU market on or after 18 February 2027 must carry a digital battery passport ' +
        'with a data carrier (QR code) accessible from the battery surface.',
      change_type: 'in_force',
      effective_date: '2023-08-17',
      deadline_date: '2027-02-18',
      severity: 'high',
      action_required:
        'Create and register the battery passport data carrier before the deadline.',
      scope: {
        categories: ['emobility_battery'],
        substances: [],
        markets: ['EU'],
        conditions: 'battery_type == "lmt"',
      },
    },
    {
      update_id: 'STATIC-BATTERY-PASSPORT-INDUSTRIAL',
      fetched_at: FETCHED_AT,
      source: 'EUR-Lex',
      source_url: 'https://eur-lex.europa.eu/eli/reg/2023/1542/oj',
      regulation_family: 'Battery',
      reference: 'Regulation (EU) 2023/1542, Article 77',
      title: 'Battery Regulation — industrial battery passport (deadline 18 Feb 2027)',
      summary:
        'Industrial batteries with a capacity > 2 kWh placed on the EU market on or after ' +
        '18 February 2027 must carry a digital battery passport.',
      change_type: 'in_force',
      effective_date: '2023-08-17',
      deadline_date: '2027-02-18',
      severity: 'high',
      action_required:
        'Create and register the battery passport data carrier before the deadline.',
      scope: {
        categories: ['battery_pack'],
        substances: [],
        markets: ['EU'],
        conditions: 'battery_type == "industrial" AND battery_capacity_wh > 2000',
      },
    },
    {
      update_id: 'STATIC-RED-USBC-CHARGER',
      fetched_at: FETCHED_AT,
      source: 'EUR-Lex',
      source_url:
        'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_202302553',
      regulation_family: 'RED',
      reference:
        'Directive 2014/53/EU, amended by Delegated Regulation (EU) 2022/2380 — common charger',
      title: 'RED — USB-C common charger mandatory for portable consumer electronics',
      summary:
        'From 28 December 2024, small portable consumer electronics (phones, tablets, cameras, ' +
        'headphones, portable speakers, handheld game consoles, e-readers) sold in the EU must ' +
        'use USB-C for wired charging. Laptops have until April 2026. Devices using micro-USB ' +
        'or proprietary connectors are no longer compliant.',
      change_type: 'in_force',
      effective_date: '2024-12-28',
      deadline_date: '2024-12-28',
      severity: 'high',
      action_required:
        'Replace micro-USB or proprietary charging ports with USB-C on all in-scope products.',
      scope: {
        categories: [
          'audio',
          'wearable',
          'smart_home',
          'battery_pack',
          'power_supply',
        ],
        substances: [],
        markets: ['EU'],
        conditions:
          'Consumer portable device with wired charging. connector IN ["micro_usb", "lightning", "barrel"] is non-compliant.',
      },
    },
    {
      update_id: 'STATIC-RED-CYBERSECURITY-EN18031',
      fetched_at: FETCHED_AT,
      source: 'EUR-Lex',
      source_url:
        'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32022R2420',
      regulation_family: 'RED',
      reference: 'Directive 2014/53/EU Art. 3(3)(d)(e)(f) — Delegated Reg. (EU) 2022/30',
      title: 'RED — cybersecurity requirements (EN 18031) for internet-connected devices',
      summary:
        'From 1 August 2025, internet-connected radio equipment (routers, smart-home hubs, ' +
        'wearables, IoT devices, cameras) must meet cybersecurity requirements under ' +
        'EN 18031 (network protection, access control, personal data). ' +
        'CE declaration must cover Art. 3(3)(d/e/f).',
      change_type: 'in_force',
      effective_date: '2025-08-01',
      deadline_date: '2025-08-01',
      severity: 'high',
      action_required:
        'Conduct EN 18031 conformity assessment and update DoC / technical file before August 2025.',
      scope: {
        categories: [
          'smart_home',
          'wearable',
          'networking',
          'iot_module',
          'audio',
          'drone',
        ],
        substances: [],
        markets: ['EU'],
        conditions: 'has_radio == true AND intended_use != "industrial"',
      },
    },
    {
      update_id: 'STATIC-PPWR-PLASTIC-PACKAGING',
      fetched_at: FETCHED_AT,
      source: 'EUR-Lex',
      source_url: 'https://eur-lex.europa.eu/eli/reg/2025/40/oj',
      regulation_family: 'PPWR',
      reference: 'Regulation (EU) 2025/40 — Packaging and Packaging Waste',
      title: 'PPWR — plastic film / single-use packaging restrictions',
      summary:
        'The new PPWR entered into force in February 2025. Products packaged in plastic film ' +
        '(single-use flexible plastic) for direct consumer sale must phase out such packaging or ' +
        'ensure it meets recycled-content and recyclability targets. Labelling requirements ' +
        'under Art. 11 apply from 2028.',
      change_type: 'in_force',
      effective_date: '2025-02-12',
      deadline_date: '2028-01-01',
      severity: 'medium',
      action_required:
        'Audit product packaging; replace plastic film with compliant alternatives or document recycled-content compliance.',
      scope: {
        categories: 'all',
        substances: [],
        markets: ['EU'],
        conditions: 'packaging INCLUDES "plastic_film"',
      },
    },
    {
      update_id: 'STATIC-POPS-DECABDE',
      fetched_at: FETCHED_AT,
      source: 'EUR-Lex',
      source_url: 'https://eur-lex.europa.eu/eli/reg/2019/1021/oj',
      regulation_family: 'POPs',
      reference: 'Regulation (EU) 2019/1021, Annex I',
      title: 'POPs — decabromodiphenyl ether (decaBDE) restriction in EEE',
      summary:
        'DecaBDE (decabromodiphenyl ether) is listed in the POPs Regulation Annex I. ' +
        'Its manufacture, use, and placing on the market in concentrations above 10 mg/kg ' +
        'in articles is prohibited. EEE containing decaBDE in flame-retardant components is ' +
        'non-compliant and must be reformulated.',
      change_type: 'in_force',
      effective_date: '2019-07-15',
      deadline_date: null,
      severity: 'high',
      action_required:
        'Replace decaBDE flame retardants with compliant alternatives and update test reports.',
      scope: {
        categories: 'all',
        substances: ['decaBDE'],
        markets: ['EU'],
        conditions: 'Product contains decaBDE above 10 mg/kg in any article.',
      },
    },
    {
      update_id: 'STATIC-BATTERY-BUTTONCELL-CHILDSAFETY',
      fetched_at: FETCHED_AT,
      source: 'EUR-Lex',
      source_url: 'https://eur-lex.europa.eu/eli/reg/2023/1542/oj',
      regulation_family: 'Battery',
      reference: 'Regulation (EU) 2023/1542, Article 12 — button cell child safety',
      title: 'Battery Regulation — button cell compartments must be child-safe (Aug 2026)',
      summary:
        'From 18 August 2026, consumer appliances containing button-cell or coin batteries ' +
        'must have battery compartments that are not accessible to children without a tool or ' +
        'two simultaneous actions. Required warning labelling on product and packaging.',
      change_type: 'in_force',
      effective_date: '2023-08-17',
      deadline_date: '2026-08-18',
      severity: 'high',
      action_required:
        'Redesign battery compartment closure (tool/double-action lock) and add required warning label.',
      scope: {
        categories: [
          'toy_electronic',
          'smart_home',
          'wearable',
          'audio',
        ],
        substances: [],
        markets: ['EU'],
        conditions:
          'battery_type == "button_cell" AND intended_use IN ["consumer","toy"]',
      },
    },
    {
      update_id: 'STATIC-REACH-PFAS-PFHXA',
      fetched_at: FETCHED_AT,
      source: 'ECHA',
      source_url:
        'https://echa.europa.eu/registry-of-restriction-intentions/-/dislist/details/0b0236e185c8db23',
      regulation_family: 'REACH',
      reference: 'Regulation (EC) 1907/2006, Annex XVII — Entry on PFHxA group',
      title: 'REACH restriction — PFHxA group (PFAS) in consumer articles',
      summary:
        'The PFHxA group restriction (Annex XVII Entry 68) prohibits placing on the EU market ' +
        'consumer articles containing PFHxA and its salts/esters above 25 ppb. ' +
        'Water-repellent coatings in wearables, textiles and outdoor products are the primary targets.',
      change_type: 'in_force',
      effective_date: '2023-02-25',
      deadline_date: null,
      severity: 'high',
      action_required:
        'Test water-repellent coatings/components for PFHxA; replace or obtain analytical proof below threshold.',
      scope: {
        categories: ['wearable', 'drone', 'smart_home'],
        substances: ['PFAS_PFHxA'],
        markets: ['EU'],
        conditions:
          'Consumer article with PFAS_PFHxA coating or component. Threshold: 25 ppb.',
      },
    },
    {
      update_id: 'STATIC-REACH-BPA',
      fetched_at: FETCHED_AT,
      source: 'ECHA',
      source_url: 'https://echa.europa.eu/candidate-list-table',
      regulation_family: 'REACH',
      reference: 'Regulation (EC) 1907/2006, Article 59 — SVHC (BPA)',
      title: 'REACH SVHC — Bisphenol A (BPA) communication and SCIP registration',
      summary:
        'Bisphenol A (BPA) is on the SVHC Candidate List. Articles containing BPA above ' +
        '0.1 % w/w must be notified in the ECHA SCIP database and customers must be informed ' +
        'upon request. BPA is also restricted in certain thermal paper and food contact applications.',
      change_type: 'in_force',
      effective_date: '2017-01-12',
      deadline_date: null,
      severity: 'medium',
      action_required:
        'Register in ECHA SCIP database; inform downstream users/consumers of BPA presence on request.',
      scope: {
        categories: 'all',
        substances: ['BPA'],
        markets: ['EU'],
        conditions: 'BPA concentration ≥ 0.1 % w/w in any article.',
      },
    },
  ];
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('── Step 1: Fetching regulatory rules ───────────────────────────');
  const rules = [];

  // Live fetches
  rules.push(await fetchEchaSvhc());
  const ojItems = await fetchEurlexRss();
  rules.push(...ojItems);
  const sgItems = await fetchSafetyGate();
  rules.push(...sgItems);

  // Static (always authoritative)
  rules.push(...staticRules());

  const output = {
    _comment:
      'Live + static EU regulatory rules fetched by fetch_rules.js. ' +
      'Consumed by assess_gaps.js to detect portfolio gaps.',
    fetched_at: FETCHED_AT,
    rule_count: rules.length,
    rules,
  };

  writeFileSync('rules_live.json', JSON.stringify(output, null, 2));
  console.log(`  ✓ wrote rules_live.json  (${rules.length} rules)`);
}

main().catch((err) => {
  console.error('fetch_rules.js failed:', err);
  process.exit(1);
});
