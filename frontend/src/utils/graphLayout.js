// Evidence-graph layout.
//
// * Columns = number of links from the starting event (hop). Events that happened *before* the
//   starting event are placed in the start column, above it, so the seed never appears to
//   precede them.
// * Inside a column, nodes are ordered by time (top = earliest).
// * Every edge is drawn from the earlier event to the later event. Arrows therefore show
//   chronological order of correlated evidence — not causation and not search direction.
// * Column spacing stretches to use the available width.

export const NODE_W = 188;
export const NODE_H = 66;
const MIN_GAP = 30;
const MAX_GAP = 150;
const ROW_GAP = 14;
const PAD = 44;
const TOP = 38;

export function buildGraph(timeline, relationships, { showRejected = false, availableWidth = 0 } = {}) {
  const seed = timeline.find((t) => t.is_seed);
  const items = timeline.filter((t) => t.status !== 'rejected' || showRejected);
  const accepted = items.filter((t) => t.status !== 'rejected');
  const rejected = items.filter((t) => t.status === 'rejected');

  const hopColumn = (t) => (t.is_seed || (seed && t.ts < seed.ts) ? 0 : t.hop);
  const used = [...new Set(accepted.map(hopColumn))].sort((a, b) => a - b);
  const groups = used.map((hop) => ({
    hop,
    label: hop === 0 ? 'Start' : hop === 1 ? 'Direct links' : `${hop} links from start`,
    items: accepted.filter((t) => hopColumn(t) === hop),
  }));
  if (rejected.length) groups.push({ hop: null, label: 'Excluded', items: rejected });

  const cols = groups.length;
  const gap = cols > 1 && availableWidth
    ? Math.max(MIN_GAP, Math.min(MAX_GAP, (availableWidth - PAD * 2 - cols * NODE_W) / (cols - 1)))
    : MIN_GAP;

  const nodes = [];
  let height = 0;
  groups.forEach((g, col) => {
    g.items.sort((a, b) => a.ts - b.ts || a.id - b.id);
    g.items.forEach((t, row) => {
      nodes.push({ ...t, x: PAD + col * (NODE_W + gap), y: TOP + row * (NODE_H + ROW_GAP), col });
    });
    height = Math.max(height, TOP + g.items.length * (NODE_H + ROW_GAP) + PAD);
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chronological = (a, b) => (b.ts < a.ts ? [b, a] : [a, b]);

  const edges = [];
  for (const r of relationships) {
    const s = byId.get(r.source_event_id);
    const t = byId.get(r.target_event_id);
    if (!s || !t) continue;
    const [from, to] = chronological(s, t);
    edges.push({ ...r, s, t, from, to });
  }
  for (const t of rejected) {
    const s = byId.get(t.parent_event_id);
    const n = byId.get(t.id);
    if (!s || !n) continue;
    const [from, to] = chronological(s, n);
    edges.push({ id: `rej-${t.id}`, rejected: true, s, t: n, from, to, final_score: t.score });
  }

  const width = PAD * 2 + cols * NODE_W + Math.max(0, cols - 1) * gap;
  const columnLabels = groups.map((g, col) => ({ x: PAD + col * (NODE_W + gap), label: g.label }));
  return { nodes, edges, width, height: Math.max(height, 200), columnLabels };
}

// Path from the earlier node (`from`) to the later node (`to`).
export function edgePath(from, to) {
  const fy = from.y + NODE_H / 2;
  const ty = to.y + NODE_H / 2;
  if (from.col === to.col) {
    // same column (e.g. an event just before the start): bracket on the left side
    const x = from.x;
    const bulge = 26 + Math.min(40, Math.abs(ty - fy) / 6);
    return `M${x},${fy} C${x - bulge},${fy} ${x - bulge},${ty} ${x},${ty}`;
  }
  if (to.col > from.col) {
    const x1 = from.x + NODE_W;
    const x2 = to.x;
    const dx = (x2 - x1) * 0.5;
    return `M${x1},${fy} C${x1 + dx},${fy} ${x2 - dx},${ty} ${x2},${ty}`;
  }
  // later event sits in an earlier column (rare supporting link): right-to-left
  const x1 = from.x;
  const x2 = to.x + NODE_W;
  const dx = (x1 - x2) * 0.5;
  return `M${x1},${fy} C${x1 - dx},${fy} ${x2 + dx},${ty} ${x2},${ty}`;
}

export function pathToSeed(nodeId, timeline) {
  const parent = new Map(timeline.filter((t) => t.status === 'accepted').map((t) => [t.id, t.parent_event_id]));
  const ids = new Set([nodeId]);
  let cur = nodeId;
  let guard = 0;
  while (parent.has(cur) && guard++ < 1000) {
    cur = parent.get(cur);
    ids.add(cur);
  }
  return ids;
}

// Events connected to the current selection: the chain back to the starting event plus everything
// that was reached through the selected event. For a selected link, both of its ends are included.
export function connectedPath(selection, timeline, relationships) {
  if (!selection) return null;
  const byId = new Map(timeline.map((t) => [t.id, t]));
  const children = new Map();
  for (const t of timeline) {
    if (t.status !== 'accepted' || t.parent_event_id == null) continue;
    if (!children.has(t.parent_event_id)) children.set(t.parent_event_id, []);
    children.get(t.parent_event_id).push(t.id);
  }
  const ids = new Set();
  const addUp = (id) => {
    for (const x of pathToSeed(id, timeline)) ids.add(x);
    const t = byId.get(id);
    if (t?.status === 'rejected' && t.parent_event_id != null) addUp(t.parent_event_id);
  };
  const addDown = (id) => {
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      ids.add(cur);
      for (const c of children.get(cur) ?? []) if (!ids.has(c)) stack.push(c);
    }
  };
  if (selection.kind === 'relationship') {
    const r = relationships.find((x) => x.id === selection.id);
    if (!r) return null;
    addUp(r.source_event_id);
    addUp(r.target_event_id);
    addDown(r.target_event_id);
  } else {
    if (!byId.has(selection.id)) return null;
    addUp(selection.id);
    const sel = byId.get(selection.id);
    if (sel.is_seed || sel.status === 'seed') for (const c of children.get(selection.id) ?? []) ids.add(c); // direct links only
    else addDown(selection.id);
  }
  return ids;
}

// Point roughly halfway along an edge, for its strength label.
export function edgeMidpoint(from, to) {
  const fy = from.y + NODE_H / 2;
  const ty = to.y + NODE_H / 2;
  if (from.col === to.col) return { x: from.x - 26 - Math.min(40, Math.abs(ty - fy) / 6) * 0.75, y: (fy + ty) / 2 };
  const x1 = to.col > from.col ? from.x + NODE_W : from.x;
  const x2 = to.col > from.col ? to.x : to.x + NODE_W;
  return { x: (x1 + x2) / 2, y: (fy + ty) / 2 };
}
