import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import worker from '../public/_worker.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete globalThis.HTMLRewriter;
});

/**
 * Atrapa HTMLRewriter (w Node go nie ma). Jak prawdziwy odrzuca nieprawidłowy selektor
 * wyjątkiem i wywołuje handlery na elemencie, który zapamiętuje setInnerContent.
 */
function stubRewriter() {
  const calls = [];
  globalThis.HTMLRewriter = class {
    #handlers = [];
    on(selector, handler) {
      if (!/^\[data-[a-z]+(="[\w-]+")?\]$/.test(selector)) throw new Error(`Malformed selector: ${selector}`);
      this.#handlers.push([selector, handler]);
      return this;
    }
    transform(response) {
      for (const [selector, handler] of this.#handlers) {
        handler.element({ setInnerContent: (content, options) => calls.push({ selector, content, options }) });
      }
      return response;
    }
  };
  return calls;
}

const env = {
  ASSETS: {
    fetch: async () => new Response('<html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
  },
};
const get = (path) => worker.fetch(new Request(`https://pozalinia.pl${path}`), env, {});
const sheet = (text) => {
  globalThis.fetch = async () => new Response(text);
};

const PATRONATY_TSV = [
  'rok\tautor\ttytul\topis\tokladka\twydawnictwo',
  '2026\tA\tT1\tO1\tjavascript:"><img src=x onerror=alert(1)>\tW',
  '2026\tB\tT2\tO2\thttps://drive.google.com/file/d/abc_123/view\t',
  '2026\tC\tT3\tO3\tdata:text/html,"><script>alert(1)</script>\t',
  '2025\tD\tT4\tO4\t/media/files/okladka.png\t',
  '2025\tE\tT5\tO5\t\tX',
  '2025\tF\tT6\tO6\thttps://example.com/a.png\t',
  // Znak nowej linii w komórce (w cudzysłowie) – parser URL go usuwa, więc to nadal javascript:
  '2025\tG\tT7\tO7\t"java\nscript:alert(1)"\t',
  '2025\tH\tT8\tO8\thttp://example.com/a.png\t',
].join('\n');

test('patronaty: okładki z niebezpiecznym schematem są odrzucane', async () => {
  const calls = stubRewriter();
  sheet(PATRONATY_TSV);
  await get('/patronaty/');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options?.html, true);
  const html = calls[0].content;

  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /script:alert/i, 'rozbity znakiem nowej linii javascript: też odpada');
  assert.doesNotMatch(html, /data:text/i);
  assert.doesNotMatch(html, /<img src=x/i, 'ładunek z arkusza nie może stać się znacznikiem');
  assert.doesNotMatch(html, /http:\/\/example\.com/, 'zwykłe http: też odpada');

  // Dozwolone: Drive (przepisany na miniaturę), względny adres i https
  assert.match(html, /href="https:\/\/drive\.google\.com\/thumbnail\?id=abc_123&amp;sz=w1200" data-lightbox/);
  assert.match(html, /href="\/media\/files\/okladka\.png" data-lightbox/);
  assert.match(html, /href="https:\/\/example\.com\/a\.png" data-lightbox/);
  assert.equal(html.match(/data-lightbox/g).length, 3);
  // Wpisy z odrzuconą okładką dalej się wyświetlają, tylko bez zdjęcia
  assert.match(html, /T1/);
  assert.match(html, /T3/);
});

test('o-nas: id spoza [A-Za-z0-9_-] nie trafia do selektora, reszta biogramów działa', async () => {
  const calls = stubRewriter();
  sheet(['aleksandra\tBio A', 'zły"]id\tX', 'a b\tY', 'bartosz\tBio B'].join('\n'));
  const response = await get('/o-nas/');
  assert.equal(response.status, 200);
  assert.deepEqual(
    calls.map((call) => [call.selector, call.content]),
    [
      ['[data-bio="aleksandra"]', 'Bio A'],
      ['[data-bio="bartosz"]', 'Bio B'],
    ],
  );
  // Biogram wchodzi jako tekst, nie HTML
  assert.ok(calls.every((call) => !call.options?.html));
});

test('awaria arkusza nie psuje strony', async () => {
  stubRewriter();
  globalThis.fetch = async () => {
    throw new Error('sieć');
  };
  for (const path of ['/o-nas/', '/patronaty/']) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), '<html></html>', path);
  }
  globalThis.fetch = async () => new Response('błąd', { status: 500 });
  assert.equal((await get('/patronaty/')).status, 200);
});

/** Nagłówki z public/_headers (reguła /*) jako { nazwa-małymi: wartość } */
function headersFile() {
  const lines = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '/*');
  assert.notEqual(start, -1, 'brak reguły /* w _headers');
  const result = {};
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    const at = line.indexOf(':');
    result[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return result;
}

test('Worker i public/_headers mają te same nagłówki bezpieczeństwa', async () => {
  const expected = headersFile();
  assert.ok(Object.keys(expected).length >= 6);
  for (const required of ['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'content-security-policy']) {
    assert.ok(expected[required], required);
  }
  stubRewriter();
  sheet(PATRONATY_TSV);
  for (const path of ['/', '/o-nas/', '/patronaty/', '/admin/']) {
    const response = await get(path);
    for (const [name, value] of Object.entries(expected)) {
      assert.equal(response.headers.get(name), value, `${path}: ${name}`);
    }
  }
});

test('_routes.json: Worker tylko dla stron z arkusza', () => {
  const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8'));
  assert.equal(routes.version, 1);
  assert.deepEqual(routes.include.sort(), ['/o-nas', '/o-nas/', '/patronaty', '/patronaty/']);
});
