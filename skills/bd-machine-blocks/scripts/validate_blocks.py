#!/usr/bin/env python3
"""Validate the <people> / <portcos> machine blocks in a BD Desk deliverable.

Usage:
    python3 validate_blocks.py <file>             # require a <people> block
    python3 validate_blocks.py <file> --portcos   # also require a <portcos> block

Exit 0 = valid. Otherwise prints one line per violation and exits 1.
"""
import json
import re
import sys

LINKEDIN = re.compile(r"^https://(www\.)?linkedin\.com/in/.+")
FITS = {"Strong", "Worth a look"}


def block(text: str, tag: str):
    m = re.search(rf"<{tag}>(.*?)</{tag}>", text, re.S | re.I)
    if not m:
        return None, None
    try:
        data = json.loads(re.sub(r"```json|```", "", m.group(1)).strip())
    except json.JSONDecodeError as e:
        return m, f"<{tag}> is not valid JSON: {e}"
    if not isinstance(data, list):
        return m, f"<{tag}> must be a JSON array"
    return m, data


def main() -> int:
    path = sys.argv[1]
    want_portcos = "--portcos" in sys.argv
    text = open(path, encoding="utf-8").read()
    errors = []

    pm, people = block(text, "people")
    if pm is None:
        errors.append("missing <people>[…]</people> block")
    elif isinstance(people, str):
        errors.append(people)
    else:
        if len(people) > 6:
            errors.append(f"<people> has {len(people)} entries — keep to the 2–6 most relevant")
        for i, p in enumerate(people):
            who = f"people[{i}]"
            if not isinstance(p, dict) or not isinstance(p.get("name"), str) or not p["name"].strip():
                errors.append(f"{who}: needs a non-empty string \"name\"")
                continue
            if "persona" in p and not (isinstance(p["persona"], str) and p["persona"].strip()):
                errors.append(f"{who} ({p['name']}): persona, when present, must be a non-empty string")
            if "linkedin" in p and not (isinstance(p["linkedin"], str) and LINKEDIN.match(p["linkedin"])):
                errors.append(f"{who} ({p['name']}): linkedin must be a real https://www.linkedin.com/in/… URL — omit it if none was surfaced")
            if not isinstance(p.get("source"), str) or not p["source"].strip():
                errors.append(f"{who} ({p['name']}): needs a \"source\" URL")

    pcm, portcos = block(text, "portcos")
    if want_portcos:
        if pcm is None:
            errors.append("missing <portcos>[…]</portcos> block (must follow </people>)")
        elif isinstance(portcos, str):
            errors.append(portcos)
        else:
            for i, p in enumerate(portcos):
                who = f"portcos[{i}]"
                if not isinstance(p, dict) or not isinstance(p.get("company"), str) or not p["company"].strip():
                    errors.append(f"{who}: needs a non-empty string \"company\"")
                    continue
                if not isinstance(p.get("sponsor"), str) or not p["sponsor"].strip():
                    errors.append(f"{who} ({p['company']}): needs \"sponsor\"")
                if p.get("fit") not in FITS:
                    errors.append(f"{who} ({p['company']}): fit must be exactly \"Strong\" or \"Worth a look\"")
                for arr in ("green_signals", "sources"):
                    if arr in p and not (isinstance(p[arr], list) and all(isinstance(x, str) for x in p[arr])):
                        errors.append(f"{who} ({p['company']}): {arr} must be an array of strings")
    elif pcm is not None:
        errors.append("unexpected <portcos> block — dossiers emit only <people>")

    last = pcm or pm
    if last is not None and text[last.end():].strip():
        errors.append("content found after the final closing tag — the machine blocks must end the deliverable")

    if errors:
        print(f"INVALID — {len(errors)} violation(s):")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
