#!/usr/bin/env python3
"""
Download IR & SIR card images for one Pokémon TCG set.
Run this locally (needs internet). Images are saved to images/<set-id>/
and a local-cards.json manifest is written so the web app uses them.

Usage:
    python download-images.py              # interactive: lists sets, you pick one
    python download-images.py --set sv3pt5 # download a specific set by ID
    python download-images.py --list       # just list available sets and exit
"""

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

API      = "https://api.pokemontcg.io/v2"
HERE     = os.path.dirname(os.path.abspath(__file__))
IMG_ROOT = os.path.join(HERE, "images")
MANIFEST = os.path.join(HERE, "local-cards.json")
RARITIES = ["Illustration Rare", "Special Illustration Rare"]


# ── Helpers ────────────────────────────────────────────────────────────────────

def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ptcg-local-db/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def fetch_all_cards(query_str, label=""):
    """Paginate through the API and return all matching cards."""
    q    = urllib.parse.quote(query_str)
    page = 1
    cards, total = [], None

    while True:
        url  = f"{API}/cards?q={q}&pageSize=250&page={page}"
        data = fetch_json(url)
        if total is None:
            total = data["totalCount"]
            if label:
                print(f"  {label}: {total} cards")
        cards.extend(data["data"])
        if len(data["data"]) < 250 or len(cards) >= total:
            break
        page += 1

    return cards


def download_file(url, dest):
    """Download url → dest. Returns True if newly downloaded."""
    if os.path.exists(dest):
        return False
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "ptcg-local-db/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r, open(dest, "wb") as f:
        f.write(r.read())
    return True


def sets_with_ir_sir():
    """Return sorted list of (set_id, {name, releaseDate}) that have IR or SIR cards."""
    print("Scanning sets with IR/SIR cards…")
    seen = {}
    for rarity in RARITIES:
        data = fetch_all_cards(f'rarity:"{rarity}"', label=f"  {rarity}")
        for c in data:
            s = c.get("set", {})
            sid = s.get("id")
            if sid and sid not in seen:
                seen[sid] = {"name": s.get("name", sid), "releaseDate": s.get("releaseDate", "")}
    return sorted(seen.items(), key=lambda x: x[1]["releaseDate"])


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set",  metavar="SET_ID", help="Set ID to download (e.g. sv3pt5)")
    parser.add_argument("--list", action="store_true", help="List available sets and exit")
    args = parser.parse_args()

    # ── List mode ──────────────────────────────────────────────
    if args.list:
        sets = sets_with_ir_sir()
        print("\nSets with IR/SIR cards:")
        for sid, info in sets:
            print(f"  [{sid:<12}] {info['name']:<40} {info['releaseDate']}")
        return

    # ── Resolve set ────────────────────────────────────────────
    if args.set:
        set_id   = args.set
        set_name = set_id
    else:
        sets = sets_with_ir_sir()
        print("\nSets with IR/SIR cards:\n")
        for i, (sid, info) in enumerate(sets, 1):
            marker = " ← default" if i == len(sets) else ""
            print(f"  {i:>3}. [{sid:<12}] {info['name']:<40} {info['releaseDate']}{marker}")

        raw = input("\nEnter number or set ID [press Enter for the latest set]: ").strip()
        if not raw:
            set_id, meta = sets[-1]
            set_name = meta["name"]
        elif raw.isdigit():
            idx = int(raw) - 1
            if not (0 <= idx < len(sets)):
                print("Invalid choice.", file=sys.stderr); sys.exit(1)
            set_id, meta = sets[idx]
            set_name = meta["name"]
        else:
            set_id   = raw
            set_name = raw

    # ── Fetch cards ────────────────────────────────────────────
    print(f"\nFetching IR/SIR cards for: {set_name} ({set_id})…")
    cards = []
    for rarity in RARITIES:
        batch = fetch_all_cards(f'rarity:"{rarity}" set.id:{set_id}', label=f"  {rarity}")
        cards.extend(batch)

    if not cards:
        print(f"No IR/SIR cards found for set ID '{set_id}'.", file=sys.stderr)
        sys.exit(1)

    print(f"\nDownloading {len(cards)} card image(s) → images/{set_id}/\n")

    # ── Download images ────────────────────────────────────────
    manifest_patch = {}
    errors = 0

    for i, card in enumerate(cards, 1):
        imgs     = card.get("images", {})
        img_url  = imgs.get("large") or imgs.get("small")
        if not img_url:
            continue

        ext      = img_url.rsplit(".", 1)[-1].split("?")[0] or "png"
        filename = f"{card['number']}.{ext}"
        dest     = os.path.join(IMG_ROOT, set_id, filename)
        rel_path = f"images/{set_id}/{filename}"   # relative to index.html

        prefix = f"  [{i:>{len(str(len(cards)))}}/{len(cards)}]"
        print(f"{prefix} {card['name']:<30} ({card['number']})", end="  ", flush=True)

        try:
            new = download_file(img_url, dest)
            print("downloaded" if new else "cached")
        except Exception as exc:
            print(f"ERROR: {exc}")
            errors += 1
            rel_path = None

        time.sleep(0.08)   # ~12 req/s — polite to the CDN

        patched = dict(card)
        patched["_localImage"] = rel_path
        manifest_patch[card["id"]] = patched

    # ── Update manifest ────────────────────────────────────────
    existing = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as f:
            try:
                for c in json.load(f):
                    existing[c["id"]] = c
            except json.JSONDecodeError:
                pass

    existing.update(manifest_patch)

    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(list(existing.values()), f, ensure_ascii=False, indent=2)

    # ── Summary ────────────────────────────────────────────────
    downloaded = sum(1 for v in manifest_patch.values() if v.get("_localImage"))
    print(f"\n{'─'*55}")
    print(f"  Set:        {set_name} ({set_id})")
    print(f"  Cards:      {len(cards)}")
    print(f"  Downloaded: {downloaded}  |  Errors: {errors}")
    print(f"  Images:     pokemon-tcg/images/{set_id}/")
    print(f"  Manifest:   pokemon-tcg/local-cards.json")
    print(f"{'─'*55}")
    print("\nOpen pokemon-tcg/index.html in your browser — local images will load automatically.")


if __name__ == "__main__":
    main()
