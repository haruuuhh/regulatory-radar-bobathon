#!/usr/bin/env python3
"""
starter.py - a runnable scaffold for the Regulatory Radar challenge.

It does the boring parts for you (loading the data) and gives you a NAIVE baseline matcher to
improve. The baseline deliberately ignores markets-detail, attribute conditions, exclusions, noise
and duplicates - so it OVER-FIRES. Your job is to make it smart. Search for "TODO".

Run:  python3 starter.py
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

# ---- Step 1: Monitor (load the feed) --------------------------------------
partners = json.loads((HERE / "partners.json").read_text())["partners"]
updates  = json.loads((HERE / "regulatory_updates.json").read_text())["updates"]
sample   = json.loads((HERE / "sample_expected_output.json").read_text())

products = [{**pr, "partner_id": pt["partner_id"], "company": pt["company"],
            "contact": pt["contact"]}
           for pt in partners for pr in pt["products"]]

print(f"Loaded {len(partners)} partners, {len(products)} products, {len(updates)} updates.\n")

# ---- helpers ---------------------------------------------------------------
EU_MEMBERS = {"AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE",
              "IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"}

def expand(markets):
    s = set()
    for m in markets:
        s.update(EU_MEMBERS if m == "EU" else {m})
    return s

def market_overlap(prod_markets, reg_markets):
    return bool(expand(prod_markets) & expand(reg_markets))

# ---- Step 2 + 3: Understand + Match (NAIVE baseline - improve me!) ---------
def naive_affects(update, product):
    """A weak baseline. Returns True if the update might affect the product.

    It only checks category + substance + market. That is enough for a beginner pass, but it
    OVER-FIRES because it ignores:
      TODO(1): attribute conditions - e.g. the battery passport only covers LMT/industrial
               batteries, not portable power banks. Read the `summary`/`conditions` (use IBM Bob!)
               and check battery_type / has_radio / connector / intended_use / packaging.
      TODO(2): exclusions - e.g. GPSR does not cover medical or industrial-only equipment.
      TODO(3): noise - some updates are from unrelated domains and should match no one.
      TODO(4): duplicates - skip updates that only restate an earlier one (see the `corrects` field).
    """
    scope = update["scope"]
    cats = scope.get("categories", "all")
    if isinstance(cats, list) and product["category"] not in cats:
        return False
    subs = scope.get("substances", [])
    if subs and not (set(product["substances"]) & set(subs)):
        return False
    if not market_overlap(product["markets"], scope.get("markets", ["EU"])):
        return False
    return True

def run_matcher():
    results = {}
    for upd in updates:
        hits = [p for p in products if naive_affects(upd, p)]
        results[upd["update_id"]] = hits
    return results

# ---- Step 4: Alert (stub - prints instead of sending) ----------------------
def make_alert(update, product):
    return (f"[{product['contact']['preferred_channel'].upper()} -> {product['contact']['email']}] "
            f"{product['company']}: '{update['title']}' affects your '{product['product_id']}'. "
            f"Deadline {update.get('deadline_date')}. Action: {update.get('action_required','review')}.")
    # TODO: replace this with a real Twilio send to YOUR OWN test number/email.

# ---- self-check against the one public worked example ----------------------
def self_check():
    res = run_matcher()
    got = sorted(p["product_id"] for p in res.get(sample["update_id"], []))
    want = sorted(a["product_id"] for a in sample["affected"])
    tp = set(got) & set(want)
    precision = len(tp) / len(got) if got else 0.0
    recall = len(tp) / len(want) if want else 0.0
    print(f"Self-check on {sample['update_id']} ({sample['title']}):")
    print(f"  expected (key): {want}")
    print(f"  baseline got:   {got}")
    print(f"  precision={precision:.2f}  recall={recall:.2f}")
    if precision < 1.0:
        extra = sorted(set(got) - set(want))
        print(f"  -> baseline OVER-FIRES on {extra}: these are in the right category but the wrong")
        print(f"     battery type. Fix TODO(1) by checking attribute conditions. That is the challenge.")
    print()

if __name__ == "__main__":
    res = run_matcher()
    total = sum(len(v) for v in res.values())
    print(f"Naive baseline produced {total} (update, product) matches across {len(updates)} updates.")
    print("(Expect this to be too high - the baseline over-fires. Make it smarter.)\n")
    self_check()
    print("Example alert that WOULD be sent (wire this to Twilio with YOUR test contact):")
    demo = next((p for p in res[sample["update_id"]]), None)
    if demo:
        print("  " + make_alert(updates and next(u for u in updates if u["update_id"] == sample["update_id"]), demo))
