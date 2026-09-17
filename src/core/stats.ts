/**
 * The four stats every creature has.
 *
 * `might` is the attack stat; it is deliberately *not* called "power" so it
 * never gets confused with a card's power tier.
 */

export const STAT_KEYS = ['might', 'vitality', 'speed', 'guard'] as const;

export type StatKey = (typeof STAT_KEYS)[number];

export type StatBlock = Record<StatKey, number>;

export const STAT_LABELS: Record<StatKey, string> = {
  might: 'Might',
  vitality: 'Vitality',
  speed: 'Speed',
  guard: 'Guard',
};

export const STAT_DESCRIPTIONS: Record<StatKey, string> = {
  might: 'Damage dealt per attack.',
  vitality: 'Maximum health.',
  speed: 'Acting order in combat, and the odds of slipping a blow.',
  guard: 'Flat damage reduction on every hit taken.',
};

export function createStats(values: Partial<StatBlock> = {}): StatBlock {
  return {
    might: values.might ?? 0,
    vitality: values.vitality ?? 0,
    speed: values.speed ?? 0,
    guard: values.guard ?? 0,
  };
}

export function cloneStats(stats: StatBlock): StatBlock {
  return { might: stats.might, vitality: stats.vitality, speed: stats.speed, guard: stats.guard };
}

export function addStats(a: StatBlock, b: StatBlock): StatBlock {
  return {
    might: a.might + b.might,
    vitality: a.vitality + b.vitality,
    speed: a.speed + b.speed,
    guard: a.guard + b.guard,
  };
}

export function scaleStats(stats: StatBlock, factor: number): StatBlock {
  return {
    might: stats.might * factor,
    vitality: stats.vitality * factor,
    speed: stats.speed * factor,
    guard: stats.guard * factor,
  };
}

export function roundStats(stats: StatBlock): StatBlock {
  return {
    might: Math.round(stats.might),
    vitality: Math.round(stats.vitality),
    speed: Math.round(stats.speed),
    guard: Math.round(stats.guard),
  };
}

export function sumStats(stats: StatBlock): number {
  return stats.might + stats.vitality + stats.speed + stats.guard;
}

export function isStatKey(value: string): value is StatKey {
  return (STAT_KEYS as readonly string[]).includes(value);
}
