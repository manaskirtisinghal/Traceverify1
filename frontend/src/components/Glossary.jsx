import { useEffect, useRef, useState } from 'react';
import { SourceBadge } from './common.jsx';

const SOURCES = [
  ['redteam', 'The starting event: a sign-in that security testers (the “red team”) marked as attacker activity. Everything is traced from here.'],
  ['auth', 'Authentication: someone signing in to or out of a computer.'],
  ['proc', 'Process: a program starting or stopping on a computer.'],
  ['dns', 'DNS: a computer looking up another computer’s address, like a phone book.'],
  ['flow', 'Network flow: data sent from one computer to another.'],
];

const TERMS = [
  ['Link', 'The system thinks two events belong together because they share a user or computer, happen close in time, and match a known attack pattern.'],
  ['Relationship strength (0 to 1)', 'How well the clues (shared user or computer, closeness in time, known pattern) fit together. 0 means unrelated, 1 means a very clear fit. It is not a probability.'],
  ['Strong / Likely / Weak', 'Relationship strength in words. Strong is well above the inclusion threshold, Likely is just above it, Weak is below it.'],
  ['Inclusion threshold', 'The minimum relationship strength a link needs to count as evidence. It is a fixed system setting and the same for every investigation.'],
  ['Left out / weak matches', 'Checked, but linked too weakly to count. Turn on “Show weak matches” to see these events.'],
  ['Searched (time window)', 'How far before and after the starting event the system searches.'],
  ['Direct / 2 steps away', 'How many steps away an event is from the starting event in the chain.'],
  ['Supporting link', 'An extra connection that backs up a chain that was already found.'],
  ['Attack pattern (rule)', 'A known order of attacker actions, e.g. a sign-in followed by a program starting on the same computer.'],
];

export default function Glossary() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className="glossary-wrap" ref={ref}>
      <button className="glossary-btn" aria-expanded={open} aria-controls="glossary" onClick={() => setOpen((o) => !o)}
        data-testid="glossary-btn">
        <span className="glossary-q" aria-hidden="true">?</span> Key terms
      </button>
      {open && (
        <div className="glossary" id="glossary" role="dialog" aria-label="Key terms explained" data-testid="glossary">
          <h3>What the labels mean</h3>
          <dl>
            {SOURCES.map(([s, text]) => (
              <div key={s} className="g-row">
                <dt><SourceBadge source={s} /></dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
          <h3>Words used on the results page</h3>
          <dl>
            {TERMS.map(([term, text]) => (
              <div key={term} className="g-row">
                <dt>{term}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
