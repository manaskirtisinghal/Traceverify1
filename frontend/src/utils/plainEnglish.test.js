import { describe, expect, it } from 'vitest';
import {
  buildAliases, buildNarrative, plainSentence, simpleLinkReason, simpleSentence, simpleWhen, strengthWord,
} from './plainEnglish.js';

describe('plain-English wording', () => {
  it('describes events without jargon', () => {
    expect(plainSentence({ source_type: 'proc', user_name: 'U1', src_computer: 'C1',
      attributes: { processName: 'powershell.exe', eventType: 'Start' } }))
      .toBe('U1 started powershell.exe (a powerful scripting tool) on computer C1.');
    expect(plainSentence({ source_type: 'flow', src_computer: 'C1', dst_computer: 'C2', attributes: { dstPort: 445 } }))
      .toBe('Computer C1 sent data to computer C2 using Windows file sharing (SMB).');
    expect(plainSentence({ source_type: 'auth', user_name: 'U1', src_computer: 'C1', dst_computer: 'C2',
      attributes: { outcome: 'Fail' } })).toBe('U1 tried to sign in from C1 to C2, but it failed.');
  });

  it('puts scores into words relative to the threshold', () => {
    expect(strengthWord(0.9, 0.6).text).toBe('Strong link');
    expect(strengthWord(0.65, 0.6).text).toBe('Likely link');
    expect(strengthWord(0.5, 0.6).text).toBe('Weak link');
    expect(strengthWord(0.9, 0.6, true).text).toBe('Weak link');
  });
});

const seed = { id: 1, ts: 100, is_seed: true, status: 'seed', source_type: 'redteam', seconds_from_seed: 0,
  user_name: 'U620@DOM1', src_computer: 'C17693', dst_computer: 'C1003', attributes: {} };
const timeline = [
  { id: 2, ts: 105, status: 'accepted', score: 0.95, hop: 1, parent_event_id: 1, seconds_from_seed: 5,
    source_type: 'proc', user_name: 'U620@DOM1', src_computer: 'C1003', attributes: { processName: 'cmd.exe' } },
  seed,
  { id: 3, ts: 103, status: 'rejected', score: 0.3, hop: 1, parent_event_id: 1, seconds_from_seed: 3,
    source_type: 'auth', user_name: 'U9', src_computer: 'C5', dst_computer: 'C6', attributes: {} },
  { id: 4, ts: 110, status: 'accepted', score: 0.65, hop: 2, parent_event_id: 2, seconds_from_seed: 10,
    source_type: 'dns', src_computer: 'C1003', dst_computer: 'C42', attributes: {} },
  { id: 5, ts: 111, status: 'accepted', score: 0.66, hop: 3, parent_event_id: 4, seconds_from_seed: 11,
    source_type: 'flow', src_computer: 'C1003', dst_computer: 'C42', attributes: { dstPort: 443 } },
  { id: 6, ts: 112, status: 'accepted', score: 0.66, hop: 3, parent_event_id: 4, seconds_from_seed: 12,
    source_type: 'flow', src_computer: 'C1003', dst_computer: 'C42', attributes: { dstPort: 443 } },
];

describe('possible story', () => {
  it('replaces technical IDs with readable names, numbered from the starting event', () => {
    const names = buildAliases(timeline);
    expect(names.user('U620@DOM1')).toBe('User 1');
    expect(names.computer('C17693')).toBe('Computer 1');
    expect(names.computer('C1003')).toBe('Computer 2');
    expect(names.computer('C42')).toBe('Computer 3');
    expect(simpleSentence(timeline[3], names)).toBe('Computer 2 looked up the network address of Computer 3.');
    expect(simpleSentence(timeline[4], names)).toBe('Computer 2 sent data to Computer 3 using secure web traffic (HTTPS).');
  });

  it('tells the linked events in time order, without IDs, and groups repeats', () => {
    const story = buildNarrative(timeline, 0.6);
    expect(story.enough).toBe(true);
    expect(story.related).toBe(4);
    expect(story.lines.map((l) => l.ids)).toEqual([[1], [2], [4], [5, 6]]);
    expect(story.lines[3].count).toBe(2);
    expect(story.lines[1]).toMatchObject({ when: '5 seconds after the start',
      text: 'User 1 started the program cmd.exe (the Windows command prompt) on Computer 2.' });
    const text = story.lines.map((l) => l.text).join(' ');
    expect(text).not.toMatch(/U620|C1003|C17693|C42|#\d/);
    expect(text).not.toMatch(/attack|compromis|malicious/i);
    expect(story).toMatchObject({ usersInvolved: 1, computersInvolved: 3 });
  });

  it('says when there is not enough information for a story', () => {
    const story = buildNarrative([seed, { ...timeline[2] }], 0.6);
    expect(story.enough).toBe(false);
    const thin = buildNarrative([seed, { ...timeline[3], hop: 1 }], 0.6);
    expect(thin).toMatchObject({ enough: true, thin: true });
  });

  it('explains a link in plain words', () => {
    const names = buildAliases(timeline);
    const rel = { shared_entities: [{ type: 'user', value: 'U620@DOM1' }, { type: 'computer', value: 'C1003' }],
      time_delta_seconds: 5, matched_rule_code: 'R02' };
    expect(simpleLinkReason(rel, names)).toBe('It involves the same account (User 1) and the same computer (Computer 2) '
      + 'and happened 5 seconds after the activity it is linked to. '
      + 'The order of the two activities matches one of the sequences the system checks for.');
  });

  it('describes timing relative to the start', () => {
    expect(simpleWhen({ is_seed: true })).toBe('At the start');
    expect(simpleWhen({ seconds_from_seed: 1 })).toBe('1 second after the start');
    expect(simpleWhen({ seconds_from_seed: -8 })).toBe('8 seconds before the start');
    expect(simpleWhen({ seconds_from_seed: 300 })).toBe('5 minutes after the start');
  });
});
