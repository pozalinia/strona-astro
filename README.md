# POZa Linią – strona w Astro

Strona czasopisma literackiego [pozalinia.pl](https://pozalinia.pl) przeniesiona z Publii.
Wygląd, kod wtyczek i adresy URL są takie same jak w Publii (`/post/slug/`, `/post/tags/slug/page/2/`,
`/post/authors/osoba/`, `/o-nas/` …), więc przełączenie nie wymaga przekierowań.

## Uruchomienie

Wymagany Node 22+.

```sh
npm install
npm run dev       # http://localhost:4321
npm run build     # strona w dist/
npm run preview   # podgląd zbudowanej strony
```

## Struktura

```text
src/content/posts/     wpisy – plik .md: frontmatter + treść (HTML z Publii albo Markdown)
src/content/pages/     strony: O nas, Kontakt, Patronaty, Wydania
src/content/tags/      tagi: numery, działy, wydarzenia (.json)
src/content/authors/   osoby autorskie z biogramami (.json)
src/data/menu.json     menu główne
src/data/publii/       stopka oraz kod wtyczek Publii (pasek WCAG)
src/components/        elementy motywu: nagłówek, stopka, listy, szablony wpisów, baner zgody (CookieConsent)
src/pages/             adresy stron
src/lib/               reguły list i przetwarzanie treści (srcset, zajawki, meta description)
public/assets/         CSS, JS i SVG motywu
public/media/          obrazki wraz z wariantami responsive/ wygenerowanymi przez Publii
public/admin/          panel redakcyjny Sveltia CMS (index.html + config.yml)
public/_worker.js      Worker Cloudflare: biogramy redakcji i patronaty z Google Sheets
scripts/               migracja z Publii i porównanie z Publii
tests/                 testy (`npm test`): wybór strumienia GA wg domeny
```

## Wpisy

Nazwa pliku to slug (adres `/post/<nazwa>/`). Najważniejsze pola frontmattera:

| Pole | Znaczenie |
| :-- | :-- |
| `title`, `date`, `author` | tytuł, data publikacji, osoba autorska (nazwa pliku z `src/content/authors/`) |
| `template` | `poem` (wiersz), `review` (recenzja), `text` (tekst), `default` (np. strona numeru) |
| `tags`, `mainTag` | tagi; grafika `mainTag` jest nagłówkiem wiersza/recenzji/tekstu |
| `hidden` | wpis ma swoją stronę, ale nie pojawia się na listach (np. numer przed premierą) |
| `excludeFromHomepage` | wpis nie trafia na stronę główną |
| `featuredImage` | obrazek wyróżniający (`src`, `alt`, `width`, `height`) |
| `prevPost`, `nextPost` | strzałki ◁ ▷; bez pola – sąsiedni wpis wg `publiiId` |
| `releasePost`, `reviewPost` | linki do numeru i recenzji w dolnej nawigacji |
| `coauthor`, `coauthorText` | drugi biogram i drugi tekst pod wpisem |
| `customTitle`, `secondTextTitle` | własny tytuł w nawigacji / nad drugim tekstem |
| `format` | `html` dla treści z Publii; nowe wpisy można pisać w Markdownie (domyślnie) |

Strona główna pokazuje wpisy bez `hidden` i `excludeFromHomepage` – od najnowszego („Najnowszy numer”).

## Migracja z Publii

Do dnia przełączenia treść nadal powstaje w Publii, a skrypt odświeża projekt aktualnym stanem bazy:

```sh
python scripts/migrate-publii.py
```

Z `--theme` kopiuje też CSS/JS motywu i kod wtyczek, z `--skip-media` pomija media.
Skrypt nadpisuje `src/content/*` i `src/data/menu.json`, więc przed przełączeniem nie edytuj ich ręcznie.

Porównanie z ostatnim renderem Publii (najpierw wyrenderuj stronę w Publii):

```sh
npm run build
python scripts/compare-with-publii.py
```

Pokazuje adresy obecne tylko po jednej stronie oraz różnice w tekście, linkach i obrazkach.

## Panel redakcyjny (Sveltia CMS)

Panel działa pod `/admin/` i zapisuje zmiany jako commity w repozytorium, po których Cloudflare Pages
przebudowuje stronę. Konfiguracja: `public/admin/config.yml` (pola odwzorowują `src/content.config.ts`).

- **Wpisy**, **Strony** – nowe treści w edytorze rich text (zapis w Markdownie, `format: markdown`).
- **Wpisy z Publii**, **Strony z Publii** – treści przeniesione z Publii (`format: html`) edytowane jako kod,
  bo edytor rich text zapisuje wyłącznie Markdown i zniszczyłby formatowanie wierszy.
- **Tagi**, **Osoby autorskie** – pliki JSON; opisy i biogramy to HTML.
- Obrazki: `/media/posts/<slug wpisu lub strony>/`, `/media/tags/<slug tagu>/`, pliki ogólne `/media/files/`.

Autor/ka, dział i numer wydania wybiera się z list. „Numer wydania” pokazuje wpisy oznaczone jako
wyróżnione (strony numerów). Numer i dział trzeba zaznaczyć także w polu „Tagi” – od tego zależą
listy na stronach tagów.

Dopóki działa migracja z Publii, `scripts/migrate-publii.py` nadpisze zmiany zrobione w panelu –
panelu używaj po ostatniej migracji.

Lokalnie bez logowania: `npm run dev`, potem `http://localhost:4321/admin/index.html` (serwer deweloperski
Astro nie otwiera `index.html` dla samego `/admin/`) i „Pracuj z lokalnym repozytorium” (Chrome lub Edge).

### Logowanie przez GitHub (jednorazowo)

1. Wdróż Workera [sveltia-cms-auth](https://github.com/sveltia/sveltia-cms-auth) na Cloudflare Workers
   i zanotuj jego adres `https://sveltia-cms-auth.<SUBDOMENA>.workers.dev`.
2. Zarejestruj aplikację OAuth na <https://github.com/settings/applications/new> (dla organizacji:
   ustawienia organizacji `pozalinia` → Developer settings → OAuth Apps). Authorization callback URL:
   `<adres Workera>/callback`. Wygeneruj Client Secret.
3. W ustawieniach Workera (Settings → Variables) dodaj `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
   (jako sekret) i `ALLOWED_DOMAINS` = `pozalinia.pl`.
4. W `public/admin/config.yml` odkomentuj `base_url` i wpisz adres Workera.

Bez Workera można zalogować się tokenem GitHub („Sign In with Token”). Osoby z redakcji potrzebują
uprawnień do zapisu w repozytorium `pozalinia/strona-astro`.

## Wdrożenie (Cloudflare Pages)

1. Nowy projekt Pages połączony z repozytorium `pozalinia/strona-astro`.
2. Build command `npm run build`, katalog wyjściowy `dist`, zmienna środowiskowa `NODE_VERSION=22`.
3. Sprawdzenie strony na adresie `*.pages.dev` – numer po numerze.
4. Przepięcie domeny `pozalinia.pl` na nowy projekt. Publii zostaje jako kopia zapasowa na kilka tygodni.

`public/_worker.js` trafia do `dist/`, więc Pages działa w trybie Workera tak jak dotychczas.

## Google Analytics i zgoda (RODO)

Strona działa pod `pozalinia.pl` i `pozalinią.pl` (bez przekierowań). Każda domena ma własny strumień GA4:
zmienne `PUBLIC_GA_ID_POZALINIA` i `PUBLIC_GA_ID_POZALINIA_IDN` w ustawieniach Cloudflare Pages (wstawiane przy
budowaniu – po zmianie trzeba przebudować stronę). Mapa host → zmienna: `src/lib/analytics.js`; na innych hostach
(`*.pages.dev`, localhost) GA się nie ładuje.

`src/components/CookieConsent.astro` (wpięty w `Base.astro`) nie pobiera niczego z Google przed kliknięciem
„Akceptuję”. Wybór jest w `localStorage` (`pl-consent`) przez 12 miesięcy, osobno na każdej domenie;
„Ustawienia cookies” w stopce otwiera baner ponownie. Nie wklejaj kodu `gtag` do treści ani szablonów.
