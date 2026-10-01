/**
 * A card *instance* is one player's copy of a printed card.
 *
 * This is where two Ember Whelps stop being the same card. The instance holds
 * the level, the XP, and — the important part — the allocation: which stats
 * this player chose to pour their growth points into. Same definition, same
 * starting tier, wildly different creature by level 10.
 */

import type { AbilityDefinition } from './abilities.ts';
import type { CardDefinition } from './cardDefinition.ts';
import { nextAbilityUnlock, unlockedAbilitySlots } from './cardDefinition.ts';
import type { CardLibrary } from './library.ts';
import type { PowerTier, PowerTierProfile } from './powerTier.ts';
import { powerTierForScore, powerTierProfile, scoreToNextTier } from './powerTier.ts';
import type { RarityProfile } from './rarity.ts';
import { rarityProfile, totalGrowthPointsAtLevel } from './rarity.ts';
import { powerScore } from './scoring.ts';
import type { UpgradeDefinition } from './upgrades.ts';
import {
  milestonesReached,
  sumUpgradeStamina,
  sumUpgradeStats,
  upgradeById,
  upgradeChoices,
  upgradeMilestones,
} from './upgrades.ts';
import { staminaFor } from './cardDefinition.ts';
import { STAT_POINT_VALUES } from './scoring.ts';
import type { StatBlock, StatKey } from './stats.ts';
import { STAT_KEYS, createStats, roundStats } from './stats.ts';

/**
 * Fraction of its own base stats a card gains automatically per level, before
 * the rarity multiplier. A tanky creature therefore grows tanky on its own,
 * and the player's allocation is what bends it away from that default.
 */
export const INNATE_GROWTH_RATE = 0.08;

export interface CardInstance {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly level: number;
  /** XP banked toward the next level, not lifetime XP. */
  readonly xp: number;
  /** Growth points spent per stat. */
  readonly allocation: StatBlock;
  /** Upgrade ids taken, one per milestone reached, in milestone order. */
  readonly upgrades: readonly string[];
  readonly nickname: string | null;
  readonly battlesFought: number;
}

export interface CreateInstanceOptions {
  instanceId?: string;
  level?: number;
  xp?: number;
  allocation?: Partial<StatBlock>;
  upgrades?: readonly string[];
  nickname?: string | null;
  battlesFought?: number;
}

let instanceCounter = 0;

/** Test hook: makes generated instance ids reproducible. */
export function resetInstanceIds(): void {
  instanceCounter = 0;
}

export function createCardInstance(
  definition: CardDefinition,
  options: CreateInstanceOptions = {},
): CardInstance {
  instanceCounter += 1;
  const maxLevel = rarityProfile(definition.rarity).maxLevel;
  const level = clamp(options.level ?? 1, 1, maxLevel);
  return {
    instanceId: options.instanceId ?? `${definition.id}#${instanceCounter}`,
    definitionId: definition.id,
    level,
    xp: Math.max(0, options.xp ?? 0),
    allocation: createStats(options.allocation ?? {}),
    upgrades: options.upgrades ?? [],
    nickname: options.nickname ?? null,
    battlesFought: options.battlesFought ?? 0,
  };
}

/** A card instance with every derived number worked out. */
export interface ResolvedCard {
  readonly instance: CardInstance;
  readonly definition: CardDefinition;
  readonly rarity: RarityProfile;
  readonly displayName: string;
  readonly level: number;
  readonly isMaxLevel: boolean;
  /** Final stats used in battle, rounded to integers. */
  readonly stats: StatBlock;
  /** The stat gains that came from levelling alone, with nothing allocated. */
  readonly innateGains: StatBlock;
  /** The stat gains bought with growth points. */
  readonly allocatedGains: StatBlock;
  readonly abilities: readonly AbilityDefinition[];
  readonly lockedAbilities: readonly AbilityDefinition[];
  readonly abilityWeight: number;
  readonly powerScore: number;
  readonly powerTier: PowerTier;
  readonly tier: PowerTierProfile;
  /** The tier this card is printed at — what every fresh copy starts as. */
  readonly startingPowerTier: PowerTier;
  readonly promoted: boolean;
  readonly scoreToNextTier: number | null;
  readonly deployCost: number;
  readonly pointsEarned: number;
  readonly pointsSpent: number;
  readonly pointsUnspent: number;
  readonly nextUnlockLevel: number | null;
  /** Upgrades already taken, in the order they were chosen. */
  readonly upgrades: readonly UpgradeDefinition[];
  /** Milestones reached but not yet spent. */
  readonly pendingUpgrades: number;
  /** The fork waiting to be decided, or null when nothing is pending. */
  readonly upgradeChoice: readonly [UpgradeDefinition, UpgradeDefinition] | null;
  /** Level of the next milestone, or null once they are all unlocked. */
  readonly nextUpgradeLevel: number | null;
  readonly stamina: number;
}

export function resolveCard(instance: CardInstance, library: CardLibrary): ResolvedCard {
  const definition = library.getCard(instance.definitionId);
  const rarity = rarityProfile(definition.rarity);
  const level = clamp(instance.level, 1, rarity.maxLevel);

  const innateGains = computeInnateGains(definition, level);
  const allocatedGains = computeAllocatedGains(instance.allocation);

  const taken = instance.upgrades.map(upgradeById);
  const upgradeGains = sumUpgradeStats(taken);

  const stats = roundStats({
    might:
      definition.baseStats.might + innateGains.might + allocatedGains.might + upgradeGains.might,
    vitality:
      definition.baseStats.vitality +
      innateGains.vitality +
      allocatedGains.vitality +
      upgradeGains.vitality,
    speed:
      definition.baseStats.speed + innateGains.speed + allocatedGains.speed + upgradeGains.speed,
    guard:
      definition.baseStats.guard + innateGains.guard + allocatedGains.guard + upgradeGains.guard,
  });

  const unlockedSlots = unlockedAbilitySlots(definition, level);
  const unlockedIds = new Set(unlockedSlots.map((slot) => slot.abilityId));
  const printedAbilities = unlockedSlots.map((slot) => library.getAbility(slot.abilityId));

  // Upgrades teach abilities on top of the printed ones, which is how a
  // levelled card ends up doing something its twin does not.
  const taughtIds = taken
    .map((upgrade) => upgrade.grantsAbility)
    .filter((id): id is string => id !== undefined && !unlockedIds.has(id));
  const abilities = [...printedAbilities, ...taughtIds.map((id) => library.getAbility(id))];
  const lockedAbilities = definition.abilities
    .filter((slot) => !unlockedIds.has(slot.abilityId))
    .map((slot) => library.getAbility(slot.abilityId));
  const abilityWeight = abilities.reduce((total, ability) => total + ability.weight, 0);

  const score = powerScore(stats, abilityWeight);
  const tierKey = powerTierForScore(score);
  const startingPowerTier = startingTierOf(definition, library);

  const pointsEarned = totalGrowthPointsAtLevel(definition.rarity, level);
  const pointsSpent = STAT_KEYS.reduce((total, key) => total + instance.allocation[key], 0);

  const reached = milestonesReached(definition.rarity, level);
  const pendingUpgrades = Math.max(0, reached - taken.length);
  const nextMilestone = upgradeMilestones(definition.rarity)[taken.length];
  const upgradeChoice =
    pendingUpgrades > 0 && nextMilestone !== undefined
      ? upgradeChoices(
          definition.id,
          nextMilestone,
          [...unlockedIds, ...taughtIds],
          instance.upgrades,
        )
      : null;

  return {
    instance,
    definition,
    rarity,
    displayName: instance.nickname ?? definition.name,
    level,
    isMaxLevel: level >= rarity.maxLevel,
    stats,
    innateGains: roundStats(innateGains),
    allocatedGains: roundStats(allocatedGains),
    abilities,
    lockedAbilities,
    abilityWeight,
    powerScore: score,
    powerTier: tierKey,
    tier: powerTierProfile(tierKey),
    startingPowerTier,
    promoted: tierKey !== startingPowerTier,
    scoreToNextTier: scoreToNextTier(score),
    deployCost: powerTierProfile(tierKey).deployCost,
    pointsEarned,
    pointsSpent,
    pointsUnspent: Math.max(0, pointsEarned - pointsSpent),
    nextUnlockLevel: nextAbilityUnlock(definition, level)?.unlockLevel ?? null,
    upgrades: taken,
    pendingUpgrades,
    upgradeChoice,
    nextUpgradeLevel:
      upgradeMilestones(definition.rarity).find((milestone) => milestone > level) ?? null,
    stamina: staminaFor(definition.rarity, level) + sumUpgradeStamina(taken),
  };
}

/** The power tier a freshly opened copy of this card sits at. */
export function startingTierOf(definition: CardDefinition, library: CardLibrary): PowerTier {
  const weight = unlockedAbilitySlots(definition, 1)
    .map((slot) => library.getAbility(slot.abilityId))
    .reduce((total, ability) => total + ability.weight, 0);
  return powerTierForScore(powerScore(roundStats(definition.baseStats), weight));
}

export function computeInnateGains(definition: CardDefinition, level: number): StatBlock {
  const rarity = rarityProfile(definition.rarity);
  const factor = INNATE_GROWTH_RATE * rarity.innateGrowthMultiplier * (level - 1);
  return {
    might: definition.baseStats.might * factor,
    vitality: definition.baseStats.vitality * factor,
    speed: definition.baseStats.speed * factor,
    guard: definition.baseStats.guard * factor,
  };
}

export function computeAllocatedGains(allocation: StatBlock): StatBlock {
  return {
    might: allocation.might * STAT_POINT_VALUES.might,
    vitality: allocation.vitality * STAT_POINT_VALUES.vitality,
    speed: allocation.speed * STAT_POINT_VALUES.speed,
    guard: allocation.guard * STAT_POINT_VALUES.guard,
  };
}

/**
 * Score a hypothetical build without mutating anything — used by the planner
 * in the CLI and by any UI that wants to preview "what if I put 4 more points
 * into guard?".
 */
export function previewAllocation(
  instance: CardInstance,
  library: CardLibrary,
  delta: Partial<Record<StatKey, number>>,
): ResolvedCard {
  const allocation = createStats(instance.allocation);
  for (const key of STAT_KEYS) {
    allocation[key] = Math.max(0, allocation[key] + (delta[key] ?? 0));
  }
  return resolveCard({ ...instance, allocation }, library);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
