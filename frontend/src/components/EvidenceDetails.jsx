import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { ErrorState, Loading, SourceBadge } from './common.jsx';
import { offsetFromStart, readableTime, relativeTo, score } from '../utils/format.js';
import { plainSentence, strengthWord } from '../utils/plainEnglish.js';

const COMPONENTS = [
  ['Same user / computer', 'entity_score', 'entity', 'var(--accent)'],
  ['Close in time', 'temporal_score', 'temporal', 'var(--violet)'],
  ['Attack pattern', 'rule_score', 'rule', 'var(--amber)'],
];

// The rule registry is static for a session; fetch it once from the API.
let rulesPromise = null;
const loadRules = () => {
  rulesPromise ??= api.rules().then((list) => new Map(list.map((r) => [r.code, r]))).catch(() => new Map());
  return rulesPromise;
};

function eventName(ev) {
  if (!ev) return null;
  return ev.is_seed ? 'the starting event' : `${ev.event_label} #${ev.id}`;
}

const joinAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// Plain-English description of what an event records (built only from its own fields).
export function whatHappened(t) {
  const a = t.attributes ?? {};
  const user = t.user_name ?? 'An unknown user';
  switch (t.source_type) {
    case 'redteam':
      return `Red-team record: ${user} authenticated from ${t.src_computer} to ${t.dst_computer}.`;
    case 'auth': {
      const orient = (a.authOrient ?? '').toLowerCase();
      const failed = (a.outcome ?? '').toLowerCase() === 'fail';
      const via = a.authType ? ` using ${a.authType}` : '';
      if (orient === 'logoff') return `${user} logged off the session from ${t.src_computer} to ${t.dst_computer}.`;
      if (orient === 'tgs' || orient === 'tgt') return `${user} requested a Kerberos ticket (${t.src_computer} → ${t.dst_computer}).`;
      return `${user} ${failed ? 'failed to log on' : 'logged on'} from ${t.src_computer} to ${t.dst_computer}${via}.`;
    }
    case 'proc': {
      const verb = (a.eventType ?? '').toLowerCase() === 'end' ? 'stopped' : 'started';
      return `${user} ${verb} ${a.processName ?? 'a process'} on ${t.src_computer}.`;
    }
    case 'dns':
      return `${t.src_computer} looked up the address of ${t.dst_computer} (DNS).`;
    case 'flow':
      return `${t.src_computer} sent network traffic to ${t.dst_computer} on port ${a.dstPort ?? '?'}`
        + `${a.packets != null ? ` (${a.packets} packets, ${a.bytes ?? '?'} bytes)` : ''}.`;
    default:
      return t.summary;
  }
}

function linkedTiming(delta) {
  if (delta === 0) return 'at the same second as this event';
  return `${relativeTo(delta)} ${delta > 0 ? 'before' : 'after'} this event`;
}

function strengthText(rel, threshold) {
  if (rel.status !== 'accepted') return 'below the threshold';
  return rel.final_score - threshold >= 0.2 ? 'well above the threshold' : 'above the threshold';
}

const COMPONENT_WORDS = { entity_score: 'shared entities', temporal_score: 'time proximity', rule_score: 'rule match' };

function shortReason(rel, linked, threshold) {
  const ents = rel.shared_entities.filter((s) => s.type !== 'host_continuity').map((s) => `${s.type} ${s.value}`);
  const cont = rel.shared_entities.find((s) => s.type === 'host_continuity');
  let text = ents.length ? `It shares ${joinAnd(ents)} with ${linked}` : `It shares no entities with ${linked}`;
  if (cont) text += `, and activity continues on the same host (${cont.value})`;
  const d = rel.time_delta_seconds;
  text += d === 0 ? ', at the same second' : `, ${relativeTo(d)} ${d > 0 ? 'later' : 'earlier'}`;
  text += rel.matched_rule_code
    ? `. The order of events fits the attack pattern “${rel.matched_rule_name}”.`
    : '. These two events do not follow a known attack pattern.';
  if (rel.status !== 'accepted') {
    const [weakest] = Object.keys(COMPONENT_WORDS).sort((a, b) => rel[a] - rel[b]);
    text += ` Its relationship strength of ${score(rel.final_score, 3)} stays below ${threshold.toFixed(2)}, held down mainly by a low`
      + ` ${COMPONENT_WORDS[weakest]} score (${score(rel[weakest], 2)}).`;
  }
  return text;
}

function Relationship({ rel, params, eventsById, onSelectEvent, openMaths }) {
  const [rules, setRules] = useState(null);
  useEffect(() => { loadRules().then(setRules); }, []);
  const accepted = rel.status === 'accepted';
  const linked = eventsById.get(rel.source_event_id);
  const linkedLabel = eventName(linked) ?? `event #${rel.source_event_id}`;
  const shared = rel.shared_entities.filter((s) => s.type !== 'host_continuity');
  const continuity = rel.shared_entities.find((s) => s.type === 'host_continuity');
  const rule = rel.matched_rule_code ? rules?.get(rel.matched_rule_code) : null;

  return (
    <section className="details" data-testid="why-panel">
      <div className={`verdict ${accepted ? 'ok' : 'no'}`}>
        <div className="verdict-line">
          <span>{accepted ? `Included as evidence: ${strengthWord(rel.final_score, params.threshold).text.toLowerCase()}` : 'Left out: weak link'}{accepted && !rel.is_primary ? ' (supporting link)' : ''}</span>
          <span className="verdict-score mono" data-testid="final-score">{score(rel.final_score, 3)}</span>
        </div>
        <div className="strength" aria-hidden="true">
          <span className="strength-fill" style={{ width: `${rel.final_score * 100}%` }} />
          <span className="strength-thr" style={{ left: `${params.threshold * 100}%` }} />
        </div>
        <div className="verdict-sub" data-testid="strength">
          Relationship strength {strengthText(rel, params.threshold)} ({params.threshold.toFixed(2)}, a fixed system setting)
        </div>
        <p className="subtle small" data-testid="not-probability">
          Relationship strength (0–1) measures how well the clues fit together. It is not a probability:
          {' '}{score(rel.final_score, 2)} does not mean “{Math.round(rel.final_score * 100)}% likely”.
        </p>
      </div>

      <div className="qa">
        <h3>{accepted ? 'Related to' : 'Closest related event'}</h3>
        <p>
          {linked ? (
            <a href="#" onClick={(e) => { e.preventDefault(); onSelectEvent(linked.id); }}>{linkedLabel}</a>
          ) : linkedLabel}
          <span className="subtle"> · {linkedTiming(rel.time_delta_seconds)}</span>
        </p>
        <p className="subtle small">
          {!accepted
            ? 'Candidate link only — not accepted into the evidence graph'
            : rel.hop === 1 ? 'Direct link to the starting event' : `${rel.hop} links from the starting event`}
        </p>
      </div>

      <div className="qa">
        <h3>What they have in common</h3>
        <div className="entity-list">
          {shared.length === 0 && !continuity && <span className="subtle">No shared entities</span>}
          {shared.map((s) => (
            <span className="entity" key={`${s.type}-${s.value}`}>
              <span className="kind">{s.type}</span><span className="v">{s.value}</span>
            </span>
          ))}
          {continuity && (
            <span className="entity cont" title="The later event starts on the host where the earlier event took place">
              <span className="kind">same host</span><span className="v">{continuity.value}</span>
            </span>
          )}
        </div>
        <p className="small" data-testid="matched-rule">
          {rel.matched_rule_code
            ? <>Attack pattern: {rel.matched_rule_name} <span className="subtle">({rel.matched_rule_code}, {rel.rule_match} match)</span></>
            : <span className="subtle">Does not match a known attack pattern</span>}
        </p>
      </div>

      <div className="qa">
        <h3>{accepted ? 'Why it was included' : 'Why it was excluded'}</h3>
        <p className="reason" data-testid="short-reason">{shortReason(rel, linkedLabel, params.threshold)}</p>
      </div>

      <details className="disclosure" data-testid="score-details" open={openMaths}>
        <summary>How this relationship strength was calculated</summary>
        <div className="disclosure-body">
          <div className="scores" data-testid="score-breakdown">
            {COMPONENTS.map(([label, key, wkey, color]) => (
              <div key={key} style={{ display: 'contents' }}>
                <span>{label}</span>
                <div className="bar"><span style={{ width: `${rel[key] * 100}%`, background: color }} /></div>
                <span className="num">{score(rel[key], 2)}</span>
                <span className="contrib" title={`weight ${params.weights[wkey].toFixed(2)} × ${score(rel[key], 2)}`}>
                  +{(rel[key] * params.weights[wkey]).toFixed(3)}
                </span>
              </div>
            ))}
            <span className="final">Strength</span>
            <span className="final" />
            <span className="num final">{score(rel.final_score, 3)}</span>
            <span className="contrib final" title="inclusion threshold (fixed system setting)">{accepted ? '≥' : '<'} {params.threshold.toFixed(2)}</span>
          </div>
          <p className="subtle small">
            Relationship strength = {params.weights.entity.toFixed(2)} × entities + {params.weights.temporal.toFixed(2)} × time + {params.weights.rule.toFixed(2)} × rule
          </p>
          {rule && (
            <p className="small" data-testid="rule-condition">
              <span className="subtle">{rule.code} condition: </span>{rule.condition_text}
            </p>
          )}
          <p className="explanation" data-testid="explanation">{rel.explanation}</p>
        </div>
      </details>
    </section>
  );
}

function EventRecord({ detail }) {
  const a = detail.attributes ?? {};
  const rows = [
    ['Time', `${readableTime(detail.ts)} (t=${detail.ts})`, true],
    detail.user_name ? ['User', detail.user_name, true] : null,
    detail.src_computer ? [detail.source_type === 'proc' ? 'Computer' : 'Source', detail.src_computer, true] : null,
    detail.dst_computer ? [detail.source_type === 'dns' ? 'Resolved' : 'Destination', detail.dst_computer, true] : null,
    a.processName ? ['Process', a.processName, true] : null,
    a.authType || a.logonType ? ['Logon', [a.authType, a.logonType, a.authOrient, a.outcome].filter(Boolean).join(' · ')] : null,
    a.dstPort || a.protocol ? ['Connection', `port ${a.dstPort ?? '?'} · protocol ${a.protocol ?? '?'} · ${a.packets ?? '?'} packets · ${a.bytes ?? '?'} bytes`] : null,
    ['Event type', detail.event_type, true],
    ['Source file', `${detail.source_file}, line ${detail.line_no}`, true],
    ['Data label', detail.dataset_label],
  ].filter(Boolean);
  return (
    <dl className="facts">
      {rows.map(([k, v, mono]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd className={mono ? 'mono' : ''}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function EvidenceDetails({ selection, timeline, relationships, params, onSelectEvent }) {
  const eventsById = new Map(timeline.map((t) => [t.id, t]));
  const rel = selection?.kind === 'relationship'
    ? relationships.find((r) => r.id === selection.id)
    : selection?.kind === 'event'
      ? relationships.find((r) => r.target_event_id === selection.id && (r.is_primary || r.status === 'rejected'))
      : null;
  const eventId = selection?.kind === 'event' ? selection.id : rel?.target_event_id;
  const supporting = selection?.kind === 'event'
    ? relationships.filter((r) => r.target_event_id === selection.id && !r.is_primary && r.status === 'accepted')
    : [];
  const directCount = relationships.filter((r) => r.status === 'accepted' && r.is_primary && r.source_event_id === eventId).length;

  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (eventId == null) return undefined;
    let live = true;
    setDetail(null);
    setError(null);
    api.event(eventId).then((d) => live && setDetail(d)).catch((e) => live && setError(e));
    return () => { live = false; };
  }, [eventId]);

  if (!selection) {
    return <div className="state">Select an event in the graph or timeline.</div>;
  }
  const item = eventsById.get(eventId);

  return (
    <div className="details" data-testid="evidence-details">
      {item && (
        <div className="details-head">
          <div className="details-title">
            <SourceBadge source={item.source_type} />
            <h2 data-testid="details-title">{item.is_seed ? 'Starting event' : item.event_label}</h2>
            <span className="mono subtle" style={{ marginLeft: 'auto' }}>#{item.id}</span>
          </div>
          <div className="qa">
            <h3>What happened</h3>
            <p data-testid="what-happened">{whatHappened(item)}</p>
            <p className="plain small" data-testid="plain-sentence">In plain words: {plainSentence(item)}</p>
            <p className="subtle small">
              {readableTime(item.ts)}{!item.is_seed && ` · ${offsetFromStart(item.seconds_from_seed)}`}
            </p>
          </div>
        </div>
      )}
      {selection.kind === 'relationship' && rel && (
        <p className="muted small" data-testid="relationship-caption">
          Showing the link from {eventName(eventsById.get(rel.source_event_id)) ?? `#${rel.source_event_id}`} to this event.
        </p>
      )}
      {item?.is_seed && (
        <p className="muted">
          This red-team record is where the investigation starts. {directCount} event{directCount === 1 ? ' is' : 's are'} directly
          linked to it. Select one of them to see why it was linked.
        </p>
      )}

      {rel && (
        <Relationship key={`${selection.kind}-${rel.id}`} rel={rel} params={params} eventsById={eventsById}
          onSelectEvent={onSelectEvent} openMaths={selection.kind === 'relationship'} />
      )}
      {supporting.length > 0 && (
        <p className="muted small">
          Also linked from{' '}
          {supporting.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ', '}
              <a href="#" onClick={(e) => { e.preventDefault(); onSelectEvent(s.source_event_id); }}>
                {eventName(eventsById.get(s.source_event_id)) ?? `#${s.source_event_id}`}
              </a>{' '}
              <span className="mono subtle">({score(s.final_score, 2)})</span>
            </span>
          ))}
        </p>
      )}

      <details className="disclosure">
        <summary>Original log record (for experts)</summary>
        <div className="disclosure-body">
          {error && <ErrorState error={error} />}
          {!detail && !error && <Loading label="Loading event…" />}
          {detail && (
            <>
              <EventRecord detail={detail} />
              <div className="raw">{detail.raw_line}</div>
              <div>
                <div className="section-label">How often these entities appear (context only, not scored)</div>
                <div className="entity-list">
                  {detail.entities.map((e) => (
                    <span className="entity" key={`${e.role}-${e.value}`}
                      title={e.correlatable ? 'Used for correlation' : 'Stored, not used for correlation'}>
                      <span className="kind">{e.role.replace('_', ' ')}</span>
                      <span className="v">{e.value}</span>
                      <span className="kind">{e.events_with_entity}</span>
                    </span>
                  ))}
                </div>
              </div>
              {detail.process_rarity && (
                <p className="muted small">
                  {detail.process_rarity.process} appears in {detail.process_rarity.occurrences} of{' '}
                  {detail.process_rarity.process_events} process events.
                </p>
              )}
            </>
          )}
        </div>
      </details>
    </div>
  );
}
