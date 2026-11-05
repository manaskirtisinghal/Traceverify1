import { describe, expect, it } from 'vitest';
import { lanlClock, normalizeWeights, signedDelta, weightsSum } from './format.js';
import { buildGraph, connectedPath, pathToSeed } from './graphLayout.js';

describe('format', () => {
  it('formats LANL relative time', () => {
    expect(lanlClock(150885)).toBe('D2 17:54:45');
    expect(lanlClock(0)).toBe('D1 00:00:00');
  });
  it('formats signed deltas', () => {
    expect(signedDelta(13)).toBe('+13s');
    expect(signedDelta(-8)).toBe('−8s');
    expect(signedDelta(124)).toBe('+2m04s');
  });
  it('normalizes weights to sum to 1', () => {
    const w = normalizeWeights({ entity: 2, temporal: 1, rule: 1 });
    expect(weightsSum(w)).toBe(1);
    expect(w.entity).toBe(0.5);
  });
});

const timeline = [
  { id: 1, ts: 100, hop: 0, status: 'seed', parent_event_id: null },
  { id: 2, ts: 105, hop: 1, status: 'accepted', parent_event_id: 1, score: 0.9 },
  { id: 3, ts: 110, hop: 2, status: 'accepted', parent_event_id: 2, score: 0.8 },
  { id: 4, ts: 300, hop: 1, status: 'rejected', parent_event_id: 1, score: 0.3 },
];
const rels = [
  { id: 10, source_event_id: 1, target_event_id: 2, final_score: 0.9, is_primary: true },
  { id: 11, source_event_id: 2, target_event_id: 3, final_score: 0.8, is_primary: true },
];

describe('graph layout', () => {
  it('places nodes in hop columns and hides rejected by default', () => {
    const g = buildGraph(timeline, rels);
    expect(g.nodes.map((n) => n.col)).toEqual([0, 1, 2]);
    expect(g.edges).toHaveLength(2);
  });
  it('adds a below-threshold column when rejected candidates are shown', () => {
    const g = buildGraph(timeline, rels, { showRejected: true });
    expect(g.nodes.find((n) => n.id === 4).col).toBe(3);
    expect(g.edges.some((e) => e.rejected)).toBe(true);
  });
  it('walks primary parents back to the seed', () => {
    expect([...pathToSeed(3, timeline)].sort()).toEqual([1, 2, 3]);
  });
  it('highlights the connected path of a selected event or link', () => {
    const sorted = (set) => [...set].sort();
    expect(sorted(connectedPath({ kind: 'event', id: 2 }, timeline, rels))).toEqual([1, 2, 3]);
    expect(sorted(connectedPath({ kind: 'event', id: 3 }, timeline, rels))).toEqual([1, 2, 3]);
    expect(sorted(connectedPath({ kind: 'event', id: 1 }, timeline, rels))).toEqual([1, 2]);
    expect(sorted(connectedPath({ kind: 'event', id: 4 }, timeline, rels))).toEqual([1, 4]);
    expect(sorted(connectedPath({ kind: 'relationship', id: 11 }, timeline, rels))).toEqual([1, 2, 3]);
    expect(connectedPath(null, timeline, rels)).toBeNull();
  });
});

import { compactSummary, offsetFromStart, wrapText } from './format.js';

describe('chronological graph semantics', () => {
  const tl = [
    { id: 1, ts: 100, hop: 0, status: 'seed', is_seed: true, parent_event_id: null },
    { id: 5, ts: 92, hop: 1, status: 'accepted', parent_event_id: 1, score: 0.95 },
    { id: 2, ts: 105, hop: 1, status: 'accepted', parent_event_id: 1, score: 0.9 },
  ];
  const r = [
    { id: 20, source_event_id: 1, target_event_id: 5, final_score: 0.95, is_primary: true },
    { id: 21, source_event_id: 1, target_event_id: 2, final_score: 0.9, is_primary: true },
  ];
  it('places events before the start in the start column, above the seed', () => {
    const g = buildGraph(tl, r);
    const pre = g.nodes.find((n) => n.id === 5);
    const seed = g.nodes.find((n) => n.id === 1);
    expect(pre.col).toBe(0);
    expect(pre.y).toBeLessThan(seed.y);
  });
  it('draws every edge from the earlier to the later event', () => {
    const g = buildGraph(tl, r);
    for (const e of g.edges) expect(e.from.ts).toBeLessThanOrEqual(e.to.ts);
    expect(g.edges.find((e) => e.id === 20).from.id).toBe(5);
  });
  it('stretches column spacing to the available width', () => {
    expect(buildGraph(tl, r, { availableWidth: 1000 }).width).toBeGreaterThan(buildGraph(tl, r).width);
  });
});

describe('text helpers', () => {
  it('builds compact summaries without losing key fields', () => {
    expect(compactSummary({ source_type: 'proc', src_computer: 'C1003', attributes: { processName: 'powershell.exe' } }))
      .toBe('powershell.exe on C1003');
    expect(compactSummary({ source_type: 'flow', src_computer: 'C1', dst_computer: 'C2', attributes: { dstPort: '443' } }))
      .toBe('C1 → C2:443');
  });
  it('wraps text by words', () => {
    expect(wrapText('aaa bbb ccc', 7, 2)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapText('aaa bbb ccc ddd', 7, 1)).toEqual(['aaa bb…']); // stays within 7 characters including the ellipsis
  });
  it('describes time relative to the start', () => {
    expect(offsetFromStart(-8)).toBe('8 s before start');
    expect(offsetFromStart(124)).toBe('+2 min 04 s');
  });
});
