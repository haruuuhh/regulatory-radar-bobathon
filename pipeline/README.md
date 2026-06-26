# Regulatory Radar — Pipeline

## Stack
- **Node.js ≥ 18** (ES modules, native fetch)
- **twilio** — alert delivery (SMS / WhatsApp / email via SendGrid)
- **fast-xml-parser** — parse EUR-Lex / Safety Gate RSS feeds
- **dotenv** — secrets

## Quick start

```bash
cd pipeline
cp .env.example .env          # fill in your Twilio + alert-target creds
npm install
node pipeline.js              # runs all three steps end-to-end
```

Or run individual steps:
```bash
node fetch_rules.js           # → rules_live.json
node assess_gaps.js           # → findings.json
node alert.js                 # → sends real alerts, writes alerts_log.json
```

## Environment variables (`.env`)

| Variable | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_FROM_SMS` | Your Twilio SMS number (e.g. `+12015551234`) |
| `TWILIO_FROM_WHATSAPP` | Twilio WhatsApp sender (e.g. `whatsapp:+14155238886`) |
| `ALERT_TARGET_PHONE` | **Your** test phone number for SMS/WhatsApp |
| `ALERT_TARGET_EMAIL` | **Your** test email address |
| `DRY_RUN` | Set to `true` to skip actual Twilio calls (logs instead) |

> All company contacts in `partners.json` are `@example.com` / placeholder phones.  
> The pipeline always sends to your `ALERT_TARGET_*` values — never to the fake company data.

## Output files

| File | Contents |
|---|---|
| `rules_live.json` | Regulations fetched from live sources, timestamped |
| `findings.json` | All detected gaps in `sample_expected_output.json` shape |
| `alerts_log.json` | Twilio delivery receipts / dry-run log |

## Architecture

```
partners.json ──┐
                ├──► assess_gaps.js ──► findings.json ──► alert.js ──► Twilio
rules_live.json ┘                                                    └──► alerts_log.json
     ▲
fetch_rules.js (ECHA + EUR-Lex RSS)
```

## Covered regulations (Core tier)

| Rule | Source | Fetched live? |
|---|---|---|
| ECHA SVHC Candidate List (REACH) | echa.europa.eu | ✅ XLSX download |
| EUR-Lex Battery Reg 2023/1542 | eur-lex.europa.eu | ✅ OJ RSS |
| RED common-charger (USB-C) Delegated Act | eur-lex.europa.eu | ✅ OJ RSS |
| Safety Gate / RAPEX weekly feed | ec.europa.eu | ✅ XML feed |

Static rules (shape taken from `regulatory_updates.json` examples, cite EUR-Lex URL):
- RoHS heavy metals (lead, mercury, cadmium, hexavalent chromium)
- POPs decaBDE restriction
- PPWR plastic packaging
- Button-cell child-safety (GPSR)
