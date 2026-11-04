const REDAKTORZY_TSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQWKQFq5K4oAH8vFXeXxjZl4ym6rapVWN05oDhx7tykewL3A_FGQZcnk05XG0Va_e_cHWORpfqPs13m/pub?gid=0&single=true&output=tsv';

const PATRONATY_TSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQWKQFq5K4oAH8vFXeXxjZl4ym6rapVWN05oDhx7tykewL3A_FGQZcnk05XG0Va_e_cHWORpfqPs13m/pub?gid=1252632175&single=true&output=tsv';

// ===== Narzędzia =====

// Parser TSV odporny na cudzysłowy i nowe linie w opisach
function parseTSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"' && field === "") { inQuotes = true; }
      else if (c === "\t") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some(f => f.trim() !== "")) rows.push(row);
        row = [];
      } else { field += c; }
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, m =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

// Zamienia link udostępniania Google Drive na adres obrazka;
// zwykłe adresy przepuszcza bez zmian
function coverUrl(raw) {
  const url = (raw || "").trim();
  if (!url) return "";
  const m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/);
  if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w600`;
  // Z arkusza przepuszczamy tylko adresy https: i względne – bez javascript:, data: itp.
  // (parsowanie tak samo jak w przeglądarce, więc "java\tscript:" też odpada)
  try {
    return new URL(url, "https://pozalinia.pl/").protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}

function buildPatronatyHTML(tsv) {
  const rows = parseTSV(tsv);
  if (rows.length < 2) return "<p>Brak patronatów do wyświetlenia.</p>";

  const headers = rows[0].map(h => h.trim().toLowerCase());
  const col = name => headers.indexOf(name);
  const iRok = col("rok"), iAutor = col("autor"), iTytul = col("tytul"),
        iOpis = col("opis"), iOkladka = col("okladka"),
        iWydawnictwo = col("wydawnictwo");

  // Grupowanie po latach
  const byYear = new Map();
  for (const r of rows.slice(1)) {
    const rok = (r[iRok] || "").trim();
    if (!rok) continue; // pomijamy wiersze bez roku
    if (!byYear.has(rok)) byYear.set(rok, []);
    byYear.get(rok).push(r);
  }

  // Lata malejąco (numerycznie)
  const years = [...byYear.keys()].sort((a, b) => Number(b) - Number(a));

  let html = "";
  for (const year of years) {
    html += `<section class="patronaty-rok"><h2>${esc(year)}</h2><div class="patronaty-lista">`;
    for (const r of byYear.get(year)) {
      const cover = coverUrl(r[iOkladka]);
      html += `<article class="patronat">`;
      if (cover) {
        const coverBig = cover.replace("sz=w600", "sz=w1200");
        html += `<a class="patronat-lupa" href="${esc(coverBig)}" data-lightbox>
          <img class="patronat-okladka" src="${esc(cover)}" alt="Okładka: ${esc(r[iTytul])}" loading="lazy">
        </a>`;
      }
      const wydawnictwo = iWydawnictwo >= 0 ? (r[iWydawnictwo] || "").trim() : "";
      html += `<div class="patronat-tresc">
        <h3 class="patronat-tytul">${esc(r[iTytul])}</h3>
        <p class="patronat-autor">${esc(r[iAutor])}</p>`;
      if (wydawnictwo) {
        html += `<p class="patronat-wydawnictwo">Wydawnictwo: ${esc(wydawnictwo)}</p>`;
      }
      html += `<p class="patronat-opis">${esc(r[iOpis])}</p>
      </div></article>`;
    }
    html += `</div></section>`;
  }
  return html;
}

// ===== Nagłówki bezpieczeństwa =====

// Te same nagłówki są w public/_headers (pliki statyczne obsługiwane bez Workera).
// Tu dostają je odpowiedzi przechodzące przez Workera. Zmieniając jedno, zmień oba –
// tests/worker.test.js sprawdza zgodność.
const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Content-Security-Policy": "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
};

function withSecurityHeaders(response) {
  // Kopia odpowiedzi, bo nagłówki odpowiedzi z ASSETS/HTMLRewriter mogą być niezmienne
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) copy.headers.set(name, value);
  return copy;
}

// ===== Worker =====

const handler = {
  async fetch(request, env, ctx) {
    // 1. Pobieramy oryginalny plik statyczny z Publii
    let response = await env.ASSETS.fetch(request);

    const url = new URL(request.url);

    // Wspólne bezpieczniki dla obu podstron:
    const isONas = url.pathname.endsWith('/o-nas/');
    const isPatronaty = url.pathname === "/patronaty/" || url.pathname === "/patronaty";

    if (isONas || isPatronaty) {
      // BEZPIECZNIK 1: Jeśli przeglądarka ma skeszowaną stronę (304), zwracamy ją bez zmian
      if (response.status === 304) {
        return response;
      }
      // BEZPIECZNIK 2: Upewniamy się, że modyfikujemy plik tekstowy/HTML
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        return response;
      }
    }

    // Podstrona "O nas" — bio redaktorów
    if (isONas) {
      try {
        const sheetResponse = await fetch(REDAKTORZY_TSV, { cf: { cacheTtl: 300 } });
        if (!sheetResponse.ok) return response;

        const text = await sheetResponse.text();

        const bios = {};
        const lines = text.split('\n');
        for (let line of lines) {
          const [id, bio] = line.split('\t');
          // id trafia do selektora CSS – przepuszczamy tylko litery, cyfry, "_" i "-"
          if (id && bio && /^[\w-]+$/.test(id.trim())) bios[id.trim()] = bio.trim();
        }

        let rewriter = new HTMLRewriter();
        for (const [id, bio] of Object.entries(bios)) {
          rewriter.on(`[data-bio="${id}"]`, {
            element(element) { element.setInnerContent(bio); }
          });
        }

        return rewriter.transform(response);
      } catch (err) {
        // Awaryjne wyjście – w razie problemów z Google Sheets, ładuje się zwykła strona
        return response;
      }
    }

    // Podstrona "Patronaty" — lista książek z arkusza
    if (isPatronaty) {
      try {
        const tsvResp = await fetch(PATRONATY_TSV, { cf: { cacheTtl: 300 } });
        if (!tsvResp.ok) return response; // awaria arkusza -> strona z komunikatem zapasowym

        const listHTML = buildPatronatyHTML(await tsvResp.text());

        return new HTMLRewriter()
          .on("[data-patronaty]", {
            element(el) { el.setInnerContent(listHTML, { html: true }); }
          })
          .transform(response);
      } catch (err) {
        return response;
      }
    }

    return response;
  },
};
// Każda odpowiedź Workera dostaje nagłówki bezpieczeństwa
export default {
  async fetch(request, env, ctx) {
    return withSecurityHeaders(await handler.fetch(request, env, ctx));
  },
};
