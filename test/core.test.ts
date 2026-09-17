import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createLibrary } from '../src/core/library.ts';
import { defineAbility } from '../src/core/abilities.ts';
import { defineCard } from '../src/core/cardDefinition.ts';
import {
  POWER_TIERS,
  comparePowerTiers,
  nextPowerTier,
  powerTierForScore,
  powerTierIndex,
  powerTierProfile,
  scoreToNextTier,
} from '../src/core/powerTier.ts';
import { RARITIES, rarityIndex, rarityProfile, totalGrowthPointsAtLevel } from '../src/core/rarity.ts';
import { createRng, seedFromString } from '../src/core/rng.ts';
import { STAT_POINT_VALUES, STAT_SCORE_WEIGHTS, powerScore, statScore } from '../src/core/scoring.ts';
import { STAT_KEYS, addStats, createStats, roundStats, scaleStats } from '../src/core/stats.ts';

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const left = Array.from({ length: 20 }, () => a.next());
    const right = Array.from({ length: 20 }, () => b.next());
    assert.deepEqual(left, right);
  });

  it('produces different streams for different seeds', () => {
    assert.notEqual(createRng(1).next(), createRng(2).next());
  });

  it('keeps int() and range() inside their bounds', () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i += 1) {
      const value = rng.int(6);
      assert.ok(value >= 0 && value < 6, `int out of range: ${value}`);
      const ranged = rng.range(3, 5);
      assert.ok(ranged >= 3 && ranged <= 5, `range out of bounds: ${ranged}`);
    }
  });

  it('shuffles without losing or duplicating elements, and does not mutate the input', () => {
    const source = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
    const shuffled = createRng(99).shuffle(source);
    assert.deepEqual([...shuffled].sort((a, b) => a - b), [...source]);
    assert.deepEqual(source, [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('forks into independent but reproducible streams', () => {
    const first = createRng(5).fork(1).next();
    const second = createRng(5).fork(1).next();
    const other = createRng(5).fork(2).next();
    assert.equal(first, second);
    assert.notEqual(first, other);
  });

  it('derives stable seeds from strings', () => {
    assert.equal(seedFromString('goblin'), seedFromString('goblin'));
    assert.notEqual(seedFromString('goblin'), seedFromString('gremlin'));
  });
});

describe('stats', () => {
  it('creates a zeroed block and fills only what is given', () => {
    assert.deepEqual(createStats({ might: 4 }), { might: 4, vitality: 0, speed: 0, guard: 0 });
  });

  it('adds, scales and rounds component-wise', () => {
    const a = createStats({ might: 1, vitality: 2, speed: 3, guard: 4 });
    const b = createStats({ might: 10, vitality: 20, speed: 30, guard: 40 });
    assert.deepEqual(addStats(a, b), { might: 11, vitality: 22, speed: 33, guard: 44 });
    assert.deepEqual(scaleStats(a, 2), { might: 2, vitality: 4, speed: 6, guard: 8 });
    assert.deepEqual(roundStats(scaleStats(a, 1.5)), { might: 2, vitality: 3, speed: 5, guard: 6 });
  });
});

describe('rarity', () => {
  it('grows monotonically along every progression dial', () => {
    for (let i = 1; i < RARITIES.length; i += 1) {
      const lower = rarityProfile(RARITIES[i - 1]!);
      const higher = rarityProfile(RARITIES[i]!);
      assert.ok(higher.maxLevel > lower.maxLevel, `${higher.rarity} maxLevel`);
      assert.ok(
        higher.growthPointsPerLevel > lower.growthPointsPerLevel,
        `${higher.rarity} growth points`,
      );
      assert.ok(
        higher.innateGrowthMultiplier >= lower.innateGrowthMultiplier,
        `${higher.rarity} innate growth`,
      );
      assert.ok(higher.xpMultiplier > lower.xpMultiplier, `${higher.rarity} xp multiplier`);
      assert.ok(higher.abilitySlots >= lower.abilitySlots, `${higher.rarity} ability slots`);
      assert.equal(rarityIndex(higher.rarity), rarityIndex(lower.rarity) + 1);
    }
  });

  it('awards no growth points at level 1 and clamps at the level cap', () => {
    assert.equal(totalGrowthPointsAtLevel('common', 1), 0);
    assert.equal(totalGrowthPointsAtLevel('common', 10), 18);
    assert.equal(totalGrowthPointsAtLevel('common', 99), 18);
  });
});

describe('power tiers', () => {
  it('orders tiers by ascending score, cost and combat bonus', () => {
    for (let i = 1; i < POWER_TIERS.length; i += 1) {
      const lower = powerTierProfile(POWER_TIERS[i - 1]!);
      const higher = powerTierProfile(POWER_TIERS[i]!);
      assert.ok(higher.minScore > lower.minScore, `${higher.tier} minScore`);
      assert.ok(higher.deployCost > lower.deployCost, `${higher.tier} deployCost`);
      assert.ok(higher.attackBonus >= lower.attackBonus, `${higher.tier} attackBonus`);
      assert.ok(higher.healthBonus >= lower.healthBonus, `${higher.tier} healthBonus`);
    }
  });

  it('places a score in exactly the band it belongs to', () => {
    for (const tier of POWER_TIERS) {
      const profile = powerTierProfile(tier);
      assert.equal(powerTierForScore(profile.minScore), tier, `at the ${tier} threshold`);
      const above = nextPowerTier(tier);
      if (above) {
        assert.equal(
          powerTierForScore(powerTierProfile(above).minScore - 1),
          tier,
          `just below ${above}`,
        );
      }
    }
  });

  it('floors at weak and tops out with no next tier', () => {
    assert.equal(powerTierForScore(0), 'weak');
    assert.equal(powerTierForScore(-50), 'weak');
    assert.equal(nextPowerTier('ascendant'), null);
    assert.equal(scoreToNextTier(999999), null);
  });

  it('reports the distance to promotion', () => {
    const elite = powerTierProfile('elite');
    assert.equal(scoreToNextTier(elite.minScore - 10), 10);
    assert.ok(comparePowerTiers('weak', 'elite') < 0);
    assert.equal(powerTierIndex('weak'), 0);
  });
});

describe('scoring', () => {
  it('prices a growth point at roughly the same score in every stat', () => {
    const perPoint = STAT_KEYS.map((key) => STAT_POINT_VALUES[key] * STAT_SCORE_WEIGHTS[key]);
    const min = Math.min(...perPoint);
    const max = Math.max(...perPoint);
    assert.ok(
      max - min < 0.2,
      `growth points should be score-equivalent across stats, got ${perPoint.join(', ')}`,
    );
  });

  it('adds ability weight on top of stat score', () => {
    const stats = createStats({ might: 10, vitality: 10, speed: 10, guard: 10 });
    assert.equal(powerScore(stats, 0), Math.round(statScore(stats)));
    assert.equal(powerScore(stats, 25) - powerScore(stats, 0), 25);
  });
});

describe('library', () => {
  const ability = defineAbility({
    id: 'test-ability',
    name: 'Test',
    description: 'Does nothing.',
    trigger: 'passive',
    weight: 5,
  });
  const card = defineCard({
    id: 'test-card',
    name: 'Test Card',
    rarity: 'common',
    family: 'beast',
    baseStats: { might: 1, vitality: 1 },
    abilities: [{ abilityId: 'test-ability', unlockLevel: 1 }],
    flavor: '',
  });

  it('looks cards and abilities up by id', () => {
    const library = createLibrary([card], [ability]);
    assert.equal(library.getCard('test-card').name, 'Test Card');
    assert.equal(library.getAbility('test-ability').weight, 5);
    assert.equal(library.tryGetCard('nope'), undefined);
  });

  it('throws on unknown ids', () => {
    const library = createLibrary([card], [ability]);
    assert.throws(() => library.getCard('nope'), /Unknown card/);
    assert.throws(() => library.getAbility('nope'), /Unknown ability/);
  });

  it('rejects duplicate ids', () => {
    assert.throws(() => createLibrary([card, card], [ability]), /Duplicate card id/);
    assert.throws(() => createLibrary([card], [ability, ability]), /Duplicate ability id/);
  });

  it('rejects a card that references an ability the library does not have', () => {
    assert.throws(() => createLibrary([card], []), /references unknown ability/);
  });
});
