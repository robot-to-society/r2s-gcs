#!/usr/bin/env python3
"""Extract the Glass prototype's <style> block into the UI's prototype.css (the app
uses the prototype's class names verbatim). Run after editing design_base/project/RGCS Prototype Glass.dc.html.

    python3 scripts/sync-css.py
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "design_base/project/RGCS Prototype Glass.dc.html"
DST = ROOT / "apps/rgcs-server/ui/src/styles/prototype.css"

html = SRC.read_text(encoding="utf-8")
m = re.search(r"<style>\n(.*?)</style>", html, re.S)
if not m:
    sys.exit("no <style> block in the prototype")
css = m.group(1)
header = (
    "/* GENERATED from the RGCS design prototype (the Glass design tokens and base styles).\n"
    " * Do not edit by hand: the maintainers regenerate it from the prototype.\n"
    " * App-only additions live in app.css. */\n"
)
DST.write_text(header + css, encoding="utf-8")
print(f"wrote {DST.relative_to(ROOT)} ({len(css.splitlines())} lines)")
