import assert from 'node:assert/strict';
import test from 'node:test';
import { probeScale, probeTransform, probesSvg } from '../src/probes.ts';

test('red enters from the left and black is mirrored from the right, above or below the pin', () => {
  assert.equal(probeTransform({ x: 10, y: 20, fromAbove: false }, 'red', 0.5), 'translate(10.0 20.0) rotate(-52) scale(0.5)');
  assert.equal(probeTransform({ x: 10, y: 20, fromAbove: true }, 'red', 0.5), 'translate(10.0 20.0) rotate(52) scale(0.5)');
  assert.equal(probeTransform({ x: 1, y: 2, fromAbove: false }, 'black', 0.5), 'translate(1.0 2.0) scale(-1 1) rotate(-56) scale(0.5)');
});

test('probes stay readable at any zoom and only appear for ends that exist', () => {
  assert.equal(probeScale(1), 0.52);
  assert.ok(probeScale(0.1) > 0.25 && probeScale(9) < 0.61);
  const svg = probesSvg({ x: 5, y: 5, fromAbove: false }, null, [{ x: 1, y: 1, n: 2 }], 1);
  assert.match(svg, /#probe-red/);
  assert.doesNotMatch(svg, /#probe-black/);
  assert.match(svg, />2</);
  assert.equal(probesSvg(null, null, [], 1), '');
});


test('probe artwork clears labels while keeping endpoint rings outside the mask', () => {
  const svg = probesSvg({x: 40, y: 60, fromAbove: true}, null, [], 1,
    [{x1: 10, y1: 20, w: 30, h: 12}, {x1: NaN, y1: 0, w: 1, h: 1}]);
  assert.match(svg, /x="7.0" y="17.0" width="36.0" height="18.0" fill="black"/);
  assert.match(svg, /<g mask="url\(#probe-label-mask\)"><use[^>]+\/><\/g><circle/);
  assert.doesNotMatch(svg, /NaN/);
});
