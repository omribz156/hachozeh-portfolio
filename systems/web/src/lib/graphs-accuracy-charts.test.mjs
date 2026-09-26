import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arcGauge, accuracyLine, predictionRealityBars, brierBars, splitBar, chartSkeleton, chartEmpty, chartError } from './graphs-accuracy-charts.js';

const attack = '\"><script>alert(1)</script><img src=x onerror=alert(1)>';
test('chart labels are escaped in single and multi-point output', () => {
  const points = [{ value: 85, label: attack, sub: attack }];
  const charts = [accuracyLine(points), accuracyLine([...points, ...points]),
    predictionRealityBars([{ expected: 70, resolved: 75, label: attack }]),
    brierBars([{ value: 0.03, label: attack }])];
  for (const html of charts) {
    assert.ok(!html.includes('<script>') && !html.includes('<img'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('&quot;'));
  }
});
test('numeric fields and dimensions cannot become HTML or CSS', () => {
  const charts = [arcGauge(attack, attack), splitBar({ yes: attack, no: attack }, attack),
    accuracyLine([{ value: attack, label: '', sub: '' }], attack, attack),
    predictionRealityBars([{ expected: attack, resolved: attack, label: '' }], attack, attack),
    brierBars([{ value: attack, label: '' }], attack, attack),
    chartSkeleton(attack), chartEmpty(attack), chartError(attack)];
  for (const html of charts) assert.doesNotMatch(html, /<script>|onerror|NaN|Infinity/);
});
test('normal values and Hebrew labels survive unchanged', () => {
  assert.match(arcGauge(92), /92<tspan/);
  assert.match(splitBar({ yes: 65, no: 35 }), /width:65%/);
  assert.match(accuracyLine([{ value: 85, label: 'יום', sub: 'לפני' }]), /85\.0%/);
  assert.match(accuracyLine([{ value: 85, label: 'יום', sub: 'לפני' }]), /יום/);
  assert.doesNotMatch(accuracyLine([]), /NaN|Infinity/);
});
