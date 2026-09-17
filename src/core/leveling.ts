/**
 * Levelling: turning battle XP into levels, and levels into growth points the
 * player spends wherever they like.
 *
 * Nothing here decides *what* a card becomes — it only hands out the budget.
 * `allocate` is the other half, and it is entirely the player's call.
 */

import type { CardDefinition } from './cardDefinition.ts';
import { unlockedAbilitySlots } from './cardDefinition.ts';
import type { CardInstance } from './cardInstance.ts';
import type { CardLibrary } from './library.ts';
import { rarityProfile } from './rarity.ts';
import type { Rarity } from './rarity.ts';
import type { StatBlock, StatKey } from './stats.ts';
import { STAT_KEYS, createStats } from './stats.ts';

const XP_BASE = 40;
const XP_EXPONENT = 1.55;

/** XP required to get from `level` to `level + 1`. */
export function xpToNextLevel(rarity: Rarity, level: number): number {
  const profile = rarityProfile(rarity);
  if (level >= profile.maxLevel) return Infinity;
  return Math.round(XP_BASE * Math.pow(level, XP_EXPONENT) * profile.xpMultiplier);
}

/** Total XP to take a fresh copy from level 1 to `level`. */
export function totalXpForLevel(rarity: Rarity, level: number): number {
  let total = 0;
  for (let l = 1; l < level; l += 1) total += xpToNextLevel(rarity, l);
  return total;
}

export interface GrantXpResult {
  readonly instance: CardInstance;
  readonly levelsGained: number;
  readonly growthPointsGained: number;
  /** Ability ids that came online as a result of this XP grant. */
  readonly abilitiesUnlocked: readonly string[];
  /** XP that could not be used because the card is at max level. */
  readonly wastedXp: number;
}

export function grantXp(
  instance: CardInstance,
  amount: number,
  library: CardLibrary,
): GrantXpResult {
  const definition = library.getCard(instance.definitionId);
  const profile = rarityProfile(definition.rarity);
  const startLevel = instance.level;

  if (amount <= 0 || startLevel >= profile.maxLevel) {
    return {
      instance,
      levelsGained: 0,
      growthPointsGained: 0,
      abilitiesUnlocked: [],
      wastedXp: startLevel >= profile.maxLevel ? Math.max(0, amount) : 0,
    };
  }

  let level = startLevel;
  let xp = instance.xp + amount;

  while (level < profile.maxLevel) {
    const needed = xpToNextLevel(definition.rarity, level);
    if (xp < needed) break;
    xp -= needed;
    level += 1;
  }

  let wastedXp = 0;
  if (level >= profile.maxLevel) {
    wastedXp = xp;
    xp = 0;
  }

  const levelsGained = level - startLevel;
  const next: CardInstance = { ...instance, level, xp };

  return {
    instance: next,
    levelsGained,
    growthPointsGained: levelsGained * profile.growthPointsPerLevel,
    abilitiesUnlocked: abilitiesUnlockedBetween(definition, startLevel, level, library),
    wastedXp,
  };
}

function abilitiesUnlockedBetween(
  definition: CardDefinition,
  fromLevel: number,
  toLevel: number,
  library: CardLibrary,
): readonly string[] {
  if (toLevel <= fromLevel) return [];
  const before = new Set(unlockedAbilitySlots(definition, fromLevel).map((s) => s.abilityId));
  return unlockedAbilitySlots(definition, toLevel)
    .filter((slot) => !before.has(slot.abilityId))
    .map((slot) => {
      // Touch the library so a bad id fails loudly here rather than mid-battle.
      library.getAbility(slot.abilityId);
      return slot.abilityId;
    });
}

export interface AllocationError {
  readonly kind: 'overspend' | 'negative' | 'unknown-stat';
  readonly message: string;
}

export type AllocationResult =
  | { readonly ok: true; readonly instance: CardInstance }
  | { readonly ok: false; readonly error: AllocationError };

/**
 * Spend growth points. `delta` is per-stat and may be negative to pull points
 * back out — a full respec is `respec`, this is the surgical version.
 */
export function allocate(
  instance: CardInstance,
  delta: Partial<Record<StatKey, number>>,
  library: CardLibrary,
): AllocationResult {
  const definition = library.getCard(instance.definitionId);
  const profile = rarityProfile(definition.rarity);
  const budget = (Math.min(instance.level, profile.maxLevel) - 1) * profile.growthPointsPerLevel;

  const allocation = createStats(instance.allocation);
  for (const [key, value] of Object.entries(delta)) {
    if (!(STAT_KEYS as readonly string[]).includes(key)) {
      return { ok: false, error: { kind: 'unknown-stat', message: `Unknown stat "${key}".` } };
    }
    allocation[key as StatKey] += value ?? 0;
  }

  for (const key of STAT_KEYS) {
    if (allocation[key] < 0) {
      return {
        ok: false,
        error: {
          kind: 'negative',
          message: `Cannot hold fewer than zero points in ${key}.`,
        },
      };
    }
  }

  const spent = STAT_KEYS.reduce((total, key) => total + allocation[key], 0);
  if (spent > budget) {
    return {
      ok: false,
      error: {
        kind: 'overspend',
        message: `Tried to spend ${spent} growth points but only ${budget} are available at level ${instance.level}.`,
      },
    };
  }

  return { ok: true, instance: { ...instance, allocation } };
}

/** Pulls every point back out, ready to be spent again. */
export function respec(instance: CardInstance): CardInstance {
  return { ...instance, allocation: createStats() };
}

/**
 * Spend every unspent point across `focus`, round-robin. This is how the AI
 * builds its cards, and a reasonable "just do something sensible" button for a
 * front-end.
 */
export function autoAllocate(
  instance: CardInstance,
  focus: readonly StatKey[],
  library: CardLibrary,
): CardInstance {
  if (focus.length === 0) return instance;
  const definition = library.getCard(instance.definitionId);
  const profile = rarityProfile(definition.rarity);
  const budget = (Math.min(instance.level, profile.maxLevel) - 1) * profile.growthPointsPerLevel;
  const allocation = createStats(instance.allocation);
  let spent = STAT_KEYS.reduce((total, key) => total + allocation[key], 0);

  let i = 0;
  while (spent < budget) {
    const key = focus[i % focus.length] as StatKey;
    allocation[key] += 1;
    spent += 1;
    i += 1;
  }

  return { ...instance, allocation };
}

/** Convenience: level a card straight to `level` and spend its points on `focus`. */
export function trainTo(
  instance: CardInstance,
  level: number,
  focus: readonly StatKey[],
  library: CardLibrary,
): CardInstance {
  const definition = library.getCard(instance.definitionId);
  const profile = rarityProfile(definition.rarity);
  const target = Math.max(1, Math.min(level, profile.maxLevel));
  return autoAllocate({ ...instance, level: target, xp: 0 }, focus, library);
}

/** Growth points available but not yet spent. */
export function unspentPoints(instance: CardInstance, library: CardLibrary): number {
  const definition = library.getCard(instance.definitionId);
  const profile = rarityProfile(definition.rarity);
  const budget = (Math.min(instance.level, profile.maxLevel) - 1) * profile.growthPointsPerLevel;
  const spent = STAT_KEYS.reduce(
    (total, key) => total + (instance.allocation as StatBlock)[key],
    0,
  );
  return Math.max(0, budget - spent);
}
