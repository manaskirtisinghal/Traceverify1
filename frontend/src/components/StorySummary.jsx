import { useMemo, useState } from 'react';
import { buildNarrative, simpleLinkReason, simpleSentence, simpleWhen, storySteps, strengthWord } from '../utils/plainEnglish.js';

const STEP_LIMIT = 8;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "Possible story — not confirmed": a short, plain-language reading of the linked events, for readers
// without a security background. It uses only the investigation's own records and readable names
// ("User 1", "Computer 1"); technical IDs stay in the technical view.
export default function StorySummary({ timeline, relationships, threshold, mode, selectedId, onSelect, onShowEvidence }) {
  const story = useMemo(() => buildNarrative(timeline, threshold), [timeline, threshold]);
  const simple = mode === 'simple';

  const narrative = (
    <>
      <ol className="narrative" data-testid="story-narrative">
        {story.lines.map((l) => (
          <li key={l.ids[0]}>
            <button type="button" className={`narrative-line ${l.ids.includes(selectedId) ? 'selected' : ''}`}
              onClick={() => onSelect(l.ids[0])}>
              <span className="story-when">{l.when}</span>
              <span>{l.text}{l.count > 1 && <span className="subtle"> (this happened {l.count} times in a row)</span>}</span>
            </button>
          </li>
        ))}
      </ol>
      {story.moreLines > 0 && (
        <p className="small subtle">
          …plus {plural(story.moreLines, 'more step')}. {simple ? 'See every step below.' : 'See the timeline for all of them.'}
        </p>
      )}
    </>
  );

  return (
    <>
      <section className="card story" aria-labelledby="story-title" data-testid="story-summary">
        <div className="story-head">
          <div>
            <h2 id="story-title">Possible story <span className="story-tag">not confirmed</span></h2>
            <p className="story-lead" data-testid="story-lead">
              {story.enough ? (
                <>Based only on the recorded activity, here is one possible sequence of events involving{' '}
                  <b>{plural(story.usersInvolved, 'user account')}</b> and <b>{plural(story.computersInvolved, 'computer')}</b>:</>
              ) : (
                <>There isn’t enough information for a clear story. Nothing else in the records was linked strongly
                  enough to the starting sign-in.{simple && ' An analyst can widen the search from the Technical view.'}</>
              )}
            </p>
          </div>
        </div>

        <div className="story-narrative">
          {story.enough && (simple ? narrative : (
            // Kept compact in the technical view so the graph stays near the top of the page.
            <details className="disclosure story-collapsed" data-testid="story-collapsed">
              <summary>Read the story ({plural(story.lines.length + story.moreLines, 'line')})</summary>
              <div className="disclosure-body">{narrative}</div>
            </details>
          ))}
          {story.thin && (
            <p className="notice info small" data-testid="story-thin">
              Only one other activity was linked, and not strongly. Treat this story with extra caution.
            </p>
          )}
          <p className="story-caveat" data-testid="story-caveat" role="note">
            <b>This is an interpretation, not a confirmed account.</b> It is built from recorded events that share a user
            or computer, happened close together in time, or follow a sequence the system checks for. That kind of link
            (correlation) does not prove that one event caused another, or why anyone did anything.
          </p>
          {!simple && story.names.users.length + story.names.computers.length > 0 && (
            <details className="disclosure" data-testid="alias-key">
              <summary>Names used in this story → technical IDs</summary>
              <div className="disclosure-body alias-key">
                {[...story.names.users, ...story.names.computers].map(({ alias, real }) => (
                  <span key={alias}><span className="subtle">{alias}</span> <span className="mono">{real}</span></span>
                ))}
              </div>
            </details>
          )}
        </div>
      </section>

      {simple && story.enough && (
        <StepList timeline={timeline} relationships={relationships} threshold={threshold} names={story.names}
          selectedId={selectedId} onSelect={onSelect} onShowEvidence={onShowEvidence} />
      )}
    </>
  );
}

function StepList({ timeline, relationships, threshold, names, selectedId, onSelect, onShowEvidence }) {
  const [showAll, setShowAll] = useState(false);
  const all = useMemo(() => storySteps(timeline), [timeline]);
  const steps = showAll ? all : all.slice(0, STEP_LIMIT);
  const excluded = timeline.filter((t) => t.status === 'rejected').length;
  const linkOf = (id) => relationships.find((r) => r.target_event_id === id && r.is_primary && r.status === 'accepted');

  return (
    <section className="card story" aria-labelledby="steps-title" data-testid="story-steps">
      <div className="story-head">
        <div>
          <h2 id="steps-title">Every linked activity, step by step</h2>
          <p className="story-lead">Select a step to see, in plain words, why it was linked.</p>
        </div>
      </div>
      <div className="story-body single">
        <ol className="story-steps">
          {steps.map((t, i) => {
            const w = t.is_seed ? null : strengthWord(t.score, threshold);
            const selected = t.id === selectedId;
            return (
              <li key={t.id}>
                <button type="button" className={`story-step ${selected ? 'selected' : ''} ${t.is_seed ? 'seed' : ''}`}
                  onClick={() => onSelect(t.id)} aria-expanded={selected} data-testid="story-step">
                  <span className="story-num">{i + 1}</span>
                  <span className="story-when">{simpleWhen(t)}</span>
                  <span className="story-text">{simpleSentence(t, names)}</span>
                  {t.is_seed
                    ? <span className="pill danger">Starting point</span>
                    : <span className={`pill strength-${w.tone}`}>{w.text}</span>}
                </button>
                {selected && (
                  <div className="story-why" data-testid="story-why">
                    <p>
                      {t.is_seed
                        ? 'This is where the investigation starts. Every other step was linked back to it.'
                        : simpleLinkReason(linkOf(t.id), names) ?? 'This activity was linked to the steps before it.'}
                    </p>
                    <button type="button" className="btn small" onClick={() => onShowEvidence(t.id)} data-testid="show-evidence">
                      Show the technical evidence for this step
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {all.length > STEP_LIMIT && (
          <button className="btn ghost small" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `Show all ${all.length} steps`}
          </button>
        )}
        {excluded > 0 && (
          <p className="small subtle">
            {plural(excluded, 'other activity', 'other activities')} happened nearby but {excluded === 1 ? 'was' : 'were'} only
            loosely related, so {excluded === 1 ? 'it was' : 'they were'} left out of the story.
          </p>
        )}
      </div>
    </section>
  );
}
