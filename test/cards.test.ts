import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STANDARD_LIBRARY } from '../src/content/index.ts';
import { defineCard, nextAbilityUnlock, unlockedAbilitySlots } from '../src/core/cardDefinition.ts';
import {
  createCardInstance,
  previewAllocation,
  resolveCard,
  startingTierOf,
} from '../src/core/cardInstance.ts';
import {
  allocate,
  autoAllocate,
  grantXp,
  respec,
  totalXpForLevel,
  trainTo,
  unspentPoints,
  xpToNextLevel,
} from '../src/core/leveling.ts';
import { rarityProfile } from '../src/core/rarity.ts';
import { STAT_KEYS } from '../src/core/stats.ts';

const library = STANDARD_LIBRARY;

function fresh(definitionId: string, instanceId: string) {
  return createCardInstance(library.getCard(definitionId), { instanceId });
}

describe('card definitions', () => {
  it('refuses more abilities than the rarity has slots for', () => {
    assert.throws(
      () =>
        defineCard({
          id: 'overloaded',
          name: 'Overloaded',
          rarity: 'common',
          family: 'beast',
          baseStats: { might: 1 },
          abilities: [
            { abilityId: 'ferocity', unlockLevel: 1 },
            { abilityId: 'venom', unlockLevel: 2 },
          ],
          flavor: '',
        }),
      /only 1 slot/,
    );
  });

  it('unlocks abilities by level, capped by the rarity slot count', () => {
    const roc = library.getCard('stormcaller-roc');
    assert.equal(unlockedAbilitySlots(roc, 1).length, 1);
    assert.equal(unlockedAbilitySlots(roc, 5).length, 1);
    assert.equal(unlockedAbilitySlots(roc, 6).length, 2);
    assert.equal(nextAbilityUnlock(roc, 1)?.unlockLevel, 6);
    assert.equal(nextAbilityUnlock(roc, 6), null);
  });
});

describe('every copy of a card starts identical', () => {
  it('resolves two fresh copies of the same card to the same numbers', () => {
    for (const definition of library.cards) {
      const mine = resolveCard(fresh(definition.id, 'mine'), library);
      const yours = resolveCard(fresh(definition.id, 'yours'), library);
      assert.deepEqual(mine.stats, yours.stats, `${definition.id} stats`);
      assert.equal(mine.powerScore, yours.powerScore, `${definition.id} score`);
      assert.equal(mine.powerTier, yours.powerTier, `${definition.id} tier`);
      assert.equal(mine.deployCost, yours.deployCost, `${definition.id} cost`);
    }
  });

  it('reports a printed starting tier that a fresh copy actually sits at', () => {
    for (const definition of library.cards) {
      const card = resolveCard(fresh(definition.id, 'x'), library);
      assert.equal(card.powerTier, startingTierOf(definition, library), definition.id);
      assert.equal(card.promoted, false, `${definition.id} should not start promoted`);
    }
  });
});

describe('levelling differentiates copies', () => {
  it('turns one printed card into genuinely different creatures', () => {
    const brute = resolveCard(trainTo(fresh('ember-whelp', 'brute'), 10, ['might'], library), library);
    const wall = resolveCard(
      trainTo(fresh('ember-whelp', 'wall'), 10, ['vitality', 'guard'], library),
      library,
    );

    assert.ok(brute.stats.might > wall.stats.might * 2, 'the brute should out-hit the wall');
    assert.ok(wall.stats.vitality > brute.stats.vitality, 'the wall should out-last the brute');
    assert.ok(wall.stats.guard > brute.stats.guard);

    // Same printed card, same investment, so the same tier and the same cost.
    assert.equal(brute.powerTier, wall.powerTier);
    assert.equal(brute.deployCost, wall.deployCost);
    assert.ok(
      Math.abs(brute.powerScore - wall.powerScore) <= 5,
      `builds should be score-equivalent, got ${brute.powerScore} and ${wall.powerScore}`,
    );
  });

  it('promotes a card through power tiers as it levels', () => {
    const whelp = fresh('ember-whelp', 'whelp');
    const atOne = resolveCard(whelp, library);
    const atTen = resolveCard(trainTo(whelp, 10, ['might'], library), library);

    assert.equal(atOne.powerTier, 'weak');
    assert.equal(atTen.powerTier, 'elite');
    assert.equal(atTen.promoted, true);
    assert.ok(atTen.deployCost > atOne.deployCost, 'promotion must cost more energy');
    assert.equal(atTen.startingPowerTier, 'weak');
  });

  it('lets rarity decide how far a card can go', () => {
    const maxed = library.cards.map((definition) => {
      const level = rarityProfile(definition.rarity).maxLevel;
      return {
        rarity: definition.rarity,
        score: resolveCard(
          trainTo(fresh(definition.id, definition.id), level, ['might', 'vitality'], library),
          library,
        ).powerScore,
      };
    });

    const best = (rarity: string) =>
      Math.max(...maxed.filter((entry) => entry.rarity === rarity).map((entry) => entry.score));

    assert.ok(best('uncommon') > best('common'));
    assert.ok(best('rare') > best('uncommon'));
    assert.ok(best('epic') > best('rare'));
    assert.ok(best('mythic') > best('epic'));
  });

  it('unlocking an ability raises the power score on its own', () => {
    const roc = fresh('stormcaller-roc', 'roc');
    const locked = resolveCard({ ...roc, level: 5 }, library);
    const unlocked = resolveCard({ ...roc, level: 6 }, library);
    assert.equal(locked.abilities.length, 1);
    assert.equal(unlocked.abilities.length, 2);
    assert.ok(unlocked.abilityWeight > locked.abilityWeight);
  });

  it('previews an allocation without changing the instance', () => {
    const whelp = { ...fresh('ember-whelp', 'preview'), level: 10 };
    const preview = previewAllocation(whelp, library, { might: 5 });
    assert.equal(whelp.allocation.might, 0);
    assert.ok(preview.stats.might > resolveCard(whelp, library).stats.might);
  });
});

describe('xp and growth points', () => {
  it('makes each level cost more than the last, and more for rarer cards', () => {
    for (let level = 1; level < 9; level += 1) {
      assert.ok(
        xpToNextLevel('common', level + 1) > xpToNextLevel('common', level),
        `level ${level}`,
      );
      assert.ok(xpToNextLevel('mythic', level) > xpToNextLevel('common', level), `rarity ${level}`);
    }
    assert.equal(xpToNextLevel('common', 10), Infinity, 'no XP is owed past the cap');
    assert.ok(totalXpForLevel('common', 10) > totalXpForLevel('common', 5));
  });

  it('levels up as far as the XP goes, banking the remainder', () => {
    const instance = fresh('ember-whelp', 'xp');
    const result = grantXp(instance, xpToNextLevel('common', 1) + 5, library);
    assert.equal(result.levelsGained, 1);
    assert.equal(result.instance.level, 2);
    assert.equal(result.instance.xp, 5);
    assert.equal(result.growthPointsGained, rarityProfile('common').growthPointsPerLevel);
  });

  it('crosses several levels in one award and reports the abilities that came online', () => {
    const roc = fresh('stormcaller-roc', 'roc-xp');
    const result = grantXp(roc, 100000, library);
    assert.equal(result.instance.level, rarityProfile('rare').maxLevel);
    assert.ok(result.levelsGained > 1);
    assert.deepEqual(result.abilitiesUnlocked, ['overwhelm']);
  });

  it('wastes XP once a card is capped', () => {
    const capped = { ...fresh('ember-whelp', 'capped'), level: 10 };
    const result = grantXp(capped, 5000, library);
    assert.equal(result.levelsGained, 0);
    assert.equal(result.wastedXp, 5000);
    assert.equal(result.instance.xp, 0);
  });

  it('ignores non-positive awards', () => {
    const instance = fresh('ember-whelp', 'zero');
    assert.equal(grantXp(instance, 0, library).instance, instance);
    assert.equal(grantXp(instance, -100, library).levelsGained, 0);
  });
});

describe('allocation', () => {
  it('spends points and refuses to overspend', () => {
    const instance = { ...fresh('ember-whelp', 'alloc'), level: 3 }; // 4 points available
    const ok = allocate(instance, { might: 4 }, library);
    assert.equal(ok.ok, true);

    const tooMany = allocate(instance, { might: 5 }, library);
    assert.equal(tooMany.ok, false);
    if (!tooMany.ok) assert.equal(tooMany.error.kind, 'overspend');
  });

  it('refuses to hold negative points and unknown stats', () => {
    const instance = { ...fresh('ember-whelp', 'neg'), level: 5 };
    const negative = allocate(instance, { guard: -1 }, library);
    assert.equal(negative.ok, false);
    if (!negative.ok) assert.equal(negative.error.kind, 'negative');

    const unknown = allocate(instance, { charisma: 1 } as never, library);
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.error.kind, 'unknown-stat');
  });

  it('pulls points back out on respec', () => {
    const trained = trainTo(fresh('ember-whelp', 'respec'), 10, ['might'], library);
    assert.equal(unspentPoints(trained, library), 0);
    const blank = respec(trained);
    assert.equal(unspentPoints(blank, library), 18);
    assert.deepEqual(
      STAT_KEYS.map((key) => blank.allocation[key]),
      [0, 0, 0, 0],
    );
  });

  it('spends exactly the budget round-robin, and never more', () => {
    const instance = { ...fresh('reef-sentinel', 'auto'), level: 14 };
    const allocated = autoAllocate(instance, ['vitality', 'guard'], library);
    const spent = STAT_KEYS.reduce((total, key) => total + allocated.allocation[key], 0);
    assert.equal(spent, 13 * rarityProfile('uncommon').growthPointsPerLevel);
    assert.equal(unspentPoints(allocated, library), 0);
    assert.equal(allocated.allocation.might, 0);
    assert.equal(allocated.allocation.speed, 0);
  });

  it('leaves an instance untouched when there is nothing to spend', () => {
    const instance = fresh('ember-whelp', 'level-one');
    assert.equal(unspentPoints(instance, library), 0);
    assert.deepEqual(autoAllocate(instance, ['might'], library).allocation, instance.allocation);
  });

  it('clamps training to the rarity level cap', () => {
    const overshoot = trainTo(fresh('ember-whelp', 'overshoot'), 99, ['might'], library);
    assert.equal(overshoot.level, rarityProfile('common').maxLevel);
  });
});
