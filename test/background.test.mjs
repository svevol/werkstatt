import test from 'node:test';
import assert from 'node:assert/strict';

import {
  splitCssList, parseBackgroundLayers, serializeBackgroundLayers,
  backgroundLayerKind, backgroundLayerLabel, reorderBackgroundLayers,
} from '../src/renderer/js/background.js';

test('splitCssList keeps function arguments together', () => {
  assert.deepEqual(
    splitCssList('linear-gradient(135deg, red, blue), url("hero,wide.svg"), image-set(url(icon.svg) 1x, url(icon@2x.svg) 2x)'),
    [
      'linear-gradient(135deg, red, blue)',
      'url("hero,wide.svg")',
      'image-set(url(icon.svg) 1x, url(icon@2x.svg) 2x)',
    ],
  );
});

test('parseBackgroundLayers treats none as an empty layer stack', () => {
  assert.deepEqual(parseBackgroundLayers('none'), []);
  assert.deepEqual(parseBackgroundLayers(''), []);
  assert.deepEqual(parseBackgroundLayers('url(a.svg), linear-gradient(red, blue)'), [
    'url(a.svg)',
    'linear-gradient(red, blue)',
  ]);
});

test('serializeBackgroundLayers trims and removes empty draft values', () => {
  assert.equal(serializeBackgroundLayers([' url(a.svg) ', '', 'linear-gradient(red, blue)']), 'url(a.svg), linear-gradient(red, blue)');
  assert.equal(serializeBackgroundLayers([]), '');
});

test('background layer kinds use understandable editor labels', () => {
  assert.equal(backgroundLayerKind('linear-gradient(red, blue)'), 'gradient');
  assert.equal(backgroundLayerKind('repeating-conic-gradient(red, blue)'), 'gradient');
  assert.equal(backgroundLayerKind('url(hero.svg)'), 'image');
  assert.equal(backgroundLayerKind('image-set(url(hero.svg) 1x)'), 'image');
  assert.equal(backgroundLayerKind('var(--hero-background)'), 'custom');
  assert.equal(backgroundLayerLabel('radial-gradient(red, blue)'), 'Gradient');
  assert.equal(backgroundLayerLabel('url(hero.svg)'), 'Image');
});

test('reorderBackgroundLayers moves layers without changing their values', () => {
  const layers = ['gradient', 'image', 'texture'];
  assert.deepEqual(reorderBackgroundLayers(layers, 1, -1), ['image', 'gradient', 'texture']);
  assert.deepEqual(reorderBackgroundLayers(layers, 1, 1), ['gradient', 'texture', 'image']);
  assert.deepEqual(reorderBackgroundLayers(layers, 0, -1), layers);
  assert.deepEqual(layers, ['gradient', 'image', 'texture']);
});
