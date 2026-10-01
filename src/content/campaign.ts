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

/**
 * The warband has seen a little action before the map starts.
 *
 * Level-1 combat is degenerate: a creature's lifetime damage barely reaches a
 * peer's health, so almost nothing dies, lanes never open and the opening
 * fight grinds. Starting a notch above that makes the first node a fight
 * rather than a stalemate.
 */
export const STARTER_LEVEL = 3;

export const STARTER_EFFECTS: readonly string[] = [
  'emberlash',
  'grave-draught',
  'whetstone-rite',
];

/**
 * XP for one fight, scaled by how deep into the map it is.
 *
 * A route is about a dozen nodes, of which perhaps nine are fights, and level
 * costs rise steeply — so a flat award would dump a card most of the way up in
 * the opening rows and leave the rest of the climb with nothing to spend. This
 * curve lands a common near its cap by the boss, whichever route is taken.
 */
export const RUN_XP = { base: 130, perRow: 0.45, winMultiplier: 1.3, eliteBonus: 1.5 } as const;

export function duelXp(depth: number, won: boolean, elite = false): number {
  const depthScale = 1 + Math.max(0, depth) * RUN_XP.perRow;
  const outcome = won ? RUN_XP.winMultiplier : 1;
  const kind = elite ? RUN_XP.eliteBonus : 1;
  return Math.round(RUN_XP.base * depthScale * outcome * kind);
}

/** A rest node trades a fight for a smaller, guaranteed amount of training. */
export function restXp(depth: number): number {
  return Math.round(duelXp(depth, false) * 0.8);
}

/** A deck may never be culled below this. */
export const MIN_DECK = 12;
/** Nor below this many creatures, or there is nothing to put on the board. */
export const MIN_CREATURES = 7;
