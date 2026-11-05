// Parses and checks admin form submissions. Every parser returns either a
// complete input for the query functions or an error message for the editor.
import {
  CALLUP_LEVELS,
  TRANSFER_KINDS,
  isHttpUrl,
  isIsoDay,
  slugify,
  type CallupInput,
  type CallupLevel,
  type PlayerGroup,
  type PlayerInput,
  type Pool,
  type TransferInput,
  type TransferKind,
  type TvRightInput,
} from '@usnt/db';

export type Parsed<T> = { input: T; error?: undefined } | { input?: undefined; error: string };

/** Thrown by the field readers below; caught by `parse`. */
class FieldError extends Error {}

function fail(message: string): never {
  throw new FieldError(message);
}

/** Runs a parser, turning a FieldError into `{ error }`. Other errors still throw. */
function parse<T>(build: () => T): Parsed<T> {
  try {
    return { input: build() };
  } catch (err) {
    if (err instanceof FieldError) return { error: err.message };
    throw err;
  }
}

// ---- Field readers -------------------------------------------------------------

/** The trimmed field value ('' when missing). Never throws, so pages can use it directly. */
export function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

/** A positive integer ID, or null when the field is blank or not a valid ID. Never throws. */
export function optInt(form: FormData, key: string): number | null {
  const value = str(form, key);
  if (!/^\d{1,9}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

// The readers below throw FieldError, so only call them inside parse().

function text(form: FormData, key: string, maxLength = 500): string {
  const value = str(form, key);
  return value.length > maxLength ? fail(`Keep "${key}" under ${maxLength} characters.`) : value;
}

function optText(form: FormData, key: string, maxLength = 500): string | null {
  const value = text(form, key, maxLength);
  return value === '' ? null : value;
}

function requiredId(form: FormData, key: string, message: string): number {
  return optInt(form, key) ?? fail(message);
}

function optDay(form: FormData, key: string, label: string): string | null {
  const value = optText(form, key);
  if (value !== null && !isIsoDay(value)) fail(`${label} isn't a valid date.`);
  return value;
}

function requiredDay(form: FormData, key: string, label: string, missing: string): string {
  return optDay(form, key, label) ?? fail(missing);
}

function optUrl(form: FormData, key: string, label: string): string | null {
  const value = optText(form, key, 2000);
  if (value !== null && !isHttpUrl(value)) fail(`${label} must be a full link starting with https:// or http://.`);
  return value;
}

function requiredUrl(form: FormData, key: string, label: string, missing: string): string {
  return optUrl(form, key, label) ?? fail(missing);
}

function oneOf<T extends string>(form: FormData, key: string, allowed: readonly T[], message: string): T {
  const value = text(form, key);
  return (allowed as readonly string[]).includes(value) ? (value as T) : fail(message);
}

function endNotBeforeStart(start: string, end: string | null, message: string): void {
  // YYYY-MM-DD strings compare correctly as text.
  if (end !== null && end < start) fail(message);
}

// ---- Forms ----------------------------------------------------------------------

export function parsePlayerForm(form: FormData): Parsed<PlayerInput> {
  return parse(() => {
    const name = text(form, 'name', 200) || fail('Add the player’s name.');
    const slug = slugify(text(form, 'slug', 200) || name) || fail('The URL slug needs at least one letter or number.');
    return {
      slug,
      name,
      pool: oneOf<Pool>(form, 'pool', ['men', 'women'], 'Choose Men or Women.'),
      player_group: oneOf<PlayerGroup>(form, 'player_group', ['active', 'eligible'], 'Choose Active or Eligible.'),
      position: optText(form, 'position', 50),
      birth_date: optDay(form, 'birth_date', 'The birth date'),
      current_team_id: optInt(form, 'current_team_id'),
      eligibility_source: optText(form, 'eligibility_source'),
      eligibility_url: optUrl(form, 'eligibility_url', 'The eligibility source link'),
      bio: optText(form, 'bio', 2000),
    };
  });
}

/** Keeps what the editor typed when a submitted player form has an error. */
export function playerFormValues(form: FormData): Partial<PlayerInput> {
  const raw = (key: string) => String(form.get(key) ?? '').trim();
  return {
    name: raw('name'),
    slug: raw('slug'),
    pool: raw('pool') as Pool,
    player_group: raw('player_group') as PlayerGroup,
    position: raw('position'),
    birth_date: raw('birth_date'),
    current_team_id: optInt(form, 'current_team_id'),
    eligibility_source: raw('eligibility_source'),
    eligibility_url: raw('eligibility_url'),
    bio: raw('bio'),
  };
}

export function parseTransferForm(form: FormData): Parsed<TransferInput> {
  return parse(() => {
    const input: TransferInput = {
      player_id: requiredId(form, 'player_id', 'Choose the player.'),
      from_team_id: optInt(form, 'from_team_id'),
      to_team_id: optInt(form, 'to_team_id'),
      transfer_date: requiredDay(form, 'transfer_date', 'The date', 'Add the date of the move.'),
      kind: oneOf<TransferKind>(form, 'kind', TRANSFER_KINDS, 'Choose the type of move.'),
      fee_text: optText(form, 'fee_text', 200),
      source_url: requiredUrl(
        form,
        'source_url',
        'The announcement link',
        'Add the link to the official announcement. Facts only.',
      ),
    };
    if (input.kind !== 'extension' && input.from_team_id !== null && input.from_team_id === input.to_team_id) {
      fail('The from and to clubs are the same. Use "Contract extension" for a new deal at the same club.');
    }
    return input;
  });
}

export function parseCallupForm(form: FormData): Parsed<CallupInput> {
  return parse(() => {
    const input: CallupInput = {
      player_id: requiredId(form, 'player_id', 'Choose the player.'),
      level: oneOf<CallupLevel>(form, 'level', CALLUP_LEVELS, 'Choose the level.'),
      window_start: requiredDay(form, 'window_start', 'The start date', 'Add the start date of the camp or window.'),
      window_end: optDay(form, 'window_end', 'The end date'),
      source_url: requiredUrl(
        form,
        'source_url',
        'The roster link',
        'Add the link to the official roster announcement.',
      ),
    };
    endNotBeforeStart(input.window_start, input.window_end, 'The window can’t end before it starts.');
    return input;
  });
}

export function parseTvRightForm(form: FormData): Parsed<TvRightInput> {
  return parse(() => {
    const input: TvRightInput = {
      competition_id: requiredId(form, 'competition_id', 'Choose the competition.'),
      network: text(form, 'network', 100) || fail('Add the network or streaming service.'),
      url: optUrl(form, 'url', 'The network link'),
      valid_from: requiredDay(form, 'valid_from', 'The start date', 'Add the date these rights start.'),
      valid_to: optDay(form, 'valid_to', 'The end date'),
      notes: optText(form, 'notes'),
    };
    endNotBeforeStart(input.valid_from, input.valid_to, 'The rights can’t end before they start.');
    return input;
  });
}

/** True for a Postgres unique-constraint violation. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/** True for a Postgres foreign-key violation (e.g. a player or club deleted mid-edit). */
export function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23503';
}
