// Layman-friendly wording for the results UI. Display-only: nothing here affects scoring or the API.

// Short, neutral descriptions of common Windows programs (shown in brackets after the name).
const PROCESS_HINTS = {
  'powershell.exe': 'a powerful scripting tool',
  'cmd.exe': 'the Windows command prompt',
  'rundll32.exe': 'a Windows helper that runs code from library files',
  'wmic.exe': 'a Windows management tool',
  'net.exe': 'a tool for managing users and network shares',
  'psexec.exe': 'a tool for running programs on other computers',
  'explorer.exe': 'the Windows desktop and file browser',
  'svchost.exe': 'a Windows background-service host',
  'schtasks.exe': 'a tool for scheduling tasks',
  'reg.exe': 'a tool for editing Windows settings (registry)',
  'whoami.exe': 'a tool that shows which user is signed in',
  'mstsc.exe': 'the Remote Desktop app',
  'certutil.exe': 'a certificate tool that can also download files',
  'mshta.exe': 'a Windows tool that runs HTML applications',
  'regsvr32.exe': 'a Windows tool that registers library files',
};

// What a destination port is usually used for.
const PORT_HINTS = {
  21: 'file transfer (FTP)',
  22: 'remote login (SSH)',
  53: 'address lookups (DNS)',
  80: 'web traffic (HTTP)',
  88: 'Windows sign-in (Kerberos)',
  135: 'Windows remote management (RPC)',
  139: 'Windows file sharing (NetBIOS)',
  389: 'directory lookups (LDAP)',
  443: 'secure web traffic (HTTPS)',
  445: 'Windows file sharing (SMB)',
  3389: 'Remote Desktop',
  5985: 'Windows remote management (WinRM)',
  5986: 'Windows remote management (WinRM)',
};

export const processHint = (name) => PROCESS_HINTS[String(name ?? '').toLowerCase()] ?? null;
export const portHint = (port) => PORT_HINTS[Number(port)] ?? null;

// One plain sentence describing an event, for someone with no security background.
export function plainSentence(t) {
  const a = t.attributes ?? {};
  const user = t.user_name ?? 'An unknown user';
  const src = t.src_computer ?? 'an unknown computer';
  const dst = t.dst_computer ?? 'an unknown computer';
  switch (t.source_type) {
    case 'redteam':
      return `${user} signed in from computer ${src} to computer ${dst}. Security testers (the "red team") `
        + 'marked this sign-in as attacker activity, so the investigation starts here.';
    case 'auth': {
      const orient = (a.authOrient ?? '').toLowerCase();
      if (orient === 'logoff') return `${user} signed out of the connection from ${src} to ${dst}.`;
      if (orient === 'tgs' || orient === 'tgt') {
        return `${user} asked the Windows sign-in service for an access pass (Kerberos ticket) to go from ${src} to ${dst}.`;
      }
      if ((a.outcome ?? '').toLowerCase() === 'fail') return `${user} tried to sign in from ${src} to ${dst}, but it failed.`;
      return `${user} signed in from computer ${src} to computer ${dst}.`;
    }
    case 'proc': {
      const name = a.processName ?? 'a program';
      const hint = processHint(a.processName);
      const verb = (a.eventType ?? '').toLowerCase() === 'end' ? 'closed' : 'started';
      return `${user} ${verb} ${name}${hint ? ` (${hint})` : ''} on computer ${src}.`;
    }
    case 'dns':
      return `Computer ${src} looked up where computer ${dst} is on the network, like checking a phone book before calling.`;
    case 'flow': {
      const hint = portHint(a.dstPort);
      const how = hint ? ` using ${hint}` : a.dstPort != null ? ` on port ${a.dstPort}` : '';
      return `Computer ${src} sent data to computer ${dst}${how}.`;
    }
    default:
      return t.summary ?? '';
  }
}

// Score in words, using the same cut-offs as the details panel ("well above the threshold" = +0.2).
export function strengthWord(value, threshold, rejected = false) {
  if (rejected || value == null || value < threshold) return { text: 'Weak link', tone: 'weak' };
  if (value - threshold >= 0.2) return { text: 'Strong link', tone: 'strong' };
  return { text: 'Likely link', tone: 'likely' };
}

// ---------------------------------------------------------------------------------------------
// "Possible story" for the simple results view.
// Built only from the investigation's own records: no locations, motives, people or attack claims
// are added. Real account and computer IDs are replaced by stable, readable names ("User 1",
// "Computer 1"), numbered in the order they first appear, starting from the starting event.
// ---------------------------------------------------------------------------------------------

const NARRATIVE_LIMIT = 6;

// Story steps: the starting event plus every accepted (linked) activity, in time order.
export function storySteps(timeline) {
  return timeline
    .filter((t) => t.is_seed || t.status === 'accepted')
    .sort((a, b) => a.ts - b.ts || (b.is_seed - a.is_seed) || a.id - b.id);
}

export function buildAliases(timeline) {
  const seed = timeline.find((t) => t.is_seed);
  const ordered = [...(seed ? [seed] : []), ...storySteps(timeline).filter((t) => !t.is_seed),
    ...timeline.filter((t) => t.status === 'rejected')];
  const users = new Map();
  const computers = new Map();
  for (const t of ordered) {
    if (t.user_name && !users.has(t.user_name)) users.set(t.user_name, `User ${users.size + 1}`);
    for (const c of [t.src_computer, t.dst_computer]) {
      if (c && !computers.has(c)) computers.set(c, `Computer ${computers.size + 1}`);
    }
  }
  return {
    user: (u) => (u ? users.get(u) ?? 'an unlisted user' : 'An unrecorded account'),
    computer: (c) => (c ? computers.get(c) ?? 'an unlisted computer' : 'an unrecorded computer'),
    users: [...users].map(([real, alias]) => ({ alias, real })),
    computers: [...computers].map(([real, alias]) => ({ alias, real })),
  };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// One plain sentence per event, using readable names instead of technical IDs.
export function simpleSentence(t, names) {
  const a = t.attributes ?? {};
  const user = names.user(t.user_name);
  const src = names.computer(t.src_computer);
  const dst = names.computer(t.dst_computer);
  const route = t.src_computer && t.src_computer === t.dst_computer ? `on ${src}` : `from ${src} to ${dst}`;
  switch (t.source_type) {
    case 'redteam':
      return `${user} signed in ${route}. A security-testing log had flagged this sign-in, so the investigation starts here.`;
    case 'auth': {
      const orient = (a.authOrient ?? '').toLowerCase();
      if (orient === 'logoff') return `${user} signed out ${route.startsWith('on ') ? route : `of the connection ${route}`}.`;
      if (orient === 'tgs' || orient === 'tgt') return `${user} requested sign-in access ${route}.`;
      if ((a.outcome ?? '').toLowerCase() === 'fail') return `${user} tried to sign in ${route}, but it failed.`;
      return `${user} signed in ${route}.`;
    }
    case 'proc': {
      const hint = processHint(a.processName);
      const verb = (a.eventType ?? '').toLowerCase() === 'end' ? 'closed' : 'started';
      const prog = a.processName ? `the program ${a.processName}${hint ? ` (${hint})` : ''}` : 'a program';
      return `${user} ${verb} ${prog} on ${src}.`;
    }
    case 'dns':
      return `${cap(src)} looked up the network address of ${dst}.`;
    case 'flow': {
      const hint = portHint(a.dstPort);
      return `${cap(src)} sent data to ${dst}${hint ? ` using ${hint}` : ' over the network'}.`;
    }
    default:
      return 'An activity was recorded.';
  }
}

// "5 seconds", "2 minutes", "1.5 hours"
export function friendlyDuration(seconds) {
  const s = Math.abs(seconds);
  if (s < 120) return `${s} second${s === 1 ? '' : 's'}`;
  if (s < 7200) return `${Math.round(s / 60)} minutes`;
  return `${(s / 3600).toFixed(1)} hours`;
}

export function simpleWhen(t) {
  if (t.is_seed) return 'At the start';
  const d = t.seconds_from_seed ?? 0;
  if (d === 0) return 'At the same moment';
  return `${friendlyDuration(d)} ${d < 0 ? 'before' : 'after'} the start`;
}

// Short, grouped narrative for the "Possible story — not confirmed" panel.
export function buildNarrative(timeline, threshold) {
  const names = buildAliases(timeline);
  const steps = storySteps(timeline);
  const related = steps.filter((t) => !t.is_seed);
  const strong = related.filter((t) => strengthWord(t.score, threshold).tone === 'strong').length;

  // Collapse back-to-back activities that read the same ("…signed in from Computer 1 to Computer 2" ×3).
  const lines = [];
  for (const t of steps) {
    const text = simpleSentence(t, names);
    const last = lines[lines.length - 1];
    if (last && !last.seed && !t.is_seed && last.text === text) {
      last.count += 1;
      last.ids.push(t.id);
    } else {
      lines.push({ when: simpleWhen(t), text, count: 1, ids: [t.id], seed: !!t.is_seed });
    }
  }

  return {
    enough: related.length > 0,
    thin: related.length === 1 && strong === 0,
    related: related.length,
    strong,
    lines: lines.slice(0, NARRATIVE_LIMIT),
    moreLines: Math.max(0, lines.length - NARRATIVE_LIMIT),
    usersInvolved: names.users.filter(({ real }) => steps.some((t) => t.user_name === real)).length,
    computersInvolved: names.computers.filter(({ real }) => steps.some((t) => t.src_computer === real || t.dst_computer === real)).length,
    names,
  };
}

// Why one event is linked, in plain words, from the stored relationship (no rule names, no attack claims).
export function simpleLinkReason(rel, names) {
  if (!rel) return null;
  const parts = [];
  const shared = rel.shared_entities ?? [];
  const sharedComputers = new Set(shared.filter((s) => s.type === 'computer').map((s) => s.value));
  for (const s of shared) {
    if (s.type === 'user') parts.push(`the same account (${names.user(s.value)})`);
    else if (s.type === 'host_continuity') {
      if (!sharedComputers.has(s.value)) parts.push(`activity continuing on ${names.computer(s.value)}`);
    } else parts.push(`the same computer (${names.computer(s.value)})`);
  }
  const d = rel.time_delta_seconds;
  const timing = d === 0 ? 'at the same moment as' : `${friendlyDuration(d)} ${d > 0 ? 'after' : 'before'}`;
  let text = parts.length
    ? `It involves ${joinWords([...new Set(parts)])} and happened ${timing} the activity it is linked to.`
    : `It happened ${timing} the activity it is linked to.`;
  if (rel.matched_rule_code) text += ' The order of the two activities matches one of the sequences the system checks for.';
  return text;
}

function joinWords(xs) {
  return xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}
