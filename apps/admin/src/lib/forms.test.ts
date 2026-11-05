import { describe, expect, it } from 'vitest';
import { optInt, parseCallupForm, parsePlayerForm, parseTransferForm, parseTvRightForm } from './forms';

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe('optInt', () => {
  it('accepts only positive integer IDs', () => {
    expect(optInt(form({ id: '12' }), 'id')).toBe(12);
    for (const bad of ['', '0', '-1', '1.5', '1e3', 'abc', '99999999999']) {
      expect(optInt(form({ id: bad }), 'id')).toBeNull();
    }
  });
});

describe('parsePlayerForm', () => {
  const valid = { name: 'Some Player', pool: 'men', player_group: 'active' };

  it('builds the input with a slug from the name', () => {
    expect(parsePlayerForm(form(valid)).input).toMatchObject({ slug: 'some-player', birth_date: null });
  });

  it('rejects unsafe links, bad dates and unknown choices', () => {
    expect(parsePlayerForm(form({ ...valid, eligibility_url: 'javascript:alert(1)' })).error).toMatch(/https/);
    expect(parsePlayerForm(form({ ...valid, birth_date: '2001-02-30' })).error).toMatch(/valid date/);
    expect(parsePlayerForm(form({ ...valid, pool: 'both' })).error).toBe('Choose Men or Women.');
    expect(parsePlayerForm(form({ ...valid, name: 'x'.repeat(201) })).error).toMatch(/under 200/);
  });
});

describe('parseTransferForm', () => {
  const valid = {
    player_id: '1',
    to_team_id: '3',
    transfer_date: '2026-08-01',
    kind: 'permanent',
    source_url: 'https://club.example/news',
  };

  it('accepts a complete form', () => {
    expect(parseTransferForm(form(valid)).input).toMatchObject({ player_id: 1, from_team_id: null, to_team_id: 3 });
  });

  it('requires an http(s) source and a real kind', () => {
    expect(parseTransferForm(form({ ...valid, source_url: '' })).error).toMatch(/official announcement/);
    expect(parseTransferForm(form({ ...valid, source_url: 'ftp://x' })).error).toMatch(/https/);
    expect(parseTransferForm(form({ ...valid, kind: 'rumor' })).error).toBe('Choose the type of move.');
  });

  it('rejects a move to the same club unless it is an extension', () => {
    expect(parseTransferForm(form({ ...valid, from_team_id: '3' })).error).toMatch(/same/);
    expect(parseTransferForm(form({ ...valid, from_team_id: '3', kind: 'extension' })).input).toBeDefined();
  });
});

describe('parseCallupForm / parseTvRightForm', () => {
  it('rejects ranges that end before they start', () => {
    expect(
      parseCallupForm(
        form({ player_id: '1', level: 'senior', window_start: '2026-11-10', window_end: '2026-11-01', source_url: 'https://ussoccer.example' }),
      ).error,
    ).toMatch(/end before/);
    expect(
      parseTvRightForm(form({ competition_id: '1', network: 'N', valid_from: '2026-08-01', valid_to: '2026-07-01' })).error,
    ).toMatch(/end before/);
  });

  it('accepts open-ended TV rights without a link', () => {
    expect(parseTvRightForm(form({ competition_id: '1', network: 'N', valid_from: '2026-08-01' })).input).toMatchObject({
      url: null,
      valid_to: null,
    });
  });
});
