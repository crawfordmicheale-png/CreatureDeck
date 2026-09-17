/**
 * Deck construction rules.
 *
 * The energy budget is the interesting constraint. Levelling a card raises its
 * power tier, which raises its deploy cost, which eats into the deck's total
 * budget — so a deck of maxed cards is genuinely slower to get onto the board
 * than a deck of fresh ones. Levelling everything is a real decision, not a
 * free upgrade.
 */

import type { CardInstance, ResolvedCard } from '../core/cardInstance.ts';
import { resolveCard } from '../core/cardInstance.ts';
import type { CardLibrary } from '../core/library.ts';

export interface DeckRules {
  readonly size: number;
  readonly maxCopiesPerCard: number;
  /** Total deploy cost allowed across the deck, or null for no cap. */
  readonly maxTotalDeployCost: number | null;
}

export const STANDARD_DECK_RULES: DeckRules = {
  size: 12,
  maxCopiesPerCard: 2,
  maxTotalDeployCost: 48,
};

/** Casual play: no energy budget, so any pile of twelve cards is legal. */
export const UNLIMITED_DECK_RULES: DeckRules = {
  size: 12,
  maxCopiesPerCard: 2,
  maxTotalDeployCost: null,
};

export interface Deck {
  readonly id: string;
  readonly name: string;
  readonly cardInstanceIds: readonly string[];
}

export interface DeckStats {
  readonly cards: readonly ResolvedCard[];
  readonly totalDeployCost: number;
  readonly averageDeployCost: number;
  readonly totalPowerScore: number;
  readonly averageLevel: number;
  readonly tierCounts: Readonly<Record<string, number>>;
  readonly rarityCounts: Readonly<Record<string, number>>;
}

export interface DeckValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly stats: DeckStats;
}

export function describeDeck(
  instances: readonly CardInstance[],
  library: CardLibrary,
): DeckStats {
  const cards = instances.map((instance) => resolveCard(instance, library));
  const totalDeployCost = cards.reduce((total, card) => total + card.deployCost, 0);
  const totalPowerScore = cards.reduce((total, card) => total + card.powerScore, 0);
  const totalLevel = cards.reduce((total, card) => total + card.level, 0);

  const tierCounts: Record<string, number> = {};
  const rarityCounts: Record<string, number> = {};
  for (const card of cards) {
    tierCounts[card.powerTier] = (tierCounts[card.powerTier] ?? 0) + 1;
    rarityCounts[card.definition.rarity] = (rarityCounts[card.definition.rarity] ?? 0) + 1;
  }

  return {
    cards,
    totalDeployCost,
    averageDeployCost: cards.length === 0 ? 0 : totalDeployCost / cards.length,
    totalPowerScore,
    averageLevel: cards.length === 0 ? 0 : totalLevel / cards.length,
    tierCounts,
    rarityCounts,
  };
}

export function validateDeck(
  instances: readonly CardInstance[],
  library: CardLibrary,
  rules: DeckRules = STANDARD_DECK_RULES,
): DeckValidation {
  const errors: string[] = [];
  const stats = describeDeck(instances, library);

  if (instances.length !== rules.size) {
    errors.push(`A deck must hold exactly ${rules.size} cards; this one has ${instances.length}.`);
  }

  const seenInstances = new Set<string>();
  for (const instance of instances) {
    if (seenInstances.has(instance.instanceId)) {
      errors.push(`The same card copy "${instance.instanceId}" appears more than once.`);
    }
    seenInstances.add(instance.instanceId);
  }

  const copies = new Map<string, number>();
  for (const instance of instances) {
    copies.set(instance.definitionId, (copies.get(instance.definitionId) ?? 0) + 1);
  }
  for (const [definitionId, count] of copies) {
    if (count > rules.maxCopiesPerCard) {
      const name = library.tryGetCard(definitionId)?.name ?? definitionId;
      errors.push(`${count} copies of ${name}; the limit is ${rules.maxCopiesPerCard}.`);
    }
  }

  if (rules.maxTotalDeployCost !== null && stats.totalDeployCost > rules.maxTotalDeployCost) {
    errors.push(
      `Total deploy cost ${stats.totalDeployCost} exceeds the ${rules.maxTotalDeployCost} budget.`,
    );
  }

  return { valid: errors.length === 0, errors, stats };
}
