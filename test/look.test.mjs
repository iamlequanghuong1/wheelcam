// The look parameters: accent colour, small-print size and the vertical layout.
// Whatever arrives in a URL is either a clean value or the default.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOptions, sceneQuery, clampType, DEFAULTS, SCENE_CARDS } from '../src/logic/options.ts';
import {
  ACCENT_PRESETS,
  accentTokens,
  contrast,
  ensureContrast,
  INK,
  PAPER,
  parseAccent,
  readableOn,
  SIGNAL_YELLOW,
} from '../src/logic/colour.ts';

const HEX6 = /^#[0-9a-f]{6}$/;

test('accent: hex in any common spelling, everything else ignored', () => {
  assert.equal(parseAccent('5aa9e6'), '#5aa9e6');
  assert.equal(parseAccent('#5AA9E6'), '#5aa9e6');
  assert.equal(parseAccent(' fc0 '), '#ffcc00');
  assert.equal(parseAccent('f4c20d'), null, 'the stock yellow is no accent at all');
  assert.equal(parseAccent('F4C20D'), null);
  for (const junk of ['', 'red', '12345', '#12345g', '1234567', '5aa9e6;background:url(x)', 'url(javascript:1)', '#5aa9e6 !important', null, undefined, 42, {}]) {
    assert.equal(parseAccent(junk), null, `rejects ${String(junk)}`);
  }
});

test('options: accent, type and layout from the URL', () => {
  const o = readOptions('?scene=program&layout=vertical&accent=5AA9E6&type=118');
  assert.equal(o.accent, '#5aa9e6');
  assert.equal(o.type, 120, 'snapped to steps of 5');
  assert.equal(o.layout, 'vertical');
  assert.equal(readOptions('?accent=%23ff6fa8').accent, '#ff6fa8', 'an encoded # is fine');
  const bare = new URL('https://example.test/?scene=bug&accent=#ff6fa8');
  assert.equal(readOptions(bare.search).accent, null, 'a bare # starts the fragment, so nothing arrives');
  assert.equal(readOptions('?layout=portrait').layout, 'vertical');
  assert.equal(readOptions('?layout=sideways').layout, 'landscape');

  const plain = readOptions('?scene=bug');
  assert.equal(plain.accent, null);
  assert.equal(plain.type, 100);
  assert.equal(plain.layout, 'landscape');
});

test('options: type size stays in range, junk keeps the default', () => {
  assert.equal(readOptions('?type=9000').type, 130);
  assert.equal(readOptions('?type=10').type, 90);
  assert.equal(readOptions('?type=0').type, 90);
  for (const junk of ['', 'big', '1.2', '-115', '115%', '1e3', 'Infinity']) {
    assert.equal(readOptions(`?type=${encodeURIComponent(junk)}`).type, 100, `type=${junk}`);
  }
  assert.equal(clampType(Number.NaN), 100);
  assert.equal(clampType(112), 110);
  assert.equal(clampType(113), 115);
});

test('links: look settings only when they differ, layout only on the program', () => {
  const look = { ...DEFAULTS, accent: '#5aa9e6', type: 115 };
  assert.equal(sceneQuery('gauge', look), '?scene=gauge&accent=5aa9e6&type=115');
  assert.equal(sceneQuery('gauge', { ...DEFAULTS, accent: SIGNAL_YELLOW, type: 100 }), '?scene=gauge');
  assert.equal(
    sceneQuery('program', { ...look, layout: 'vertical', corner: 'tl' }),
    '?scene=program&layout=vertical&accent=5aa9e6&type=115&corner=tl',
  );
  assert.equal(sceneQuery('bug', { ...DEFAULTS, layout: 'vertical' }), '?scene=bug', 'only the program has a vertical version');
  assert.equal(sceneQuery('run', { ...DEFAULTS, accent: 'red;}', type: 7 }), '?scene=run&type=90', 'a bad accent never reaches a link');

  // What the studio writes, an overlay reads back.
  const back = readOptions(sceneQuery('program', { ...look, layout: 'vertical' }));
  assert.equal(back.accent, '#5aa9e6');
  assert.equal(back.type, 115);
  assert.equal(back.layout, 'vertical');
});

test('cards: the vertical program has its own key and a 9:16 source', () => {
  const keys = SCENE_CARDS.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length);
  const tall = SCENE_CARDS.find((c) => c.key === 'program-vertical');
  assert.ok(tall);
  assert.equal(tall.id, 'program');
  assert.equal(tall.layout, 'vertical');
  assert.deepEqual([tall.width, tall.height], [1080, 1920]);
});

test('colour: contrast maths matches WCAG', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(contrast('#5aa9e6', '#5aa9e6'), 1);
  assert.ok(contrast(SIGNAL_YELLOW, INK) > 11);
  assert.equal(readableOn(SIGNAL_YELLOW), INK);
  assert.equal(readableOn('#1b2a6b'), PAPER);
  assert.equal(ensureContrast(SIGNAL_YELLOW, INK, 3), SIGNAL_YELLOW, 'a colour that already shows is left alone');
  const lifted = ensureContrast('#1b2a6b', INK, 3);
  assert.notEqual(lifted, '#1b2a6b');
  assert.ok(contrast(lifted, INK) >= 3);
});

test('colour: the stock yellow reproduces the stock themes exactly', () => {
  assert.deepEqual(accentTokens(null, 'dark'), {});
  assert.deepEqual(accentTokens(SIGNAL_YELLOW, 'dark'), {
    '--accent': SIGNAL_YELLOW,
    '--on-accent': INK,
    '--tab': SIGNAL_YELLOW,
    '--on-tab': INK,
    '--fill': SIGNAL_YELLOW,
  });
  assert.deepEqual(accentTokens(SIGNAL_YELLOW, 'light'), { '--accent': SIGNAL_YELLOW, '--on-accent': INK, '--on-tab': SIGNAL_YELLOW });
  assert.deepEqual(accentTokens('not a colour', 'dark'), {}, 'unvalidated input sets nothing');
});

test('colour: any accent stays readable in both themes', () => {
  const steps = [0, 0x33, 0x66, 0x99, 0xcc, 0xff];
  for (const r of steps) {
    for (const g of steps) {
      for (const b of steps) {
        const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
        const dark = accentTokens(hex, 'dark');
        for (const value of Object.values(dark)) assert.match(value, HEX6);
        assert.ok(contrast(dark['--fill'], INK) >= 3, `${hex}: bars show on black plates`);
        assert.ok(contrast(dark['--on-tab'], dark['--tab']) >= 3.9, `${hex}: tab lettering reads`);
        const light = accentTokens(hex, 'light');
        for (const value of Object.values(light)) assert.match(value, HEX6);
        assert.ok(contrast(light['--on-tab'], INK) >= 4.5, `${hex}: lettering reads on black tabs`);
        assert.equal(light['--tab'], undefined, 'light plates keep their black tabs');
      }
    }
  }
});

test('colour: every studio preset is a clean value', () => {
  for (const preset of ACCENT_PRESETS) {
    assert.match(preset.hex, HEX6);
    const parsed = parseAccent(preset.hex);
    assert.ok(parsed === null ? preset.hex === SIGNAL_YELLOW : parsed === preset.hex, preset.name);
  }
});
