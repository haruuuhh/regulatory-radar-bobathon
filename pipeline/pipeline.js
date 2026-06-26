/**
 * pipeline.js — orchestrator
 *
 * Runs all three steps in sequence:
 *   1. fetch_rules.js  → rules_live.json
 *   2. assess_gaps.js  → findings.json
 *   3. alert.js        → alerts_log.json + real Twilio notifications
 *
 * Usage:
 *   node pipeline.js
 *
 * Each step can also be run individually:
 *   node fetch_rules.js
 *   node assess_gaps.js
 *   node alert.js
 */

import { spawnSync } from 'child_process';

function run(script) {
  console.log(`\n${'═'.repeat(60)}`);
  const result = spawnSync('node', [script], {
    stdio: 'inherit',
    env: { ...process.env },
  });
  if (result.status !== 0) {
    console.error(`\n❌ ${script} exited with code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

console.log('🛰️  Regulatory Radar — pipeline starting');
console.log(`   ${new Date().toISOString()}\n`);

run('fetch_rules.js');
run('assess_gaps.js');
run('alert.js');

console.log(`\n${'═'.repeat(60)}`);
console.log('✅ Pipeline complete.');
console.log('   rules_live.json   — live regulations fetched');
console.log('   findings.json     — all detected gaps');
console.log('   alerts_log.json   — Twilio delivery log');
