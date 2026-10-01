/**
 * The campaign: the deck a run starts with, the five opponents, and the
 * progression curve.
 *
 * This lives in `src/` rather than in the front-end so the balance harness
 * measures the same numbers the game ships. Tuning against a copy of the
 * campaign is how you end up with a tuned copy and an untuned game.
 */

import type { StatKey } from '../core/stats.ts';

/** Focus presets the opponent decks are built with. */
export const FOCUS = {
  might: ['might'] as readonly StatKey[],
  bruiser: ['might', 'vitality'] as readonly StatKey[],
  tank: ['vitality', 'guard'] as readonly StatKey[],
  swift: ['speed', 'might'] as readonly StatKey[],
} as const;

export type AiProfileName = 'cautious' | 'steady' | 'ruthless';

export interface StageCreature {
  readonly definitionId: string;
  readonly level: number;
  readonly focus: readonly StatKey[];
}

export interface Stage {
  readonly name: string;
  readonly blurb: string;
  readonly profile: AiProfileName;
  /**
   * Nexus health for this duel, scaled across the run.
   *
   * A fixed value cannot serve both ends: level-1 commons deal about five
   * damage a swing and simply cannot push thirty, so the opening duel ground
   * out to the turn limit and was decided by a tiebreak. Late duels, where
   * creatures hit for twenty-five, were over in four turns. Scaling it keeps
   * every duel roughly the same number of decisions long.
   */
  readonly nexusHealth: number;
  readonly creatures: readonly StageCreature[];
  readonly effects: readonly string[];
}

function creature(
  definitionId: string,
  level: number,
  focus: readonly StatKey[],
): StageCreature {
  return { definitionId, level, focus };
}

export const STAGES: readonly Stage[] = [
  {
    name: 'The Scavenger Warren',
    nexusHealth: 10,
    blurb: 'Vermin from the under-dark. Barely blooded, and they know it.',
    profile: 'cautious',
    creatures: [
      creature('dusk-mite', 1, FOCUS.swift),
      creature('thicket-hare', 1, FOCUS.swift),
      creature('pebble-grub', 1, FOCUS.tank),
      creature('gale-sprite', 1, FOCUS.tank),
      creature('tide-minnow', 1, FOCUS.bruiser),
      creature('gale-sprite', 1, FOCUS.tank),
      creature('tide-minnow', 1, FOCUS.bruiser),
      creature('dusk-mite', 1, FOCUS.swift),
      creature('thicket-hare', 1, FOCUS.swift),
      creature('pebble-grub', 1, FOCUS.tank),
      creature('gale-sprite', 1, FOCUS.tank),
    ],
    effects: ['grave-draught'],
  },
  {
    name: 'Brackwater Raiders',
    nexusHealth: 26,
    blurb: 'Drowned-coast reavers. Their commons have promoted out of Weak.',
    profile: 'steady',
    creatures: [
      creature('tide-minnow', 8, FOCUS.bruiser),
      creature('reef-sentinel', 8, FOCUS.tank),
      creature('grave-moth', 8, FOCUS.swift),
      creature('dusk-mite', 8, FOCUS.swift),
      creature('scrapfang-pup', 8, FOCUS.might),
      creature('ember-whelp', 8, FOCUS.might),
      creature('pebble-grub', 8, FOCUS.tank),
      creature('cinder-imp', 8, FOCUS.swift),
      creature('thicket-hare', 8, FOCUS.swift),
      creature('gale-sprite', 8, FOCUS.tank),
    ],
    effects: ['emberlash', 'shroud-of-ash', 'bonecage'],
  },
  {
    name: 'The Ashen Kennel',
    nexusHealth: 30,
    blurb: 'Cheap cards taken seriously. Every beast here is an Elite on a common frame.',
    profile: 'steady',
    creatures: [
      creature('ashfang-jackal', 10, FOCUS.might),
      creature('cinder-imp', 10, FOCUS.swift),
      creature('bramble-warden', 10, FOCUS.tank),
      creature('reef-sentinel', 10, FOCUS.tank),
      creature('grave-moth', 10, FOCUS.swift),
      creature('ember-whelp', 10, FOCUS.might),
      creature('thicket-hare', 10, FOCUS.swift),
      creature('scrapfang-pup', 10, FOCUS.bruiser),
      creature('dusk-mite', 10, FOCUS.swift),
      creature('pebble-grub', 10, FOCUS.tank),
    ],
    effects: ['emberlash', 'whetstone-rite', 'cinderbloom'],
  },
  {
    name: 'The Gilded Menagerie',
    nexusHealth: 36,
    blurb:
      'Rares and epics straight out of the packs, never played. This is what your levelling was for.',
    profile: 'ruthless',
    creatures: [
      creature('stormcaller-roc', 7, FOCUS.might),
      creature('magma-colossus', 7, FOCUS.tank),
      creature('abyssal-serpent', 7, FOCUS.bruiser),
      creature('nightmare-stalker', 7, FOCUS.might),
      creature('pyreclaw-tyrant', 6, FOCUS.might),
      creature('ember-whelp', 13, FOCUS.might),
      creature('thicket-hare', 10, FOCUS.swift),
      creature('tide-minnow', 13, FOCUS.bruiser),
      creature('dusk-mite', 13, FOCUS.swift),
      creature('gale-sprite', 10, FOCUS.tank),
    ],
    effects: ['ruinous-bolt', 'grave-draught', 'second-wind'],
  },
  {
    name: 'The Hollow Crown',
    nexusHealth: 42,
    blurb: 'A mythic and two levelled rares, behind a wall of seasoned commons.',
    profile: 'ruthless',
    creatures: [
      creature('thanatos-hollow-crown', 14, FOCUS.might),
      creature('nightmare-stalker', 15, FOCUS.might),
      creature('abyssal-serpent', 15, FOCUS.bruiser),
      creature('ember-whelp', 15, FOCUS.might),
      creature('dusk-mite', 15, FOCUS.swift),
      creature('pebble-grub', 15, FOCUS.tank),
      creature('tide-minnow', 15, FOCUS.bruiser),
      creature('cinder-imp', 15, FOCUS.swift),
      creature('grave-moth', 15, FOCUS.swift),
      creature('reef-sentinel', 15, FOCUS.tank),
    ],
    effects: ['cinderbloom', 'ruinous-bolt', 'bonecage', 'shroud-of-ash'],
  },
];

/** The creatures a run begins with, and the names they are given. */
export const STARTER_ROSTER: ReadonlyArray<readonly [string, string]> = [
  ['ember-whelp', 'Cinderbite'],
  ['scrapfang-pup', 'Gnash'],
  ['thicket-hare', 'Flicker'],
  ['pebble-grub', 'Old Scar'],
  ['tide-minnow', 'Brine'],
  ['dusk-mite', 'Whisper'],
  ['gale-sprite', 'Zephyr'],
  ['ashfang-jackal', 'Ashfang'],
  ['cinder-imp', 'Ember'],
  ['reef-sentinel', 'Bulwark'],
];

export const STARTER_EFFECTS: readonly string[] = [
  'emberlash',
  'grave-draught',
  'whetstone-rite',
];

/**
 * XP per duel, scaled by how far in the duel is.
 *
 * Level costs rise steeply, so a flat award dumps a card from level 1 to 6 in
 * the opening duel and leaves the later level-up screens with nothing to
 * spend. This curve lands a common at roughly 4, 6, 8 and 10 across the four
 * screens between duels.
 */
export const RUN_XP = { base: 420, winMultiplier: 1.3 } as const;

export function duelXp(duelNumber: number, won: boolean): number {
  return Math.round(RUN_XP.base * duelNumber * (won ? RUN_XP.winMultiplier : 1));
}

/** A deck may never be culled below this. */
export const MIN_DECK = 12;
/** Nor below this many creatures, or there is nothing to put on the board. */
export const MIN_CREATURES = 7;
