/**
 * Rarity — how much *room to grow* a card has.
 *
 * Rarity is not a flat stat bonus. Two cards can start in the same power tier
 * and still be worlds apart, because rarity decides how far levelling can take
 * them: the level cap, how many growth points each level hands you, how fast
 * the card's own stats compound, and how many ability slots ever unlock.
 *
 * There is no hard ceiling on the power tier a rarity may reach. A perfectly
 * built common can out-punch a neglected mythic; it simply runs out of levels
 * long before a mythic runs out of headroom.
 */

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'mythic'] as const;

export type Rarity = (typeof RARITIES)[number];

export interface RarityProfile {
  readonly rarity: Rarity;
  readonly label: string;
  /** Highest level a card of this rarity can reach. */
  readonly maxLevel: number;
  /** Growth points granted on each level-up, for the player to allocate. */
  readonly growthPointsPerLevel: number;
  /**
   * Multiplier on the automatic, un-allocated stat growth a card gains per
   * level. Higher rarities compound their own base stats faster.
   */
  readonly innateGrowthMultiplier: number;
  /** Multiplier on the XP required for each level-up. */
  readonly xpMultiplier: number;
  /** How many of the card's listed abilities can ever be active at once. */
  readonly abilitySlots: number;
  /** Display colour hint for front-ends. */
  readonly color: string;
}

export const RARITY_PROFILES: Record<Rarity, RarityProfile> = {
  common: {
    rarity: 'common',
    label: 'Common',
    maxLevel: 10,
    growthPointsPerLevel: 2,
    innateGrowthMultiplier: 1.0,
    xpMultiplier: 1.0,
    abilitySlots: 1,
    color: '#9aa4b2',
  },
  uncommon: {
    rarity: 'uncommon',
    label: 'Uncommon',
    maxLevel: 14,
    growthPointsPerLevel: 3,
    innateGrowthMultiplier: 1.1,
    xpMultiplier: 1.2,
    abilitySlots: 1,
    color: '#4ea96b',
  },
  rare: {
    rarity: 'rare',
    label: 'Rare',
    maxLevel: 18,
    growthPointsPerLevel: 4,
    innateGrowthMultiplier: 1.25,
    xpMultiplier: 1.45,
    abilitySlots: 2,
    color: '#3f7ad1',
  },
  epic: {
    rarity: 'epic',
    label: 'Epic',
    maxLevel: 22,
    growthPointsPerLevel: 5,
    innateGrowthMultiplier: 1.4,
    xpMultiplier: 1.75,
    abilitySlots: 2,
    color: '#9a5fd0',
  },
  mythic: {
    rarity: 'mythic',
    label: 'Mythic',
    maxLevel: 26,
    growthPointsPerLevel: 6,
    innateGrowthMultiplier: 1.6,
    xpMultiplier: 2.1,
    abilitySlots: 3,
    color: '#d9803a',
  },
};

export function rarityProfile(rarity: Rarity): RarityProfile {
  return RARITY_PROFILES[rarity];
}

/** Position in the rarity ladder, 0 = common. */
export function rarityIndex(rarity: Rarity): number {
  return RARITIES.indexOf(rarity);
}

/** Total growth points a card of this rarity will have earned at `level`. */
export function totalGrowthPointsAtLevel(rarity: Rarity, level: number): number {
  const profile = RARITY_PROFILES[rarity];
  const clamped = Math.max(1, Math.min(level, profile.maxLevel));
  return (clamped - 1) * profile.growthPointsPerLevel;
}
