import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieBaseDomain, gaIdForHost } from '../src/lib/analytics.js';

const ids = { POZALINIA: 'G-AAAAAAAAAA', POZALINIA_IDN: 'G-BBBBBBBBBB' };

test('pozalinia.pl → strumień POZALINIA', () => {
  assert.equal(gaIdForHost('pozalinia.pl', ids), ids.POZALINIA);
  assert.equal(gaIdForHost('www.pozalinia.pl', ids), ids.POZALINIA);
});

test('pozalinią.pl → strumień POZALINIA_IDN', () => {
  assert.equal(gaIdForHost('xn--pozalini-p8a.pl', ids), ids.POZALINIA_IDN);
  assert.equal(gaIdForHost('www.xn--pozalini-p8a.pl', ids), ids.POZALINIA_IDN);
  assert.equal(gaIdForHost('pozalinią.pl', ids), ids.POZALINIA_IDN);
});

test('inne hosty → brak GA', () => {
  for (const host of ['strona-astro.pages.dev', 'abc123.strona-astro.pages.dev', 'localhost', '127.0.0.1', '', 'pozalinia.pl.evil.com', 'xn--pozalini-l8a.pl']) {
    assert.equal(gaIdForHost(host, ids), null, host);
  }
});

test('brak lub błędna zmienna → brak GA tylko na tej domenie', () => {
  const onlyMain = { POZALINIA: 'G-AAAAAAAAAA' };
  assert.equal(gaIdForHost('pozalinia.pl', onlyMain), 'G-AAAAAAAAAA');
  assert.equal(gaIdForHost('xn--pozalini-p8a.pl', onlyMain), null);
  assert.equal(gaIdForHost('pozalinia.pl', { POZALINIA: '' }), null);
  assert.equal(gaIdForHost('pozalinia.pl', { POZALINIA: 'UA-123-1' }), null);
  assert.equal(gaIdForHost('pozalinia.pl', undefined), null);
});

test('domena nadrzędna ciasteczek', () => {
  assert.equal(cookieBaseDomain('pozalinia.pl'), '.pozalinia.pl');
  assert.equal(cookieBaseDomain('www.pozalinia.pl'), '.pozalinia.pl');
  assert.equal(cookieBaseDomain('xn--pozalini-p8a.pl'), '.xn--pozalini-p8a.pl');
  assert.equal(cookieBaseDomain('www.xn--pozalini-p8a.pl'), '.xn--pozalini-p8a.pl');
  assert.equal(cookieBaseDomain('abc123.strona-astro.pages.dev'), '.pages.dev');
  assert.equal(cookieBaseDomain('localhost'), null);
  assert.equal(cookieBaseDomain('127.0.0.1'), null);
});
