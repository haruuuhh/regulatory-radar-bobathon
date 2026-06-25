# Regulatory Radar - Challenge Dataset

Synthetic dataset for the **IBM Bobathon "Regulatory Radar"** challenge
(see `../challenge_brief.md`). Build an AI agent that **Monitors** regulatory updates,
**Understands** each change, **Matches** it to the affected partners/products, and **Alerts** them.

Real EU regulation *families* are used for realism. **Every company, product, update event,
date, email and phone number is fabricated and safe** - there are no real people and no live
inboxes. Contacts use `@example.com` and placeholder phone numbers on purpose.

## What's in the box

| File | Audience | What it is |
|------|----------|------------|
| `partners.json` | participants | 22 synthetic SMEs and their 53 products (the entities to match against) |
| `partners.csv` | participants | The same portfolio, one row per product, for spreadsheets |
| `regulatory_updates.json` | participants | 50 regulatory update events (the feed to process) |
| `taxonomy.json` | participants | Controlled vocabulary: categories, substances, regulation families |
| `feed/` | participants | 10 simulated HTML notices for practising the scrape/"Monitor" step |
| `sample_expected_output.json` | participants | The expected matcher output for ONE update, so you know the shape to produce |
| `jury/ground_truth.json` | **jury only** | The full answer key: every update -> affected products + engineered near-misses |
| `jury/regulation_match_rules.json` | **jury only** | The exact machine rule used to derive the key |
| `dataset_stats.json` | everyone | Summary counts |
| `build_dataset.py` | maintainers | Regenerates everything deterministically |

## The data model

**Partner / product** (`partners.json`): each partner has `sells_in` markets and a `contact`
(name, email, phone, `preferred_channel`). Each product carries the attributes matching is based on:
`category`, `substances`, `has_battery` + `battery_type` (`portable`/`button_cell`/`lmt`/`industrial`)
+ `battery_capacity_wh`, `has_radio`, `connector`, `packaging`, `intended_use`
(`consumer`/`toy`/`industrial`/`medical`), and `markets`.

**Regulatory update** (`regulatory_updates.json`): `regulation_family`, `title`, a free-text
`summary` (what your "Understand" step must read), `effective_date`/`deadline_date`, `severity`,
`change_type` (`new`/`amendment`/`correction`), an optional `corrects` pointer (for de-duplication),
and a `scope` block (affected categories / substances / markets / conditions).

## How matching is defined (the rule behind the key)

A product is **affected** by an update when **all** hold:
1. **Market overlap** - the product's markets intersect the update's markets (`EU` = all 27 states);
2. **Category in scope** - the update targets the product's category (or targets "all");
3. **Substance present** - if the update names substances, the product contains at least one;
4. **Attribute conditions** - e.g. battery type, radio, connector, intended use, packaging;
5. **Not excluded** - e.g. GPSR excludes medical/industrial-only equipment.

A **near-miss** matches the category and market but fails *exactly one* of substance / attribute /
market - these are the precision traps that punish naive keyword matching.

## What to expect (and what we test)

The feed mirrors a real regulatory stream, so it is deliberately messy. Your agent should cope with:

- **Irrelevant updates** from other domains (chemicals, metals, agriculture, refrigerants). These
  should match no one - do not force a match.
- **Updates that affect nobody in this portfolio**, even within the electronics domain (e.g. a
  substance none of the partners use). The correct answer is an empty match, not a guess.
- **Duplicates and corrections** - some updates restate or correct an earlier one (see the `corrects`
  field). Alert once, not twice.
- **Precision traps** - products that look related but fall just outside scope: wrong market, a
  substance that is not actually present, or an attribute (battery type, intended use) that takes
  them out of scope. Matching on keywords alone will over-fire here.

Markets matter: an update scoped to a single country only affects partners that sell there. Deadlines
range from already-overdue to several years out, so prioritise by `deadline_date` and `severity`.

## Suggested pipeline (maps to the rubric)

1. **Monitor** - ingest `regulatory_updates.json` (or scrape `feed/*.html` for the live-feed feel).
2. **Understand** - use IBM Bob to read each `summary` and extract: family, deadline, affected
   categories/substances/markets, and conditions.
3. **Match** - join against `partners.json` using the rule above; mind the precision traps.
4. **Alert** - for each affected partner, send one actionable message ("Rule X affects product Y,
   deadline Z, do W") on their `preferred_channel`. **Swap in your own Twilio test number/email** -
   do not rely on the placeholder contacts.
5. **Score (jury)** - compare against `jury/ground_truth.json`: precision/recall on matches, correct
   handling of noise, zero-match and duplicate updates, and deadline extraction.

## Safety note on contacts

All emails (`@example.com`) and phone numbers are placeholders so that test alerts never reach a
real person. Teams should configure their **own** Twilio sandbox / verified test number for the
Alert demo.

*Generated by `build_dataset.py` - edit the seed data there and re-run to regenerate everything.*
