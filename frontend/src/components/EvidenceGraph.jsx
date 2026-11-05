import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NODE_H, NODE_W, buildGraph, edgeMidpoint, edgePath, pathToSeed } from '../utils/graphLayout.js';
import { SOURCE_META, compactSummary, offsetFromStart, score, wrapText } from '../utils/format.js';

const MIN_ZOOM = 0.45; // the whole graph always fits; users can zoom in for detail
const SUMMARY_CHARS = 26;

function GraphLegend({ showRejected, showSupporting }) {
  return (
    <div className="graph-legend">
      <div className="legend">
        {['redteam', 'auth', 'proc', 'dns', 'flow'].map((s) => (
          <span key={s}><i style={{ background: SOURCE_META[s].color }} />{s === 'redteam' ? 'Start' : SOURCE_META[s].name}</span>
        ))}
      </div>
      <div className="legend">
        <span><span className="line" />Link (earlier → later)</span>
        {showSupporting && <span><span className="line dashed" />Supporting</span>}
        {showRejected && <span><span className="line dashed" style={{ borderColor: 'var(--danger)' }} />Weak (left out)</span>}
        <span className="subtle">A link means “probably related”, not “caused by”.</span>
      </div>
      <div className="legend" data-testid="strength-legend">
        <span className="subtle">
          Numbers are <b>relationship strength</b> (0–1): how well the clues fit together. They are not probabilities.
          Click a node or a link to highlight its path and see why it was included.
        </span>
      </div>
    </div>
  );
}

export default function EvidenceGraph({ timeline, relationships, showRejected, showSupporting, selection, pathIds, centerOn, fitRequest, onSelectEvent, onSelectRelationship }) {
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const graph = useMemo(
    () => buildGraph(timeline, relationships, { showRejected, availableWidth: size.w }),
    [timeline, relationships, showRejected, size.w],
  );
  const seedTs = useMemo(() => timeline.find((t) => t.is_seed)?.ts ?? 0, [timeline]);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!size.w) return;
    // Fit the whole graph inside the panel (never enlarge beyond 100%).
    const k = Math.max(MIN_ZOOM, Math.min(size.w / graph.width, (size.h - 70) / graph.height, 1));
    setView({ k, x: graph.width * k <= size.w ? (size.w - graph.width * k) / 2 : 0, y: 0 });
  }, [size, graph.width, graph.height]);
  useEffect(fit, [fit, fitRequest]);

  // Selecting an event elsewhere (timeline, details) brings its node into view if it is off-screen.
  useEffect(() => {
    if (!centerOn || !size.w) return;
    const n = graph.nodes.find((x) => x.id === centerOn.id);
    if (!n) return;
    setView((v) => {
      const left = n.x * v.k + v.x;
      const top = n.y * v.k + v.y;
      const visible = left >= 0 && top >= 0 && left + NODE_W * v.k <= size.w && top + NODE_H * v.k <= size.h - 60;
      if (visible) return v;
      return { ...v, x: size.w / 2 - (n.x + NODE_W / 2) * v.k, y: (size.h - 60) / 2 - (n.y + NODE_H / 2) * v.k };
    });
  }, [centerOn, graph.nodes, size]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const k = Math.min(2.5, Math.max(0.3, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e) => {
    if (e.target.closest('.g-node, .g-edge-hit')) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    setDragging(true);
    setHover(null);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const d = drag.current;
    setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };
  const onPointerUp = () => {
    drag.current = null;
    setDragging(false);
  };

  const selectedRel = selection?.kind === 'relationship' ? selection.id : null;
  const focus = useMemo(() => (hover != null ? pathToSeed(hover, timeline) : null), [hover, timeline]);
  // The selected event's or link's connected path stays highlighted; hovering temporarily previews another path.
  const selectedPath = focus ? null : pathIds;
  const selectedEdge = selectedRel != null ? graph.edges.find((e) => e.id === selectedRel) : null;
  const hoverNode = hover != null ? graph.nodes.find((n) => n.id === hover) : null;

  return (
    <div className="graph-wrap" ref={wrapRef}>
      <svg
        className={`graph-svg ${dragging ? 'dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        data-testid="evidence-graph"
        role="img"
        aria-label="Evidence graph. Columns show links from the starting event; arrows run from the earlier to the later event."
      >
        <defs>
          <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="#8792a5" />
          </marker>
          <marker id="arrow-sel" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="#d3aa62" />
          </marker>
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {graph.columnLabels.map((c) => (
            <text key={c.label} className="g-col-label" x={c.x + 2} y={24}>{c.label}</text>
          ))}
          {graph.edges.map((e) => {
            const d = edgePath(e.from, e.to);
            const onPath = focus && focus.has(e.s.id) && focus.has(e.t.id) && e.is_primary;
            const isSel = selectedRel === e.id;
            const onSelectedPath = selectedPath && selectedPath.has(e.s.id) && selectedPath.has(e.t.id) && (e.is_primary || isSel);
            const dim = focus ? !onPath && !isSel : selectedPath ? !onSelectedPath : false;
            const stroke = isSel ? 'var(--amber)' : e.rejected ? 'var(--danger)' : e.is_primary ? 'var(--accent)' : '#6f7a8e';
            return (
              <g key={e.id}>
                <path
                  className={`g-edge ${dim ? (focus ? 'dim' : 'faded') : ''}`}
                  d={d}
                  stroke={stroke}
                  strokeWidth={isSel ? 3 : onSelectedPath ? 2.6 : 1.2 + 1.6 * (e.final_score ?? 0.3)}
                  strokeOpacity={onSelectedPath ? 1 : e.rejected ? 0.55 : e.is_primary ? 0.35 + 0.45 * e.final_score : 0.6}
                  strokeDasharray={e.is_primary ? undefined : '5 4'}
                  markerEnd={isSel ? 'url(#arrow-sel)' : 'url(#arrow)'}
                />
                {!e.rejected && (
                  <path className="g-edge-hit" d={d} onClick={() => onSelectRelationship(e.id)} data-testid="graph-edge">
                    <title>{`Relationship strength ${score(e.final_score, 2)} (not a probability) · ${e.matched_rule_name ?? 'no rule matched'} · click to see why`}</title>
                  </path>
                )}
              </g>
            );
          })}
          {graph.nodes.map((n) => {
            const meta = SOURCE_META[n.source_type];
            const selected = selection?.kind === 'event' && selection.id === n.id;
            const dim = focus && !focus.has(n.id);
            const faded = !focus && selectedPath && !selectedPath.has(n.id);
            const onPath = !focus && selectedPath?.has(n.id);
            const [summary] = wrapText(compactSummary(n), SUMMARY_CHARS, 1);
            return (
              <g
                key={n.id}
                className={`g-node ${selected ? 'selected' : ''} ${dim ? 'dim' : ''} ${faded ? 'faded' : ''} ${onPath && !selected ? 'on-path' : ''} ${n.status === 'rejected' ? 'rejected' : ''}`}
                transform={`translate(${n.x},${n.y})`}
                onClick={() => onSelectEvent(n.id)}
                onMouseEnter={() => !dragging && setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                data-testid="graph-node"
                data-event-id={n.id}
              >
                <rect className="body" width={NODE_W} height={NODE_H} rx="6" />
                <rect x="0" y="7" width="3" height={NODE_H - 14} fill={meta.color} rx="1.5" />
                <text x="14" y="21" fontSize="13" fontWeight="600" fill="var(--text)" fontFamily="var(--font-sans)">
                  {n.is_seed ? 'Starting event' : n.event_label}
                </text>
                <text x={NODE_W - 12} y="21" fontSize="12" textAnchor="end" fontFamily="var(--font-mono)"
                  fill={n.status === 'rejected' ? 'var(--danger)' : 'var(--accent)'}>
                  {n.is_seed ? '' : score(n.score, 2)}
                </text>
                <text x="14" y="39" fontSize="11" fontFamily="var(--font-mono)" fill="var(--text-2)" className="g-summary">{summary}</text>
                <text x="14" y="56" fontSize="11" fontFamily="var(--font-sans)"
                  fill={!n.is_seed && n.ts < seedTs ? 'var(--amber)' : 'var(--text-3)'}>
                  {n.is_seed ? 'Red-team record' : offsetFromStart(n.seconds_from_seed)}
                </text>
              </g>
            );
          })}
          {selectedEdge && (() => {
            const m = edgeMidpoint(selectedEdge.from, selectedEdge.to);
            return (
              <g className="g-edge-label" transform={`translate(${m.x},${m.y})`} data-testid="edge-strength-label">
                <rect x="-62" y="-11" width="124" height="22" rx="4" />
                <text textAnchor="middle" y="4">strength {score(selectedEdge.final_score, 2)}</text>
              </g>
            );
          })()}
        </g>
      </svg>

      {hoverNode && !dragging && (
        <div
          className="graph-tooltip"
          role="tooltip"
          style={{
            left: Math.min(Math.max(8, hoverNode.x * view.k + view.x), Math.max(8, size.w - 308)),
            top: (hoverNode.y + NODE_H) * view.k + view.y + 8,
          }}
        >
          <strong>{hoverNode.is_seed ? 'Starting event' : hoverNode.event_label}</strong>
          <span className="mono">{hoverNode.summary}</span>
          <span className="subtle">
            {hoverNode.is_seed ? 'Red-team record' : `${offsetFromStart(hoverNode.seconds_from_seed)} · relationship strength ${score(hoverNode.score, 3)}`}
          </span>
        </div>
      )}

      <GraphLegend showRejected={showRejected} showSupporting={showSupporting} />
    </div>
  );
}
