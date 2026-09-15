import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC_DIR = path.join(process.cwd(), 'public');

const WIDTHS = { xs: 640, sm: 768, md: 1024, lg: 1366, xl: 1600, '2xl': 1920 } as const;
type Size = keyof typeof WIDTHS;
const ALL_SIZES = Object.keys(WIDTHS) as Size[];
const FEED_SIZES: Size[] = ['xs', 'sm', 'md'];

/** Wartości atrybutu sizes z konfiguracji motywu Publii */
export const IMAGE_SIZES = {
  content: '(max-width: 1920px) 100vw, 1920px',
  hero: '88vw',
  feed: '(min-width: 600px) calc(4.38vw + 143px), 87.86vw',
};

const existsCache = new Map<string, boolean>();

function publicFileExists(url: string) {
  let exists = existsCache.get(url);
  if (exists === undefined) {
    let file = url.split(/[?#]/)[0];
    try {
      file = decodeURIComponent(file);
    } catch {
      // zostawiamy ścieżkę bez dekodowania
    }
    exists = fs.existsSync(path.join(PUBLIC_DIR, file));
    existsCache.set(url, exists);
  }
  return exists;
}

/** Warianty wygenerowane przez Publii: /media/posts/ID/responsive/nazwa-xs.webp */
function responsiveVariants(src: string, sizes: Size[]) {
  const match = src.match(/^(\/media\/(?:posts|tags)\/[^/]+\/)([^/]+)\.[a-z0-9]+$/i);
  if (!match) return [];
  return sizes
    .map((size) => ({ width: WIDTHS[size], url: `${match[1]}responsive/${match[2]}-${size}.webp` }))
    .filter((variant) => publicFileExists(variant.url));
}

export function srcset(src: string, group: 'all' | 'feed' = 'all') {
  const variants = responsiveVariants(src, group === 'feed' ? FEED_SIZES : ALL_SIZES);
  return variants.length ? variants.map((v) => `${v.url} ${v.width}w`).join(', ') : undefined;
}

/** Najmniejszy wariant (Publii: urlXs) albo oryginał */
export function smallestImage(src: string) {
  return responsiveVariants(src, ['xs'])[0]?.url ?? src;
}

function enhanceImage(tag: string) {
  let out = tag;
  if (!/\sloading=/i.test(out)) out = out.replace(/^<img\b/i, '<img loading="lazy"');
  const src = out.match(/\ssrc="([^"]*)"/i)?.[1];
  if (src && !/\ssrcset=/i.test(out)) {
    const set = srcset(src);
    if (set) out = out.replace(/\s*\/?>$/, ` sizes="${IMAGE_SIZES.content}" srcset="${set}">`);
  }
  return out;
}

/**
 * Przekształcenia, które Publii wykonuje przy renderowaniu treści:
 * obrazki z klasą post__image trafiają do <figure>, osadzenia do div.post__iframe,
 * a obrazki dostają lazy-loading i srcset z wariantów responsywnych.
 */
export function enhanceContent(html: string) {
  // \s w JS obejmuje też twardą spację (U+00A0) – nie dopisuj jej jako osobnej alternatywy,
  // bo przy wierszach wciętych spacjami regex wpada w wykładniczy backtracking i build się zawiesza
  let out = html.replace(
    /<p>(?:\s|&nbsp;)*(<img\b[^>]*\sclass="post__image[^"]*"[^>]*>)(?:\s|&nbsp;)*<\/p>/gi,
    '$1',
  );
  out = out.replace(
    /<img\b[^>]*\sclass="(post__image[^"]*)"[^>]*>/gi,
    (tag, classes: string) => `<figure class="${classes}">${tag.replace(/\sclass="[^"]*"/i, '')}</figure>`,
  );
  out = out.replace(/<p>\s*(<iframe\b[\s\S]*?<\/iframe>)\s*<\/p>/gi, '$1');
  out = out.replace(/(<div class="post__iframe">\s*)?(<iframe\b[\s\S]*?<\/iframe>)/gi, (match, wrapped, iframe: string) => {
    if (wrapped) return match;
    const lazy = /\sloading=/i.test(iframe) ? iframe : iframe.replace(/^<iframe\b/i, '<iframe loading="lazy"');
    return `<div class="post__iframe">${lazy}</div>`;
  });
  return out.replace(/<img\b[^>]*>/gi, enhanceImage);
}

/**
 * Słowa treści liczone jak w Publii: znaczniki inline znikają bez spacji, blokowe dają spację,
 * ciągi białych znaków zwijają się do jednej spacji, a pojedyncza twarda spacja skleja sąsiednie słowa.
 */
function textWords(html: string) {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Nagłówki z samym tekstem Publii pomija w zajawkach (z <strong> w środku – nie)
    .replace(/<h([1-6])\b[^>]*>[^<]*<\/h\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|figure|figcaption|section|aside|tr|summary)>|<br\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[\r\n]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function truncateWords(words: string[], limit: number, ellipsis: string) {
  const text = words.slice(0, limit).join(' ');
  // Publii nie dokleja wielokropka, gdy ucięty tekst kończy się kropką (lub ?/!)
  return words.length > limit && !/[.!?]$/.test(text) ? text + ellipsis : text;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", hellip: '…', ndash: '–', mdash: '—',
  bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', laquo: '«', raquo: '»',
};

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith('#')) {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Zajawka na listach: 45 słów + wielokropek (HTML). */
export function excerpt(html: string, limit = 45) {
  return truncateWords(textWords(html), limit, '&hellip;');
}

/** Meta description generowany z treści, jak w Publii. */
export function metaDescription(html: string, limit = 45) {
  const words = textWords(html);
  return words.length ? decodeEntities(truncateWords(words, limit, '…')) : undefined;
}

const versions = new Map<string, string>();

/** Adres zasobu z public/ z sumą kontrolną (odświeżanie cache po zmianie pliku). */
export function asset(url: string) {
  let version = versions.get(url);
  if (version === undefined) {
    try {
      version = crypto.createHash('md5').update(fs.readFileSync(path.join(PUBLIC_DIR, url))).digest('hex').slice(0, 12);
    } catch {
      version = '';
    }
    versions.set(url, version);
  }
  return version ? `${url}?v=${version}` : url;
}
