// Google Analytics 4: wybór strumienia wg domeny i domena ciasteczek _ga.
// Czysty JavaScript bez zależności – używany przez skrypt banera (CookieConsent.astro)
// i testowany przez `npm test` (tests/analytics.test.js).

/**
 * Host → nazwa zmiennej z identyfikatorem pomiaru. Każda domena ma własny strumień GA4;
 * strona nie przekierowuje między domenami. Inny host (pages.dev, podglądy, localhost) → brak GA.
 * pozalinią.pl przeglądarka zwraca w location.hostname jako punycode.
 */
export const GA_STREAM_BY_HOST = Object.freeze({
  'pozalinia.pl': 'POZALINIA',
  'www.pozalinia.pl': 'POZALINIA',
  'xn--pozalini-p8a.pl': 'POZALINIA_IDN',
  'www.xn--pozalini-p8a.pl': 'POZALINIA_IDN',
});

const MEASUREMENT_ID = /^G-[A-Z0-9]+$/;

/** Nazwa hosta w postaci z location.hostname: małe litery, punycode, bez kropki na końcu. */
export function normalizeHost(hostname) {
  const host = String(hostname ?? '').trim().replace(/\.$/, '');
  if (!host) return '';
  try {
    return new URL(`https://${host}/`).hostname;
  } catch {
    return host.toLowerCase();
  }
}

/**
 * Identyfikator pomiaru GA4 dla hosta albo null (host spoza mapy, brak lub błędna zmienna).
 * @param {string} hostname np. location.hostname
 * @param {{ POZALINIA?: string, POZALINIA_IDN?: string }} ids wartości zmiennych środowiskowych
 */
export function gaIdForHost(hostname, ids) {
  const stream = GA_STREAM_BY_HOST[normalizeHost(hostname)];
  const id = stream ? String(ids?.[stream] ?? '').trim() : '';
  return MEASUREMENT_ID.test(id) ? id : null;
}

/**
 * Domena nadrzędna z kropką, na której GA (cookie_domain: 'auto') zapisuje _ga:
 * www.pozalinia.pl i pozalinia.pl → .pozalinia.pl. Obie domeny serwisu mają dwa człony
 * (nazwa + .pl), więc wystarczą dwa ostatnie. Dla localhost i adresów IP → null.
 */
export function cookieBaseDomain(hostname) {
  const host = normalizeHost(hostname);
  if (!host || host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return null;
  const labels = host.split('.');
  if (labels.length < 2) return null;
  return `.${labels.slice(-2).join('.')}`;
}
