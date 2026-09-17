/**
 * Power score — the single number that decides a card's power tier.
 *
 * The weights convert raw stats into a comparable currency. They are tuned so
 * that one growth point spent on any stat is worth roughly the same score,
 * which means a player focusing might is trading breadth for specialisation
 * rather than being punished for it.
 */

import type { StatBlock } from './stats.ts';

export const STAT_SCORE_WEIGHTS: StatBlock = {
  might: 2.2,
  vitality: 0.9,
  speed: 1.6,
  guard: 2.0,
};

/**
 * How much one allocated growth point moves each stat.
 *
 * `value * STAT_SCORE_WEIGHTS[stat]` is ~2.6 for every stat, so no allocation
 * is strictly better than another in score terms — only in play.
 */
export const STAT_POINT_VALUES: StatBlock = {
  might: 1.2,
  vitality: 3.0,
  speed: 1.6,
  guard: 1.3,
};

export function statScore(stats: StatBlock): number {
  return (
    stats.might * STAT_SCORE_WEIGHTS.might +
    stats.vitality * STAT_SCORE_WEIGHTS.vitality +
    stats.speed * STAT_SCORE_WEIGHTS.speed +
    stats.guard * STAT_SCORE_WEIGHTS.guard
  );
}

/**
 * Full power score: stats plus the weight of every *unlocked* ability.
 * Locked abilities contribute nothing, so unlocking one can by itself promote
 * a card to the next tier.
 */
export function powerScore(stats: StatBlock, abilityWeight: number): number {
  return Math.round(statScore(stats) + abilityWeight);
}
