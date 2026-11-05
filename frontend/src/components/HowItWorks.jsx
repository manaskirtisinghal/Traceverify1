const ICONS = {
  select: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  run: (
    <>
      <path d="M4 6h10M4 12h7M4 18h10" />
      <circle cx="17" cy="12" r="3.5" />
      <path d="M19.5 14.5L22 17" />
    </>
  ),
  explore: (
    <>
      <circle cx="5" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M7.3 11l8.4-4M7.3 13l8.4 4" />
    </>
  ),
  verify: (
    <>
      <path d="M12 3l7 3v5c0 4.4-3 8.2-7 10-4-1.8-7-5.6-7-10V6l7-3z" />
      <path d="M8.8 12.2l2.2 2.2 4.2-4.4" />
    </>
  ),
};

const STEPS = [
  ['select', 'Pick a suspicious event', 'Choose a sign-in that security testers flagged as an attack.'],
  ['run', 'Search around it', 'We look at sign-ins, programs, lookups and network traffic close in time.'],
  ['explore', 'Read the story', 'See what happened step by step, as a summary, map or timeline.'],
  ['verify', 'Check the reasons', 'Click any step to see why it was connected and how strongly.'],
];

export default function HowItWorks({ onDismiss }) {
  return (
    <section className="guide" aria-labelledby="guide-title" data-testid="how-it-works">
      <h2 id="guide-title" className="guide-title">How TRACEVERIFY works</h2>
      <ol className="guide-steps">
        {STEPS.map(([icon, title, text], i) => (
          <li className="guide-step" key={icon}>
            <span className="guide-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round">
                {ICONS[icon]}
              </svg>
            </span>
            <span className="guide-text">
              <span className="guide-step-title"><span className="guide-num">{i + 1}</span>{title}</span>
              <span className="guide-step-desc">{text}</span>
            </span>
          </li>
        ))}
      </ol>
      <button type="button" className="icon-btn guide-close" onClick={onDismiss} aria-label="Hide guide" data-testid="hide-guide">
        ✕
      </button>
    </section>
  );
}
