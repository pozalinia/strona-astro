// Wyszukiwanie w przeglądarce na podstawie /search-index.json (okno w nagłówku i strona /szukaj/)

interface Entry {
  url: string;
  title: string;
  authors: string;
  tags: string;
  text: string;
}
type Indexed = Entry & { folded: Record<'title' | 'authors' | 'tags' | 'text', string> };

interface Options {
  input: HTMLInputElement;
  status: HTMLElement;
  results: HTMLElement;
  /** Ile wyników pokazać */
  limit: number;
  /** Długość fragmentu treści: znaki przed trafieniem i po nim */
  snippet: [before: number, after: number];
  /** Komunikat przy pustym polu */
  hint?: string;
  /** Po każdym wyszukaniu: zapytanie i liczba wszystkich trafień */
  onResults?: (query: string, total: number) => void;
}

const FOLD: Record<string, string> = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
  á: 'a', à: 'a', â: 'a', ä: 'a', ç: 'c', é: 'e', è: 'e', ê: 'e', ë: 'e', í: 'i', î: 'i', ï: 'i',
  ñ: 'n', ô: 'o', ö: 'o', ú: 'u', ù: 'u', û: 'u', ü: 'u', ý: 'y', š: 's', č: 'c', ž: 'z', ř: 'r', ě: 'e',
};
// Zamiana znak za znak: pozycje w tekście złożonym odpowiadają pozycjom w oryginale (podświetlanie)
const fold = (text: string) =>
  Array.from(text.normalize('NFC'), (char) => {
    const lower = char.toLowerCase();
    return lower.length === char.length ? (FOLD[lower] ?? lower) : char;
  }).join('');

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** Tekst z podświetlonymi wystąpieniami szukanych słów */
function highlight(text: string, terms: string[]) {
  const folded = fold(text);
  const ranges: [number, number][] = [];
  for (const term of terms) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
      ranges.push([at, at + term.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let out = '';
  let pos = 0;
  for (const [start, end] of ranges) {
    if (start < pos) continue;
    out += `${escapeHtml(text.slice(pos, start))}<mark>${escapeHtml(text.slice(start, end))}</mark>`;
    pos = end;
  }
  return out + escapeHtml(text.slice(pos));
}

/** Fragment treści wokół pierwszego trafienia (albo początek tekstu) */
function snippet(entry: Indexed, terms: string[], [before, after]: [number, number]) {
  const text = entry.text.normalize('NFC');
  const hits = terms.map((term) => entry.folded.text.indexOf(term)).filter((at) => at !== -1);
  const hit = hits.length ? Math.min(...hits) : 0;
  let start = Math.max(0, hit - before);
  let end = Math.min(text.length, hit + after);
  // Cięcie na granicach słów
  if (start > 0) start = text.indexOf(' ', start) + 1 || start;
  if (end < text.length) end = text.lastIndexOf(' ', end) > start ? text.lastIndexOf(' ', end) : end;
  return (start > 0 ? '…' : '') + highlight(text.slice(start, end), terms) + (end < text.length ? '…' : '');
}

function score(entry: Indexed, terms: string[]) {
  let total = 0;
  for (const term of terms) {
    const { title, authors, tags, text } = entry.folded;
    const points =
      (title.includes(term) ? 10 : 0) + (authors.includes(term) ? 6 : 0) + (tags.includes(term) ? 3 : 0) + (text.includes(term) ? 1 : 0);
    // Każde słowo zapytania musi wystąpić
    if (!points) return 0;
    total += points;
  }
  return total;
}

const plural = (count: number) => {
  if (count === 1) return 'wynik';
  const ones = count % 10;
  const tens = count % 100;
  return ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? 'wyniki' : 'wyników';
};

let index: Promise<Indexed[]> | undefined;
// Indeks pobieramy raz, dopiero przy pierwszym wyszukiwaniu
const loadIndex = () =>
  (index ??= fetch('/search-index.json')
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<Entry[]>;
    })
    .then((entries) =>
      entries.map((entry) => ({
        ...entry,
        folded: { title: fold(entry.title), authors: fold(entry.authors), tags: fold(entry.tags), text: fold(entry.text) },
      })),
    ));

/** Podpina wyszukiwanie w trakcie pisania pod pole tekstowe; zwraca funkcję szukającą od razu. */
export function setupSearch({ input, status, results, limit, snippet: snippetSize, hint = '', onResults }: Options) {
  let latest = 0;

  async function search(query: string) {
    const run = ++latest;
    const terms = fold(query).split(/\s+/).filter((term) => term.length > 1);
    if (!terms.length) {
      status.textContent = query.trim() ? 'Wpisz co najmniej dwa znaki.' : hint;
      results.innerHTML = '';
      onResults?.('', 0);
      return;
    }
    let entries: Indexed[];
    try {
      entries = await loadIndex();
    } catch {
      index = undefined;
      status.textContent = 'Nie udało się wczytać indeksu wyszukiwarki. Spróbuj ponownie.';
      return;
    }
    if (run !== latest) return;

    const found = entries
      .map((entry, order) => ({ entry, order, points: score(entry, terms) }))
      .filter((item) => item.points > 0)
      // Przy remisie kolejność indeksu: od najnowszych
      .sort((a, b) => b.points - a.points || a.order - b.order);

    status.textContent = found.length
      ? `${found.length} ${plural(found.length)}` + (found.length > limit ? ` – pierwsze ${limit}` : '')
      : `Brak wyników dla „${query.trim()}”.`;
    results.innerHTML = found
      .slice(0, limit)
      .map(({ entry }) => {
        const meta = [entry.authors, entry.tags].filter(Boolean).map((part) => highlight(part, terms)).join(' · ');
        return `<a class="search-result" href="${escapeHtml(entry.url)}">
          <span class="search-result__title">${highlight(entry.title, terms)}</span>
          ${meta ? `<span class="search-result__meta">${meta}</span>` : ''}
          ${entry.text ? `<span class="search-result__snippet">${snippet(entry, terms, snippetSize)}</span>` : ''}
        </a>`;
      })
      .join('');
    results.scrollTop = 0;
    onResults?.(query.trim(), found.length);
  }

  let timer: number | undefined;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => search(input.value), 120);
  });

  return (query: string) => {
    clearTimeout(timer);
    return search(query);
  };
}
