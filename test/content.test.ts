import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ABILITIES, CREATURES, STANDARD_LIBRARY } from '../src/content/index.ts';
import { createCardInstance, resolveCard, startingTierOf } from '../src/core/cardInstance.ts';
import { trainTo } from '../src/core/leveling.ts';
import { POWER_TIERS, powerTierIndex } from '../src/core/powerTier.ts';
import { RARITIES, rarityIndex, rarityProfile } from '../src/core/rarity.ts';

const library = STANDARD_LIBRARY;

/** A fresh copy, as it would come out of a pack. */
function printed(definitionId: string) {
  return resolveCard(
    createCardInstance(library.getCard(definitionId), { instanceId: `${definitionId}-probe` }),
    library,
  );
}

/** The same card taken to its rarity's level cap, points spent evenly. */
function maxed(definitionId: string) {
  const definition = library.getCard(definitionId);
  const instance = createCardInstance(definition, { instanceId: `${definitionId}-max` });
  return resolveCard(
    trainTo(instance, rarityProfile(definition.rarity).maxLevel, ['might', 'vitality'], library),
    library,
  );
}

describe('the printed set', () => {
  it('has a card in every rarity', () => {
    for (const rarity of RARITIES) {
      assert.ok(
        CREATURES.some((card) => card.rarity === rarity),
        `no ${rarity} cards printed`,
      );
    }
  });

  it('gives every card a name, flavour and non-zero stats', () => {
    for (const card of CREATURES) {
      assert.ok(card.name.length > 0, `${card.id} has no name`);
      assert.ok(card.flavor.length > 0, `${card.id} has no flavour text`);
      assert.ok(card.baseStats.vitality > 0, `${card.id} has no health`);
      assert.ok(card.baseStats.might > 0, `${card.id} cannot attack`);
    }
  });

  it('never lists an ability twice on the same card, or unlocks out of order', () => {
    for (const card of CREATURES) {
      const seen = new Set<string>();
      let previous = 0;
      for (const slot of card.abilities) {
        assert.ok(!seen.has(slot.abilityId), `${card.id} lists ${slot.abilityId} twice`);
        seen.add(slot.abilityId);
        assert.ok(
          slot.unlockLevel >= previous,
          `${card.id} unlocks ${slot.abilityId} out of order`,
        );
        previous = slot.unlockLevel;
      }
    }
  });

  it('keeps every unlock level inside the rarity level cap', () => {
    for (const card of CREATURES) {
      const cap = rarityProfile(card.rarity).maxLevel;
      for (const slot of card.abilities) {
        assert.ok(
          slot.unlockLevel <= cap,
          `${card.id} unlocks ${slot.abilityId} at ${slot.unlockLevel}, past its cap of ${cap}`,
        );
      }
    }
  });

  it('gives every card at least one ability it can actually use', () => {
    for (const card of CREATURES) {
      assert.ok(card.abilities.length > 0, `${card.id} has no abilities`);
      assert.equal(
        card.abilities[0]?.unlockLevel,
        1,
        `${card.id} should have something online at level 1`,
      );
    }
  });

  it('uses every printed ability on at least one card', () => {
    const used = new Set(CREATURES.flatMap((card) => card.abilities.map((slot) => slot.abilityId)));
    for (const ability of ABILITIES) {
      assert.ok(used.has(ability.id), `${ability.id} is printed but on no card`);
    }
  });
});

describe('the power curve', () => {
  it('starts rarer cards at or above the tier of commoner ones', () => {
    const startingTier = (rarity: string) =>
      CREATURES.filter((card) => card.rarity === rarity).map((card) =>
        powerTierIndex(startingTierOf(card, library)),
      );

    for (let i = 1; i < RARITIES.length; i += 1) {
      const lower = startingTier(RARITIES[i - 1] as string);
      const higher = startingTier(RARITIES[i] as string);
      assert.ok(
        Math.min(...higher) >= Math.min(...lower),
        `${RARITIES[i]} should not start below ${RARITIES[i - 1]}`,
      );
    }
  });

  it('lets every card reach a higher tier than it was printed at', () => {
    for (const card of CREATURES) {
      const start = printed(card.id);
      const end = maxed(card.id);
      assert.ok(
        powerTierIndex(end.powerTier) > powerTierIndex(start.powerTier),
        `${card.id} never promotes: ${start.powerTier} -> ${end.powerTier}`,
      );
      assert.equal(end.promoted, true, `${card.id} should report itself promoted`);
    }
  });

  it('keeps a maxed card of one rarity from out-scaling a maxed card of the next', () => {
    const ceiling = (rarity: string) =>
      Math.max(
        ...CREATURES.filter((card) => card.rarity === rarity).map((card) => maxed(card.id).powerScore),
      );

    for (let i = 1; i < RARITIES.length; i += 1) {
      assert.ok(
        ceiling(RARITIES[i] as string) > ceiling(RARITIES[i - 1] as string),
        `${RARITIES[i]} should out-scale ${RARITIES[i - 1]} at the cap`,
      );
    }
  });

  it('lets a maxed common overtake an unlevelled card of any rarity', () => {
    // The whole promise of the levelling system: investment beats rarity alone.
    const bestCommon = Math.max(
      ...CREATURES.filter((card) => card.rarity === 'common').map((card) => maxed(card.id).powerScore),
    );
    const freshEpic = Math.min(
      ...CREATURES.filter((card) => card.rarity === 'epic').map((card) => printed(card.id).powerScore),
    );
    assert.ok(
      bestCommon > freshEpic,
      `a maxed common (${bestCommon}) should beat a fresh epic (${freshEpic})`,
    );
  });

  it('spreads the roster across most of the tier ladder when it is printed', () => {
    const tiers = new Set(CREATURES.map((card) => startingTierOf(card, library)));
    assert.ok(tiers.size >= 3, `printed cards only cover ${[...tiers].join(', ')}`);
    assert.ok(tiers.has('weak'), 'something should be printed at Weak');
    assert.ok(
      POWER_TIERS.some((tier) => tiers.has(tier) && powerTierIndex(tier) >= 3),
      'something should be printed at Legendary or above',
    );
  });

  it('prices higher tiers at a higher deploy cost on real cards', () => {
    const byTier = new Map<string, number>();
    for (const card of CREATURES) {
      const resolved = printed(card.id);
      const existing = byTier.get(resolved.powerTier);
      if (existing === undefined) byTier.set(resolved.powerTier, resolved.deployCost);
      else assert.equal(existing, resolved.deployCost, `${card.id} cost disagrees with its tier`);
    }
    assert.ok(byTier.size > 1);
  });

  it('keeps rarity and starting tier as genuinely separate axes', () => {
    // If they were the same axis, rarity would be redundant. Two cards of
    // different rarity should share a starting tier somewhere in the set.
    const pairs = CREATURES.map((card) => ({
      rarity: rarityIndex(card.rarity),
      tier: powerTierIndex(startingTierOf(card, library)),
    }));
    const sharedTier = pairs.some((a) =>
      pairs.some((b) => a.tier === b.tier && a.rarity !== b.rarity),
    );
    assert.ok(sharedTier, 'no two rarities share a starting tier');
  });
});
