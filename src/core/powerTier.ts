/**
 * Power tiers — what a card is *right now*.
 *
 * Every card is printed at a starting power tier, but the tier is not a fixed
 * label: it is read off the card's power score, which climbs as the card
 * levels. Push a creature's stats far enough and it is promoted, permanently,
 * to the next tier.
 *
 * Promotion is not free. A higher tier hits harder, but it also costs more
 * energy to deploy, so a heavily levelled board is slower to get going than a
 * cheap one. That tension is what keeps low-rarity cards playable.
 */

export const POWER_TIERS = ['weak', 'normal', 'elite', 'legendary', 'ascendant'] as const;

export type PowerTier = (typeof POWER_TIERS)[number];

export interface PowerTierProfile {
  readonly tier: PowerTier;
  readonly label: string;
  /** Lowest power score that qualifies for this tier. */
  readonly minScore: number;
  /** Energy needed to deploy a card of this tier. */
  readonly deployCost: number;
  /** Flat bonus damage added to every attack. */
  readonly attackBonus: number;
  /** Flat bonus health granted on deployment. */
  readonly healthBonus: number;
  readonly color: string;
}

/**
 * Tier bands. Kept in ascending order; `powerTierForScore` walks them
 * backwards, so adding a tier here is all that a new band requires.
 */
export const POWER_TIER_PROFILES: Record<PowerTier, PowerTierProfile> = {
  weak: {
    tier: 'weak',
    label: 'Weak',
    minScore: 0,
    deployCost: 1,
    attackBonus: 0,
    healthBonus: 0,
    color: '#8b8b8b',
  },
  normal: {
    tier: 'normal',
    label: 'Normal',
    minScore: 60,
    deployCost: 2,
    attackBonus: 1,
    healthBonus: 2,
    color: '#d4d4d4',
  },
  elite: {
    tier: 'elite',
    label: 'Elite',
    minScore: 125,
    deployCost: 4,
    attackBonus: 3,
    healthBonus: 6,
    color: '#5aa9e6',
  },
  legendary: {
    tier: 'legendary',
    label: 'Legendary',
    minScore: 240,
    deployCost: 6,
    attackBonus: 6,
    healthBonus: 14,
    color: '#f2c14e',
  },
  ascendant: {
    tier: 'ascendant',
    label: 'Ascendant',
    minScore: 420,
    deployCost: 9,
    attackBonus: 10,
    healthBonus: 26,
    color: '#ff7043',
  },
};

/** Ascending by `minScore`. */
const TIERS_BY_SCORE: readonly PowerTierProfile[] = POWER_TIERS.map(
  (tier) => POWER_TIER_PROFILES[tier],
);

export function powerTierForScore(score: number): PowerTier {
  for (let i = TIERS_BY_SCORE.length - 1; i >= 0; i -= 1) {
    const profile = TIERS_BY_SCORE[i] as PowerTierProfile;
    if (score >= profile.minScore) return profile.tier;
  }
  return 'weak';
}

export function powerTierProfile(tier: PowerTier): PowerTierProfile {
  return POWER_TIER_PROFILES[tier];
}

export function powerTierIndex(tier: PowerTier): number {
  return POWER_TIERS.indexOf(tier);
}

export function comparePowerTiers(a: PowerTier, b: PowerTier): number {
  return powerTierIndex(a) - powerTierIndex(b);
}

/** The tier above `tier`, or null if it is already the top of the ladder. */
export function nextPowerTier(tier: PowerTier): PowerTier | null {
  const next = POWER_TIERS[powerTierIndex(tier) + 1];
  return next ?? null;
}

/**
 * Power score still needed to reach the next tier, or null at the top tier.
 * Front-ends use this to draw the "progress to promotion" bar.
 */
export function scoreToNextTier(score: number): number | null {
  const next = nextPowerTier(powerTierForScore(score));
  if (next === null) return null;
  return Math.max(0, POWER_TIER_PROFILES[next].minScore - score);
}
