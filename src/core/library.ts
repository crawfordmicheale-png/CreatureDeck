/**
 * A card library is the set of printed cards and abilities a game is played
 * with. Everything downstream (collections, decks, battles) takes a library
 * rather than importing the content module directly, so tests can run against
 * a three-card fixture and the real game against the full roster.
 */

import type { AbilityDefinition } from './abilities.ts';
import type { CardDefinition } from './cardDefinition.ts';

export interface CardLibrary {
  readonly cards: readonly CardDefinition[];
  readonly abilities: readonly AbilityDefinition[];
  getCard(id: string): CardDefinition;
  getAbility(id: string): AbilityDefinition;
  tryGetCard(id: string): CardDefinition | undefined;
  tryGetAbility(id: string): AbilityDefinition | undefined;
}

export function createLibrary(
  cards: readonly CardDefinition[],
  abilities: readonly AbilityDefinition[],
): CardLibrary {
  const cardsById = new Map<string, CardDefinition>();
  for (const card of cards) {
    if (cardsById.has(card.id)) throw new Error(`Duplicate card id "${card.id}" in library.`);
    cardsById.set(card.id, card);
  }

  const abilitiesById = new Map<string, AbilityDefinition>();
  for (const ability of abilities) {
    if (abilitiesById.has(ability.id)) {
      throw new Error(`Duplicate ability id "${ability.id}" in library.`);
    }
    abilitiesById.set(ability.id, ability);
  }

  for (const card of cards) {
    for (const slot of card.abilities) {
      if (!abilitiesById.has(slot.abilityId)) {
        throw new Error(`Card "${card.id}" references unknown ability "${slot.abilityId}".`);
      }
    }
  }

  return {
    cards,
    abilities,
    getCard(id) {
      const card = cardsById.get(id);
      if (!card) throw new Error(`Unknown card id "${id}".`);
      return card;
    },
    getAbility(id) {
      const ability = abilitiesById.get(id);
      if (!ability) throw new Error(`Unknown ability id "${id}".`);
      return ability;
    },
    tryGetCard: (id) => cardsById.get(id),
    tryGetAbility: (id) => abilitiesById.get(id),
  };
}
