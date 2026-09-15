#!/usr/bin/env python3
"""
Porównanie strony zbudowanej w Astro (dist/) z ostatnim renderem Publii (output/).

Sprawdza:
  - adresy URL obecne tylko po jednej stronie,
  - różnice w tekście treści (<main>),
  - różnice w linkach i obrazkach wewnątrz <main>.

Pamiętaj, że output/ Publii jest aktualny tylko na chwilę ostatniego renderu –
wpisy dodane później w Publii pojawią się jako „tylko w Astro”.

Użycie:
  python scripts/compare-with-publii.py [--publii ŚCIEŻKA] [--dist dist] [--details 10]
"""

from __future__ import annotations

import argparse
import difflib
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PUBLII = Path(r"C:\Programowanie\HTML\Publii\sites\poza-linia\output")
SITE = "https://pozalinia.pl"
BLOCK_TAGS = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "br", "figure", "figcaption", "section", "nav", "header", "footer", "article", "blockquote", "summary", "details"}
# Etykiety, których Publii nie miał przetłumaczonych – w Astro są po polsku
IGNORED_WORDS = {"[MISSING", "TRANSLATION]", "Starsze", "Nowsze"}


def collect_pages(root: Path) -> dict[str, Path]:
    pages = {}
    for file in root.rglob("*.html"):
        relative = file.relative_to(root).as_posix()
        url = "/" + (relative[: -len("index.html")] if relative.endswith("index.html") else relative)
        pages[url] = file
    return pages


def normalize_url(base: str, href: str) -> str:
    if href.startswith(("mailto:", "tel:", "#", "javascript:", "data:")):
        return href
    url = urlparse(urljoin(SITE + base, href))
    if url.netloc and url.netloc != urlparse(SITE).netloc:
        return href
    return unquote(url.path)


class MainContent(HTMLParser):
    def __init__(self, base: str):
        super().__init__(convert_charrefs=True)
        self.base = base
        self.depth = 0
        self.skip = 0
        self.parts: list[str] = []
        self.links: set[str] = set()
        self.images: set[str] = set()

    def handle_starttag(self, tag, attrs):
        if tag == "main":
            self.depth += 1
        if not self.depth:
            return
        attributes = dict(attrs)
        if tag in ("script", "style"):
            self.skip += 1
        if tag == "a" and attributes.get("href"):
            self.links.add(normalize_url(self.base, attributes["href"]))
        if tag == "img" and attributes.get("src"):
            self.images.add(normalize_url(self.base, attributes["src"]))
        if tag in BLOCK_TAGS:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if not self.depth:
            return
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
        if tag in BLOCK_TAGS:
            self.parts.append(" ")
        if tag == "main":
            self.depth -= 1

    def handle_data(self, data):
        if self.depth and not self.skip:
            self.parts.append(data)

    @property
    def words(self) -> list[str]:
        return [w for w in "".join(self.parts).split() if w not in IGNORED_WORDS]


def parse(url: str, file: Path) -> MainContent:
    parser = MainContent(url)
    parser.feed(file.read_text("utf-8", errors="replace"))
    return parser


def first_difference(a: list[str], b: list[str], context: int = 8) -> str:
    matcher = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op != "equal":
            before = " ".join(a[max(0, i1 - context):i1])
            return f"…{before} [Publii: {' '.join(a[i1:i2])[:200]!r}] [Astro: {' '.join(b[j1:j2])[:200]!r}]"
    return ""


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Porównanie Astro z Publii")
    parser.add_argument("--publii", type=Path, default=DEFAULT_PUBLII)
    parser.add_argument("--dist", type=Path, default=ROOT / "dist")
    parser.add_argument("--details", type=int, default=15, help="ile różnic pokazać w każdej kategorii")
    args = parser.parse_args()

    publii, astro = collect_pages(args.publii), collect_pages(args.dist)
    only_publii = sorted(set(publii) - set(astro))
    only_astro = sorted(set(astro) - set(publii))
    print(f"Strony: Publii {len(publii)}, Astro {len(astro)}")
    print(f"\nTylko w Publii ({len(only_publii)}):")
    for url in only_publii:
        print(f"  {url}")
    print(f"\nTylko w Astro ({len(only_astro)}):")
    for url in only_astro:
        print(f"  {url}")

    text_diffs, link_diffs, image_diffs = [], [], []
    for url in sorted(set(publii) & set(astro)):
        old, new = parse(url, publii[url]), parse(url, astro[url])
        if old.words != new.words:
            text_diffs.append((url, first_difference(old.words, new.words)))
        if old.links != new.links:
            link_diffs.append((url, sorted(old.links - new.links), sorted(new.links - old.links)))
        if old.images != new.images:
            image_diffs.append((url, sorted(old.images - new.images), sorted(new.images - old.images)))

    common = len(set(publii) & set(astro))
    print(f"\nRóżnice w tekście: {len(text_diffs)} z {common} wspólnych stron")
    for url, snippet in text_diffs[: args.details]:
        print(f"  {url}\n    {snippet}")
    print(f"\nRóżnice w linkach: {len(link_diffs)}")
    for url, removed, added in link_diffs[: args.details]:
        print(f"  {url}\n    tylko Publii: {removed[:6]}\n    tylko Astro:  {added[:6]}")
    print(f"\nRóżnice w obrazkach: {len(image_diffs)}")
    for url, removed, added in image_diffs[: args.details]:
        print(f"  {url}\n    tylko Publii: {removed[:6]}\n    tylko Astro:  {added[:6]}")


if __name__ == "__main__":
    main()
