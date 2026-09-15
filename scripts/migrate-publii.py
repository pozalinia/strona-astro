#!/usr/bin/env python3
"""
Migracja strony POZa Linią z Publii do Astro.

Czyta bazę Publii (input/db.sqlite) oraz konfigurację site'u i generuje:
  src/content/posts/*.md      wpisy (frontmatter + treść HTML)
  src/content/pages/*.md      strony (O nas, Kontakt, Patronaty, Wydania…)
  src/content/tags/*.json     tagi (numery, działy, wydarzenia)
  src/content/authors/*.json  osoby autorskie
  src/data/menu.json          menu główne
  public/media/               media (kopia input/media)

Z flagą --theme dodatkowo kopiuje zasoby motywu (CSS, JS, SVG, pliki
z katalogu głównego) oraz fragmenty HTML dokładane przez wtyczki Publii
(pasek WCAG, baner cookies, Google Analytics) do src/data/publii/.

Skrypt można uruchamiać wielokrotnie – aż do dnia przełączenia nadpisuje
wygenerowane pliki treści aktualnym stanem bazy Publii.

Użycie:
  python scripts/migrate-publii.py [--site ŚCIEŻKA] [--theme] [--skip-media]
"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import sqlite3
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SITE = Path(r"C:\Programowanie\HTML\Publii\sites\poza-linia")
POST_TEMPLATES = {"poem", "review", "text"}
JPEG_SOF = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}


def image_size(path: Path) -> tuple[int, int] | None:
    """Wymiary PNG/JPEG/GIF/WebP bez zewnętrznych bibliotek."""
    try:
        with path.open("rb") as f:
            head = f.read(30)
            if head.startswith(b"\x89PNG\r\n\x1a\n"):
                return struct.unpack(">II", head[16:24])
            if head[:6] in (b"GIF87a", b"GIF89a"):
                return struct.unpack("<HH", head[6:10])
            if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                kind = head[12:16]
                if kind == b"VP8X":
                    return 1 + int.from_bytes(head[24:27], "little"), 1 + int.from_bytes(head[27:30], "little")
                if kind == b"VP8 ":
                    width, height = struct.unpack("<HH", head[26:30])
                    return width & 0x3FFF, height & 0x3FFF
                if kind == b"VP8L":
                    bits = int.from_bytes(head[21:25], "little")
                    return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
            if head[:2] == b"\xff\xd8":
                f.seek(2)
                while True:
                    byte = f.read(1)
                    if not byte:
                        return None
                    if byte != b"\xff":
                        continue
                    marker = f.read(1)
                    while marker == b"\xff":
                        marker = f.read(1)
                    if not marker:
                        return None
                    code = marker[0]
                    if code in (0x01, 0xD8) or 0xD0 <= code <= 0xD7:
                        continue
                    length = struct.unpack(">H", f.read(2))[0]
                    if code in JPEG_SOF:
                        height, width = struct.unpack(">xHH", f.read(5))
                        return width, height
                    f.seek(length - 2, 1)
    except (OSError, struct.error):
        return None
    return None


def parse_json(value, default):
    try:
        data = json.loads(value) if value else default
    except (TypeError, ValueError):
        return default
    return default if data is None else data


def iso_date(ms) -> str | None:
    if not ms:
        return None
    return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def view_value(settings: dict, key: str) -> str:
    item = settings.get(key)
    if not isinstance(item, dict) or item.get("value") is None:
        return ""
    return str(item["value"]).strip()


def clean_dir(path: Path, pattern: str) -> None:
    path.mkdir(parents=True, exist_ok=True)
    for file in path.glob(pattern):
        file.unlink()


def write_markdown(path: Path, frontmatter: dict, body: str) -> None:
    # JSON jest poprawnym YAML-em, więc cudzysłowy, gwiazdki i nawiasy w tytułach są bezpieczne
    lines = ["---"]
    lines += [f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in frontmatter.items()]
    lines += ["---", "", body.strip(), ""]
    path.write_text("\n".join(lines), encoding="utf-8", newline="\n")


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def copy_file(src: Path, dst: Path) -> bool:
    """Kopiuje plik, jeśli brakuje go w celu albo się zmienił."""
    if dst.exists():
        s, d = src.stat(), dst.stat()
        if s.st_size == d.st_size and int(s.st_mtime) <= int(d.st_mtime):
            return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return True


class Migration:
    def __init__(self, site: Path):
        self.input = site / "input"
        self.output = site / "output"
        self.warnings: list[str] = []

        con = sqlite3.connect(self.input / "db.sqlite")
        con.row_factory = sqlite3.Row
        self.posts: dict[int, dict] = {}
        for row in con.execute("SELECT * FROM posts"):
            post = dict(row)
            post["flags"] = set(filter(None, (post["status"] or "").split(",")))
            post["extra"] = {}
            self.posts[post["id"]] = post
        for row in con.execute("SELECT post_id, key, value FROM posts_additional_data"):
            if row["post_id"] in self.posts:
                self.posts[row["post_id"]]["extra"][row["key"]] = parse_json(row["value"], {})
        self.images = {row["id"]: dict(row) for row in con.execute("SELECT * FROM posts_images")}
        self.tags = {row["id"]: dict(row) for row in con.execute("SELECT * FROM tags")}
        self.authors = {row["id"]: dict(row) for row in con.execute("SELECT * FROM authors")}
        self.post_tags: dict[int, list[int]] = {}
        for row in con.execute("SELECT tag_id, post_id FROM posts_tags ORDER BY tag_id"):
            self.post_tags.setdefault(row["post_id"], []).append(row["tag_id"])
        con.close()

        self.authors_by_username = {a["username"]: a for a in self.authors.values()}
        config = self.input / "config"
        self.theme_config = parse_json((config / "theme.config.json").read_text("utf-8"), {})
        self.menu_config = parse_json((config / "menu.config.json").read_text("utf-8"), [])
        self.page_parents: dict[int, int] = {}
        for node in parse_json((config / "pages.config.json").read_text("utf-8"), []):
            self._walk_pages(node, None)

    def _walk_pages(self, node: dict, parent: int | None) -> None:
        if parent is not None:
            self.page_parents[node["id"]] = parent
        for child in node.get("subpages", []):
            self._walk_pages(child, node["id"])

    # --- reguły Publii -------------------------------------------------------

    @staticmethod
    def renderable(post: dict) -> bool:
        """Publii generuje stronę dla wpisów opublikowanych, także ukrytych."""
        flags = post["flags"]
        return "published" in flags and "trashed" not in flags and "draft" not in flags

    def is_page(self, post: dict) -> bool:
        return "is-page" in post["flags"]

    def page_path(self, page: dict) -> str:
        parts = [page["slug"]]
        parent = self.page_parents.get(page["id"])
        while parent is not None and parent in self.posts:
            parts.insert(0, self.posts[parent]["slug"])
            parent = self.page_parents.get(parent)
        return "/".join(parts)

    def item_url(self, item_id: int) -> str | None:
        post = self.posts.get(item_id)
        if not post or not self.renderable(post):
            return None
        return f"/{self.page_path(post)}/" if self.is_page(post) else f"/post/{post['slug']}/"

    def post_slug(self, value: str) -> str | None:
        """Pola Publii typu „ID wpisu” → slug opublikowanego wpisu."""
        if not value.isdigit():
            return None
        post = self.posts.get(int(value))
        if not post or not self.renderable(post) or self.is_page(post):
            return None
        return post["slug"]

    def author_username(self, author_id) -> str:
        try:
            return self.authors[int(author_id)]["username"]
        except (KeyError, TypeError, ValueError):
            return "admin"

    # --- treść ---------------------------------------------------------------

    def resolve_links(self, text: str, item: dict) -> str:
        text = text.replace("#DOMAIN_NAME#", f"/media/posts/{item['id']}/")

        def replace(match: re.Match) -> str:
            kind, ref = match.group(1), match.group(2)
            url = None
            if kind in ("post", "page") and ref.isdigit():
                url = self.item_url(int(ref))
            elif kind == "tag" and ref.isdigit() and int(ref) in self.tags:
                url = f"/post/tags/{self.tags[int(ref)]['slug']}/"
            elif kind == "author" and ref in self.authors_by_username:
                url = f"/post/authors/{ref}/"
            if url is None:
                self.warnings.append(f"{item['slug']}: nie da się rozwiązać linku {match.group(0)}")
                return "#"
            return url

        return re.sub(r"#INTERNAL_LINK#/(post|page|tag|author)/([A-Za-z0-9_-]+)", replace, text)

    def blocks_to_html(self, raw: str, item: dict) -> str:
        """Treść z edytora blokowego Publii (JSON) → HTML."""
        parts = []
        for block in parse_json(raw, []):
            kind, content = block.get("type"), block.get("content")
            config = block.get("config") or {}
            css = ((config.get("advanced") or {}).get("cssClasses") or "").strip()
            css_attr = f' class="{css}"' if css else ""
            if kind == "publii-image" and isinstance(content, dict):
                align = config.get("imageAlign") or ""
                figure_class = "post__image" + (f" post__image--{align}" if align else "")
                img = (
                    f'<img src="{content.get("image", "")}" height="{content.get("imageHeight", "")}" '
                    f'width="{content.get("imageWidth", "")}" alt="{html.escape(content.get("alt", ""))}">'
                )
                link = (config.get("link") or {}).get("url")
                if link:
                    img = f'<a href="{link}">{img}</a>'
                caption = content.get("caption")
                parts.append(f'<figure class="{figure_class}">{img}' + (f"<figcaption>{caption}</figcaption>" if caption else "") + "</figure>")
            elif kind == "publii-paragraph":
                parts.append(f"<p{css_attr}>{content or ''}</p>")
            elif kind == "publii-header":
                level = config.get("headingLevel") or 2
                parts.append(f"<h{level}{css_attr}>{content or ''}</h{level}>")
            elif kind == "publii-separator":
                parts.append("<hr>")
            elif isinstance(content, str):
                parts.append(f"<div{css_attr}>{content}</div>" if css else content)
            else:
                self.warnings.append(f"{item['slug']}: nieobsługiwany blok edytora {kind}")
        return "\n".join(parts)

    def body(self, item: dict) -> str:
        text = item["text"] or ""
        if text.lstrip().startswith("["):
            text = self.blocks_to_html(text, item)
        return self.resolve_links(text, item)

    def image_entry(self, src: str, alt: str = "", caption: str = "", credits: str = "") -> dict:
        entry: dict = {"src": src}
        if alt:
            entry["alt"] = alt
        if caption:
            entry["caption"] = caption
        if credits:
            entry["credits"] = credits
        file = self.input / src.lstrip("/")
        size = image_size(file)
        if size:
            entry["width"], entry["height"] = size
        else:
            self.warnings.append(f"brak obrazka albo nieznany format: {src}")
        return entry

    def featured_image(self, item: dict) -> dict | None:
        image = self.images.get(item["featured_image_id"])
        if not image or not image.get("url"):
            return None
        extra = parse_json(image.get("additional_data"), {})
        return self.image_entry(
            f"/media/posts/{item['id']}/{image['url']}",
            extra.get("alt", ""),
            extra.get("caption", ""),
            extra.get("credits", ""),
        )

    def base_frontmatter(self, item: dict) -> dict:
        core = item["extra"].get("_core", {})
        data = {
            "publiiId": item["id"],
            "title": item["title"] or "",
            "date": iso_date(item["created_at"]),
            "updated": iso_date(item["modified_at"]),
            "author": self.author_username(item["authors"]),
        }
        return data, core

    # --- zapis ---------------------------------------------------------------

    def write_posts(self, dest: Path) -> tuple[int, int]:
        clean_dir(dest, "*.md")
        written = skipped = 0
        for item in sorted(self.posts.values(), key=lambda p: p["id"]):
            if self.is_page(item):
                continue
            if not self.renderable(item):
                skipped += 1
                continue
            data, core = self.base_frontmatter(item)
            data["template"] = item["template"] if item["template"] in POST_TEMPLATES else "default"
            tags = [self.tags[t]["slug"] for t in self.post_tags.get(item["id"], []) if t in self.tags]
            if tags:
                data["tags"] = tags
            main_tag = str(core.get("mainTag") or "")
            post_tag_ids = [t for t in self.post_tags.get(item["id"], []) if t in self.tags]
            if main_tag.isdigit() and int(main_tag) in self.tags:
                data["mainTag"] = self.tags[int(main_tag)]["slug"]
            elif post_tag_ids:
                # Bez wskazanego głównego tagu Publii bierze pierwszy tag alfabetycznie
                first = min(post_tag_ids, key=lambda t: self.tags[t]["name"].lower())
                data["mainTag"] = self.tags[first]["slug"]
            if "hidden" in item["flags"]:
                data["hidden"] = True
            if "excluded_homepage" in item["flags"]:
                data["excludeFromHomepage"] = True
            if "featured" in item["flags"]:
                data["featured"] = True
            image = self.featured_image(item)
            if image:
                data["featuredImage"] = image
            if core.get("metaTitle"):
                data["metaTitle"] = core["metaTitle"]
            if core.get("metaDesc"):
                data["metaDescription"] = core["metaDesc"]

            view = item["extra"].get("postViewSettings", {})
            for key in ("customTitle", "secondTextTitle"):
                if view_value(view, key):
                    data[key] = view_value(view, key)
            coauthor = view_value(view, "coauthor")
            if coauthor:
                if coauthor in self.authors_by_username:
                    data["coauthor"] = coauthor
                else:
                    self.warnings.append(f"{item['slug']}: nieznana osoba współautorska „{coauthor}”")
            for key, field in (
                ("coauthorTextID", "coauthorText"),
                ("customPreviousPost", "prevPost"),
                ("customNextPost", "nextPost"),
                ("releasePost", "releasePost"),
                ("reviewPost", "reviewPost"),
            ):
                value = view_value(view, key)
                if not value or value == "0":
                    continue
                slug = self.post_slug(value)
                if slug:
                    data[field] = slug
                else:
                    self.warnings.append(f"{item['slug']}: pole {key}={value} wskazuje na nieopublikowany wpis")
                    if field in ("prevPost", "nextPost"):
                        # Publii nie pokazuje wtedy strzałki (i nie szuka sąsiada), więc zapisujemy pustą wartość
                        data[field] = ""
            if view_value(view, "displayCustomPostNavigation") == "0":
                data["displayCustomNav"] = False
            if view_value(view, "displayAuthorBio") == "1":
                data["displayAuthorBio"] = True

            data["format"] = "html"
            write_markdown(dest / f"{item['slug']}.md", data, self.body(item))
            written += 1
        return written, skipped

    def write_pages(self, dest: Path) -> int:
        clean_dir(dest, "*.md")
        written = 0
        for item in sorted(self.posts.values(), key=lambda p: p["id"]):
            if not self.is_page(item) or not self.renderable(item):
                continue
            data, core = self.base_frontmatter(item)
            data["template"] = "empty" if item["template"] == "empty" else "default"
            parent = self.page_parents.get(item["id"])
            if parent in self.posts and self.renderable(self.posts[parent]):
                data["parent"] = self.page_path(self.posts[parent])
            view = item["extra"].get("pageViewSettings", {})
            if view_value(view, "displayAuthor") == "1":
                data["displayAuthor"] = True
            if view_value(view, "displayAuthorBio") == "1":
                data["displayAuthorBio"] = True
            image = self.featured_image(item)
            if image:
                data["featuredImage"] = image
            if core.get("metaTitle"):
                data["metaTitle"] = core["metaTitle"]
            if core.get("metaDesc"):
                data["metaDescription"] = core["metaDesc"]
            data["format"] = "html"
            write_markdown(dest / f"{item['slug']}.md", data, self.body(item))
            written += 1
        return written

    def write_tags(self, dest: Path) -> int:
        clean_dir(dest, "*.json")
        defaults = self.theme_config.get("tagConfig", {})
        for tag in self.tags.values():
            extra = parse_json(tag["additional_data"], {})
            view = extra.get("viewConfig") or {}

            def flag(key: str) -> bool:
                value = view.get(key, "")
                if value in ("", None):
                    value = defaults.get(key, 0)
                return str(value) == "1"

            data: dict = {"publiiId": tag["id"], "name": tag["name"]}
            if tag["description"]:
                data["description"] = tag["description"]
            if extra.get("featuredImage"):
                data["image"] = self.image_entry(
                    f"/media/tags/{tag['id']}/{extra['featuredImage']}",
                    extra.get("featuredImageAlt", ""),
                    extra.get("featuredImageCaption", ""),
                    extra.get("featuredImageCredits", ""),
                )
            if extra.get("isHidden"):
                data["hidden"] = True
            for key in ("displayFeaturedImage", "displayPostCounter", "displayDescription", "displayPostList"):
                data[key] = flag(key)
            if extra.get("metaTitle"):
                data["metaTitle"] = extra["metaTitle"]
            if extra.get("metaDescription"):
                data["metaDescription"] = extra["metaDescription"]
            write_json(dest / f"{tag['slug']}.json", data)
        return len(self.tags)

    def write_authors(self, dest: Path) -> int:
        clean_dir(dest, "*.json")
        for author in self.authors.values():
            config = parse_json(author["config"], {})
            data: dict = {"publiiId": author["id"], "name": author["name"]}
            if config.get("description"):
                data["description"] = config["description"]
            if config.get("website"):
                data["website"] = config["website"]
            write_json(dest / f"{author['username']}.json", data)
        return len(self.authors)

    def menu_item(self, item: dict) -> dict | None:
        if item.get("isHidden"):
            return None
        kind, link = item.get("type"), item.get("link")
        url = None
        if kind == "frontpage":
            url = "/"
        elif kind == "blogpage":
            url = "/post/"
        elif kind == "tag" and str(link).isdigit() and int(link) in self.tags:
            url = f"/post/tags/{self.tags[int(link)]['slug']}/"
        elif kind in ("post", "page") and str(link).isdigit():
            url = self.item_url(int(link))
        elif kind == "external":
            url = link
        if url is None and kind != "separator":
            self.warnings.append(f"menu: pominięto pozycję „{item.get('label')}” (nieaktywny cel)")
            return None
        entry: dict = {"label": item.get("label", "")}
        if url:
            entry["url"] = url
        for key in ("title", "target", "rel", "cssClass"):
            if item.get(key):
                entry[key] = item[key]
        children = [c for c in (self.menu_item(child) for child in item.get("items", [])) if c]
        if children:
            entry["items"] = children
        return entry

    def write_menu(self, dest: Path) -> int:
        main = next((m for m in self.menu_config if m.get("position") == "mainMenu"), {"items": []})
        items = [i for i in (self.menu_item(item) for item in main.get("items", [])) if i]
        write_json(dest, items)
        return len(items)

    def copy_media(self, dest: Path) -> int:
        source = self.input / "media"
        copied = 0
        for file in source.rglob("*"):
            relative = file.relative_to(source)
            if file.is_dir() or relative.parts[0] == "temp":
                continue
            copied += copy_file(file, dest / relative)
        return copied

    def copy_theme(self, public: Path, fragments: Path) -> None:
        for relative in ("assets/css/style.css", "assets/js/scripts.min.js", "assets/svg/svg-map.svg"):
            copy_file(self.output / relative, public / relative)
        for file in (self.input / "root-files").iterdir():
            if file.is_file():
                copy_file(file, public / file.name)
        copy_file(self.output / "robots.txt", public / "robots.txt")
        copy_file(self.input / "media" / "website" / "favicon.ico", public / "favicon.ico")

        fragments.mkdir(parents=True, exist_ok=True)
        footer = self.theme_config.get("customConfig", {}).get("copyrightText", "")
        (fragments / "footer.html").write_text(footer.strip() + "\n", encoding="utf-8", newline="\n")

        # Kod wtyczek (WCAG, cookies) i własny kod z ustawień site'u jest identyczny na
        # każdej stronie – wycinamy go z wygenerowanego wiersza.
        sample = None
        for item in sorted(self.posts.values(), key=lambda p: p["id"]):
            if item["template"] == "poem" and self.renderable(item) and not self.is_page(item):
                candidate = self.output / "post" / item["slug"] / "index.html"
                if candidate.exists():
                    sample = candidate
                    break
        if sample is None:
            self.warnings.append("brak wygenerowanego wiersza w output – pominięto fragmenty wtyczek")
            return
        page = sample.read_text("utf-8")

        def between(start: str, end: str, keep_start: bool = True) -> str:
            i = page.index(start)
            j = page.index(end, i + len(start))
            return page[i if keep_start else i + len(start):j]

        script_start = page.index('<script defer="defer" src="')
        body_start = page.index("</script>", script_start) + len("</script>")
        chunks = {
            "head-top.html": between('<meta name="theme-color"', '<link rel="canonical"'),
            "head-bottom.html": between("</noscript>", "</head>", keep_start=False),
            "body-end.html": page[body_start:page.index("</body>")],
            "toggle-bio.html": page[page.index("</html>") + len("</html>"):],
        }
        for name, chunk in chunks.items():
            chunk = re.sub(r"\./(?:\.\./)*(?=(?:assets|media|post)/)", "/", chunk)
            (fragments / name).write_text(chunk.strip() + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Migracja treści z Publii do Astro")
    parser.add_argument("--site", type=Path, default=DEFAULT_SITE, help="katalog site'u Publii (z input/ i output/)")
    parser.add_argument("--theme", action="store_true", help="skopiuj też zasoby motywu i fragmenty wtyczek")
    parser.add_argument("--skip-media", action="store_true", help="nie kopiuj mediów")
    args = parser.parse_args()

    if not (args.site / "input" / "db.sqlite").exists():
        sys.exit(f"Nie znaleziono bazy Publii: {args.site / 'input' / 'db.sqlite'}")

    migration = Migration(args.site)
    content = ROOT / "src" / "content"
    posts, skipped = migration.write_posts(content / "posts")
    pages = migration.write_pages(content / "pages")
    tags = migration.write_tags(content / "tags")
    authors = migration.write_authors(content / "authors")
    menu = migration.write_menu(ROOT / "src" / "data" / "menu.json")
    print(f"Wpisy: {posts} (pominięte szkice i kosz: {skipped})")
    print(f"Strony: {pages}, tagi: {tags}, osoby autorskie: {authors}, pozycje menu: {menu}")

    if not args.skip_media:
        copied = migration.copy_media(ROOT / "public" / "media")
        print(f"Media: skopiowano/zaktualizowano {copied} plików")
    if args.theme:
        migration.copy_theme(ROOT / "public", ROOT / "src" / "data" / "publii")
        print("Motyw: skopiowano zasoby i fragmenty wtyczek")

    if migration.warnings:
        print(f"\nOstrzeżenia ({len(migration.warnings)}):")
        for warning in migration.warnings:
            print(f"  - {warning}")


if __name__ == "__main__":
    main()
