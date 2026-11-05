import { useEffect, useRef } from 'react';
import { SourceBadge } from './common.jsx';
import { clockOnly, score, signedDelta } from '../utils/format.js';
import { strengthWord } from '../utils/plainEnglish.js';

function linkLabel(t) {
  if (t.is_seed) return <span className="pill danger">Start</span>;
  if (t.status === 'rejected') return <span className="pill">Left out</span>;
  return t.hop === 1 ? <span className="pill accent">Direct</span> : <span className="pill violet">{t.hop} steps away</span>;
}

export default function Timeline({ items, selectedId, pathIds, onSelect, threshold = 0.6 }) {
  const scrollRef = useRef(null);

  // Keep the selected row visible inside the timeline's own scroll area.
  useEffect(() => {
    const box = scrollRef.current;
    const row = box?.querySelector('.tl-row.selected');
    if (!box || !row) return;
    const head = box.querySelector('.tl-head')?.offsetHeight ?? 0;
    const top = row.offsetTop - head;
    if (top < box.scrollTop || row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = Math.max(0, top - box.clientHeight / 3);
    }
  }, [selectedId, items]);

  return (
    <div className="timeline-scroll" ref={scrollRef}>
      <div className="tl-head" aria-hidden="true">
        <span>Time</span>
        <span>Type</span>
        <span>What happened</span>
        <span>Distance</span>
        <span className="tl-head-score" title="Relationship strength (0–1): how well the clues fit together. Not a probability.">Strength</span>
      </div>
      <ol className="timeline" data-testid="timeline">
        {items.map((t) => {
          const selected = t.id === selectedId;
          const onPath = !selected && pathIds?.has(t.id);
          return (
            <li
              key={t.id}
              className={`tl-row ${t.status === 'rejected' ? 'rejected' : ''} ${t.is_seed ? 'seed-row' : ''} ${selected ? 'selected' : ''} ${onPath ? 'on-path' : ''}`}
              onClick={() => onSelect(t.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(t.id))}
              tabIndex={0}
              aria-current={selected ? 'true' : undefined}
              data-testid="timeline-item"
              data-status={t.status}
              data-event-id={t.id}
              data-on-path={onPath ? 'true' : undefined}
            >
              <div className="tl-time">
                <span>{clockOnly(t.ts)}</span>
                <small>{t.is_seed ? 'start' : signedDelta(t.seconds_from_seed)}</small>
              </div>
              <div className="tl-badge"><SourceBadge source={t.source_type} /></div>
              <div className="tl-event">
                <div className="tl-title">{t.is_seed ? 'Starting event (red-team)' : t.event_label}</div>
                <div className="tl-summary" title={t.summary}>{t.summary}</div>
              </div>
              <div className="tl-link">{linkLabel(t)}</div>
              <div className="tl-score">
                {t.is_seed ? (
                  <span className="subtle num">—</span>
                ) : (
                  <>
                    <div className={`scorebar ${t.status === 'rejected' ? 'rejected' : ''}`} aria-hidden="true">
                      <span style={{ width: `${Math.max(0, Math.min(1, t.score ?? 0)) * 100}%` }} />
                    </div>
                    <span className="num" title={`${strengthWord(t.score, threshold, t.status === 'rejected').text}: relationship strength ${score(t.score, 2)} (not a probability)`}>{score(t.score, 2)}</span>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
