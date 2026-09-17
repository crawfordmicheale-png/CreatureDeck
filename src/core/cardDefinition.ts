/**
 * A card *definition* is the printed card: the thing every copy in every
 * collection starts out as. Two players opening the same pack get identical
 * Ember Whelps — identical stats, identical starting power tier.
 *
 * Everything that makes one player's Ember Whelp different from another's
 * lives in `CardInstance`, never here.
 */

import type { Rarity } from './rarity.ts';
import { RARITY_PROFILES } from './rarity.ts';
import type { StatBlock } from './stats.ts';
import { createStats } from './stats.ts';

export const CREATURE_FAMILIES = [
  'beast',
  'ember',
  'tide',
  'verdant',
  'stone',
  'shade',
  'aether',
] as const;

export type CreatureFamily = (typeof CREATURE_FAMILIES)[number];

export interface AbilitySlot {
  readonly abilityId: string;
  /** Level at which this ability comes online. Slot 1 is normally level 1. */
  readonly unlockLevel: number;
}

export interface CardDefinition {
  readonly id: string;
  readonly name: string;
  readonly rarity: Rarity;
  readonly family: CreatureFamily;
  /** Stats at level 1, before any growth. */
  readonly baseStats: StatBlock;
  /** Listed in unlock order. More may be listed than rarity has slots for. */
  readonly abilities: readonly AbilitySlot[];
  readonly flavor: string;
}

export function defineCard(definition: {
  id: string;
  name: string;
  rarity: Rarity;
  family: CreatureFamily;
  baseStats: Partial<StatBlock>;
  abilities?: readonly AbilitySlot[];
  flavor: string;
}): CardDefinition {
  const abilities = definition.abilities ?? [];
  const slots = RARITY_PROFILES[definition.rarity].abilitySlots;
  if (abilities.length > slots) {
    throw new Error(
      `Card "${definition.id}" lists ${abilities.length} abilities but ${definition.rarity} rarity has only ${slots} slot(s).`,
    );
  }
  return {
    id: definition.id,
    name: definition.name,
    rarity: definition.rarity,
    family: definition.family,
    baseStats: createStats(definition.baseStats),
    abilities,
    flavor: definition.flavor,
  };
}

/** Ability slots unlocked at a given level. */
export function unlockedAbilitySlots(
  definition: CardDefinition,
  level: number,
): readonly AbilitySlot[] {
  const slots = RARITY_PROFILES[definition.rarity].abilitySlots;
  return definition.abilities.filter((slot) => slot.unlockLevel <= level).slice(0, slots);
}

/** The next ability this card will unlock, or null if none remain. */
export function nextAbilityUnlock(definition: CardDefinition, level: number): AbilitySlot | null {
  const slots = RARITY_PROFILES[definition.rarity].abilitySlots;
  const reachable = definition.abilities.slice(0, slots);
  return reachable.find((slot) => slot.unlockLevel > level) ?? null;
}
