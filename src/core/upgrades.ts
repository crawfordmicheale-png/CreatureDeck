/**
 * Upgrade paths.
 *
 * Growth points move numbers. Upgrades change what a creature *is*: every
 * fourth level a card offers two mutually exclusive paths, and the one you
 * take is permanent. Two players holding the same printed card and the same
 * level can now end up with genuinely different creatures rather than
 * differently weighted ones.
 *
 * The pairs are not hand-written per card — that would be 84 entries nobody
 * would keep consistent. Each milestone deterministically draws one offensive
 * option and one defensive or utility option from a shared pool, seeded by the
 * card id and the milestone, so a given card always offers the same choices
 * while different cards offer different ones.
 */

import type { Rarity } from './rarity.ts';
import { rarityProfile } from './rarity.ts';
import { seedFromString } from './rng.ts';
import type { StatBlock } from './stats.ts';

export const UPGRADE_KINDS = ['offence', 'defence', 'utility'] as const;

export type UpgradeKind = (typeof UPGRADE_KINDS)[number];

export interface UpgradeDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: UpgradeKind;
  readonly stats: Partial<StatBlock>;
  /** Ability this upgrade teaches, on top of the card's printed ones. */
  readonly grantsAbility?: string;
  readonly stamina?: number;
}

export const UPGRADES: readonly UpgradeDefinition[] = [
  // ----------------------------------------------------------- offence
  {
    id: 'hooked-fangs',
    name: 'Hooked Fangs',
    description: '+3 Might. Attacks ignore Guard.',
    kind: 'offence',
    stats: { might: 3 },
    grantsAbility: 'hunt',
  },
  {
    id: 'killing-habit',
    name: 'Killing Habit',
    description: '+2 Might. Grows stronger with every kill.',
    kind: 'offence',
    stats: { might: 2 },
    grantsAbility: 'bloodlust',
  },
  {
    id: 'burning-blood',
    name: 'Burning Blood',
    description: '+3 Might. Hits harder while above half health.',
    kind: 'offence',
    stats: { might: 3 },
    grantsAbility: 'ferocity',
  },
  {
    id: 'venom-glands',
    name: 'Venom Glands',
    description: '+2 Might. Attacks leave poison behind.',
    kind: 'offence',
    stats: { might: 2 },
    grantsAbility: 'venom',
  },
  {
    id: 'savage-rhythm',
    name: 'Savage Rhythm',
    description: '+1 Might. Strikes a second time each attack.',
    kind: 'offence',
    stats: { might: 1 },
    grantsAbility: 'doublestrike',
  },
  {
    id: 'reaving-edge',
    name: 'Reaving Edge',
    description: '+5 Might. Nothing subtle about it.',
    kind: 'offence',
    stats: { might: 5 },
  },
  {
    id: 'breaking-force',
    name: 'Breaking Force',
    description: '+3 Might. Excess damage carries through to the nexus.',
    kind: 'offence',
    stats: { might: 3 },
    grantsAbility: 'overwhelm',
  },

  // ----------------------------------------------------------- defence
  {
    id: 'ashen-hide',
    name: 'Ashen Hide',
    description: '+8 Vitality. Attackers take damage in return.',
    kind: 'defence',
    stats: { vitality: 8 },
    grantsAbility: 'thorns',
  },
  {
    id: 'deep-roots',
    name: 'Deep Roots',
    description: '+10 Vitality. Heals a little every turn.',
    kind: 'defence',
    stats: { vitality: 10 },
    grantsAbility: 'regrowth',
  },
  {
    id: 'stone-skin',
    name: 'Stone Skin',
    description: '+3 Guard. Takes less damage from every attack.',
    kind: 'defence',
    stats: { guard: 3 },
    grantsAbility: 'stoneform',
  },
  {
    id: 'warded-bones',
    name: 'Warded Bones',
    description: '+6 Vitality and +2 Guard. Plainly harder to kill.',
    kind: 'defence',
    stats: { vitality: 6, guard: 2 },
  },
  {
    id: 'standing-order',
    name: 'Standing Order',
    description: '+2 Guard. Shelters the creatures beside it.',
    kind: 'defence',
    stats: { guard: 2 },
    grantsAbility: 'bulwark',
  },
  {
    id: 'last-breath',
    name: 'Last Breath',
    description: '+4 Vitality. Returns once from the first death.',
    kind: 'defence',
    stats: { vitality: 4 },
    grantsAbility: 'rebirth',
  },

  // ----------------------------------------------------------- utility
  {
    id: 'quickened',
    name: 'Quickened',
    description: '+4 Speed. Much harder to land a blow on.',
    kind: 'utility',
    stats: { speed: 4 },
    grantsAbility: 'first-strike',
  },
  {
    id: 'long-wind',
    name: 'Long Wind',
    description: '+4 Vitality and one more use before it is spent.',
    kind: 'utility',
    stats: { vitality: 4 },
    stamina: 1,
  },
  {
    id: 'pack-call',
    name: 'Pack Call',
    description: '+2 Might. Rallies the creatures already on the board.',
    kind: 'utility',
    stats: { might: 2 },
    grantsAbility: 'rally',
  },
  {
    id: 'dread-presence',
    name: 'Dread Presence',
    description: '+2 Guard. Weakens the enemy board as it arrives.',
    kind: 'utility',
    stats: { guard: 2 },
    grantsAbility: 'dread',
  },
  {
    id: 'feeding-wound',
    name: 'Feeding Wound',
    description: '+2 Might. Heals for part of the damage it deals.',
    kind: 'utility',
    stats: { might: 2 },
    grantsAbility: 'siphon',
  },
  {
    id: 'second-heart',
    name: 'Second Heart',
    description: '+8 Vitality and one more use before it is spent.',
    kind: 'utility',
    stats: { vitality: 8 },
    stamina: 1,
  },
];

export const UPGRADE_BY_ID: ReadonlyMap<string, UpgradeDefinition> = new Map(
  UPGRADES.map((upgrade) => [upgrade.id, upgrade]),
);

export function upgradeById(id: string): UpgradeDefinition {
  const upgrade = UPGRADE_BY_ID.get(id);
  if (!upgrade) throw new Error(`Unknown upgrade "${id}".`);
  return upgrade;
}

/** Every fourth level, up to the rarity's cap. */
export function upgradeMilestones(rarity: Rarity): readonly number[] {
  const cap = rarityProfile(rarity).maxLevel;
  const levels: number[] = [];
  for (let level = 4; level <= cap; level += 4) levels.push(level);
  return levels;
}

/** How many upgrade choices a card of this rarity has unlocked by `level`. */
export function milestonesReached(rarity: Rarity, level: number): number {
  return upgradeMilestones(rarity).filter((milestone) => milestone <= level).length;
}

/**
 * The two paths offered at one milestone: always one offensive option against
 * one defensive or utility option, so the choice is a real fork rather than
 * two flavours of the same thing.
 *
 * Deterministic in `cardId` and `milestone`, and filtered so a card is never
 * offered an ability it already has.
 */
export function upgradeChoices(
  cardId: string,
  milestone: number,
  excludedAbilityIds: readonly string[],
  takenUpgradeIds: readonly string[],
): readonly [UpgradeDefinition, UpgradeDefinition] | null {
  const excluded = new Set(excludedAbilityIds);
  const taken = new Set(takenUpgradeIds);

  const usable = UPGRADES.filter(
    (upgrade) =>
      !taken.has(upgrade.id) &&
      (upgrade.grantsAbility === undefined || !excluded.has(upgrade.grantsAbility)),
  );

  const offence = usable.filter((upgrade) => upgrade.kind === 'offence');
  const other = usable.filter((upgrade) => upgrade.kind !== 'offence');
  if (offence.length === 0 || other.length === 0) return null;

  const seed = seedFromString(`${cardId}#${milestone}`);
  const left = offence[seed % offence.length] as UpgradeDefinition;
  const right = other[(seed >>> 8) % other.length] as UpgradeDefinition;
  return [left, right];
}

export function sumUpgradeStats(upgrades: readonly UpgradeDefinition[]): StatBlock {
  return upgrades.reduce<StatBlock>(
    (total, upgrade) => ({
      might: total.might + (upgrade.stats.might ?? 0),
      vitality: total.vitality + (upgrade.stats.vitality ?? 0),
      speed: total.speed + (upgrade.stats.speed ?? 0),
      guard: total.guard + (upgrade.stats.guard ?? 0),
    }),
    { might: 0, vitality: 0, speed: 0, guard: 0 },
  );
}

export function sumUpgradeStamina(upgrades: readonly UpgradeDefinition[]): number {
  return upgrades.reduce((total, upgrade) => total + (upgrade.stamina ?? 0), 0);
}
