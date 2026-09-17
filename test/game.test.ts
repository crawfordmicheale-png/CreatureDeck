import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GREEDY_CONTROLLER, VALUE_CONTROLLER } from '../src/battle/controllers.ts';
import { runBattle } from '../src/battle/engine.ts';
import type { BattleResult } from '../src/battle/types.ts';
import { STANDARD_LIBRARY } from '../src/content/index.ts';
import { resolveCard } from '../src/core/cardInstance.ts';
import { rarityProfile } from '../src/core/rarity.ts';
import { Collection } from '../src/game/collection.ts';
import {
  STANDARD_DECK_RULES,
  UNLIMITED_DECK_RULES,
  describeDeck,
  validateDeck,
} from '../src/game/deck.ts';
import { DEFAULT_XP_REWARDS, applyXpAwards, computeXpAwards } from '../src/game/rewards.ts';

const library = STANDARD_LIBRARY;

describe('collection', () => {
  it('hands out identical fresh copies and tracks them separately', () => {
    const collection = new Collection(library);
    const [first, second] = collection.addMany('ember-whelp', 2);
    assert.ok(first && second);
    assert.notEqual(first.instanceId, second.instanceId);
    assert.deepEqual(
      collection.resolve(first.instanceId).stats,
      collection.resolve(second.instanceId).stats,
    );
    assert.equal(collection.copiesOf('ember-whelp').length, 2);
  });

  it('levels one copy without touching its twin', () => {
    const collection = new Collection(library);
    const [mine, yours] = collection.addMany('ember-whelp', 2);
    assert.ok(mine && yours);

    collection.grantXp(mine.instanceId, 100000);
    collection.autoAllocate(mine.instanceId, ['might']);

    const levelled = collection.resolve(mine.instanceId);
    const untouched = collection.resolve(yours.instanceId);
    assert.equal(levelled.level, rarityProfile('common').maxLevel);
    assert.equal(untouched.level, 1);
    assert.ok(levelled.stats.might > untouched.stats.might);
    assert.equal(untouched.powerTier, 'weak');
    assert.equal(levelled.powerTier, 'elite');
  });

  it('refuses an allocation the card cannot afford', () => {
    const collection = new Collection(library);
    const instance = collection.add('ember-whelp');
    assert.throws(() => collection.allocate(instance.instanceId, { might: 1 }), /only 0/);
  });

  it('renames, respecs and counts battles', () => {
    const collection = new Collection(library);
    const instance = collection.add('ember-whelp', { level: 5 });
    collection.autoAllocate(instance.instanceId, ['guard']);
    assert.ok(collection.resolve(instance.instanceId).pointsSpent > 0);

    collection.respec(instance.instanceId);
    assert.equal(collection.resolve(instance.instanceId).pointsSpent, 0);

    collection.rename(instance.instanceId, 'Scorchy');
    assert.equal(collection.resolve(instance.instanceId).displayName, 'Scorchy');

    collection.recordBattle(instance.instanceId);
    assert.equal(collection.get(instance.instanceId).battlesFought, 1);
  });

  it('throws for an instance it does not hold', () => {
    assert.throws(() => new Collection(library).get('nope'), /No card instance/);
  });

  it('filters by rarity', () => {
    const collection = new Collection(library);
    collection.add('ember-whelp');
    collection.add('pyreclaw-tyrant');
    assert.equal(collection.byRarity('common').length, 1);
    assert.equal(collection.byRarity('epic').length, 1);
    assert.equal(collection.byRarity('mythic').length, 0);
  });
});

describe('deck rules', () => {
  function deckOf(collection: Collection, definitionIds: readonly string[], level = 1) {
    return definitionIds.map(
      (definitionId) => collection.add(definitionId, { level }).instanceId,
    );
  }

  const twelve = [
    'ember-whelp',
    'ember-whelp',
    'thicket-hare',
    'thicket-hare',
    'tide-minnow',
    'tide-minnow',
    'pebble-grub',
    'pebble-grub',
    'dusk-mite',
    'dusk-mite',
    'gale-sprite',
    'gale-sprite',
  ];

  it('accepts a legal deck', () => {
    const collection = new Collection(library);
    const ids = deckOf(collection, twelve);
    const validation = validateDeck(collection.deckInstances(ids), library);
    assert.equal(validation.valid, true, validation.errors.join('; '));
    assert.equal(validation.stats.cards.length, 12);
  });

  it('rejects the wrong number of cards', () => {
    const collection = new Collection(library);
    const ids = deckOf(collection, twelve.slice(0, 10));
    const validation = validateDeck(collection.deckInstances(ids), library);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((error) => error.includes('exactly 12')));
  });

  it('rejects too many copies of one card', () => {
    const collection = new Collection(library);
    const ids = deckOf(collection, Array.from({ length: 12 }, () => 'ember-whelp'));
    const validation = validateDeck(collection.deckInstances(ids), library);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((error) => error.includes('copies of Ember Whelp')));
  });

  it('rejects the same physical copy listed twice', () => {
    const collection = new Collection(library);
    const ids = deckOf(collection, twelve.slice(0, 11));
    const instances = collection.deckInstances([...ids, ids[0] as string]);
    const validation = validateDeck(instances, library);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((error) => error.includes('more than once')));
  });

  it('lets a deck of maxed commons sit exactly at the energy budget', () => {
    // The cap is deliberately set at twelve Elites: you may max a whole deck
    // of commons, but you then have no budget left for anything larger.
    const collection = new Collection(library);
    const ids = twelve.map((definitionId) => {
      const instance = collection.add(definitionId, { level: 10 });
      collection.autoAllocate(instance.instanceId, ['might']);
      return instance.instanceId;
    });
    const validation = validateDeck(collection.deckInstances(ids), library, STANDARD_DECK_RULES);

    assert.equal(validation.valid, true, validation.errors.join('; '));
    assert.equal(validation.stats.totalDeployCost, STANDARD_DECK_RULES.maxTotalDeployCost);
    for (const card of validation.stats.cards) assert.equal(card.powerTier, 'elite');
  });

  it('puts a deck over budget as soon as cards promote past Elite', () => {
    const collection = new Collection(library);
    const plan = [...twelve];
    // Two maxed uncommons reach Legendary, which costs 6 apiece.
    plan[0] = 'ashfang-jackal';
    plan[1] = 'reef-sentinel';

    const ids = plan.map((definitionId) => {
      const level = rarityProfile(library.getCard(definitionId).rarity).maxLevel;
      const instance = collection.add(definitionId, { level });
      collection.autoAllocate(instance.instanceId, ['might']);
      return instance.instanceId;
    });
    const instances = collection.deckInstances(ids);

    const budgeted = validateDeck(instances, library, STANDARD_DECK_RULES);
    assert.equal(budgeted.valid, false, 'Legendary cards should blow the budget');
    assert.ok(budgeted.errors.some((error) => error.includes('deploy cost')));
    assert.ok(
      budgeted.stats.cards.some((card) => card.powerTier === 'legendary'),
      'the fixture should actually contain a Legendary',
    );

    // The same deck is fine in casual play, where nothing caps the cost.
    assert.equal(validateDeck(instances, library, UNLIMITED_DECK_RULES).valid, true);
  });

  it('describes a deck without judging it', () => {
    const collection = new Collection(library);
    const ids = deckOf(collection, twelve);
    const stats = describeDeck(collection.deckInstances(ids), library);
    assert.equal(stats.averageLevel, 1);
    assert.equal(stats.totalDeployCost, stats.cards.length * 1);
    assert.equal(stats.tierCounts['weak'], 12);
    assert.equal(stats.rarityCounts['common'], 12);
  });

  it('handles an empty deck without dividing by zero', () => {
    const stats = describeDeck([], library);
    assert.equal(stats.averageDeployCost, 0);
    assert.equal(stats.averageLevel, 0);
  });
});

describe('rewards', () => {
  function playBattle(seed = 424242): { result: BattleResult; collection: Collection; ids: string[] } {
    const collection = new Collection(library);
    const ids = [
      'ember-whelp',
      'thicket-hare',
      'tide-minnow',
      'pebble-grub',
      'dusk-mite',
      'gale-sprite',
      'scrapfang-pup',
      'ashfang-jackal',
      'cinder-imp',
      'reef-sentinel',
      'grave-moth',
      'bramble-warden',
    ].map((definitionId) => collection.add(definitionId).instanceId);

    const enemy = new Collection(library);
    const enemyIds = [
      'ember-whelp',
      'thicket-hare',
      'tide-minnow',
      'pebble-grub',
      'dusk-mite',
      'gale-sprite',
      'scrapfang-pup',
      'ashfang-jackal',
      'cinder-imp',
      'reef-sentinel',
      'grave-moth',
      'bramble-warden',
    ].map((definitionId) => enemy.add(definitionId).instanceId);

    const result = runBattle(
      [
        { id: 'p1', name: 'Mine', deck: collection.deckInstances(ids), controller: GREEDY_CONTROLLER },
        { id: 'p2', name: 'Theirs', deck: enemy.deckInstances(enemyIds), controller: VALUE_CONTROLLER },
      ],
      library,
      { seed },
    );

    return { result, collection, ids };
  }

  it('awards every card in the deck, and more to the ones that fought', () => {
    const { result } = playBattle();
    const awards = computeXpAwards(result, 'p1');
    assert.equal(awards.length, 12);

    const fought = awards.filter((award) => award.deployed);
    const benched = awards.filter((award) => !award.deployed);
    assert.ok(fought.length > 0, 'somebody should have been deployed');
    for (const award of awards) assert.ok(award.xp > 0, `${award.name} earned nothing`);
    if (benched.length > 0) {
      const bestBench = Math.max(...benched.map((award) => award.xp));
      const worstFought = Math.min(...fought.map((award) => award.xp));
      assert.ok(bestBench < worstFought, 'a benched card should never out-earn one that fought');
    }
  });

  it('pays the winner more than the loser for the same battle', () => {
    // Two identical decks can draw, so look for a decisive seed.
    let decisive: BattleResult | null = null;
    for (let seed = 1; seed <= 50 && decisive === null; seed += 1) {
      const { result } = playBattle(seed * 1013);
      if (result.winner !== null) decisive = result;
    }
    assert.ok(decisive !== null, 'no decisive battle found in 50 seeds');

    const winnerBench = computeXpAwards(decisive, decisive.winner as string).filter(
      (award) => !award.deployed,
    );
    const loserBench = computeXpAwards(decisive, decisive.loser as string).filter(
      (award) => !award.deployed,
    );

    assert.ok(DEFAULT_XP_REWARDS.winMultiplier > 1);
    if (winnerBench.length > 0 && loserBench.length > 0) {
      assert.ok(
        (winnerBench[0] as { xp: number }).xp > (loserBench[0] as { xp: number }).xp,
        'winning should pay better',
      );
    }
  });

  it('applies awards, levelling the collection up', () => {
    const { result, collection, ids } = playBattle();
    const before = ids.map((id) => collection.resolve(id).level);

    const applied = applyXpAwards(collection, computeXpAwards(result, 'p1'));
    assert.equal(applied.length, 12);

    const after = ids.map((id) => collection.resolve(id).level);
    assert.ok(
      after.some((level, index) => level > (before[index] as number)),
      'one battle should move at least one card up a level',
    );
    for (const id of ids) assert.equal(collection.get(id).battlesFought, 1);
  });

  it('turns repeated battles into promotions', () => {
    const collection = new Collection(library);
    const instance = collection.add('ember-whelp');
    assert.equal(collection.resolve(instance.instanceId).powerTier, 'weak');

    // Enough XP to cap the card, then spend the points it earned.
    collection.grantXp(instance.instanceId, 100000);
    collection.autoAllocate(instance.instanceId, ['might', 'vitality']);

    const card = collection.resolve(instance.instanceId);
    assert.equal(card.level, rarityProfile('common').maxLevel);
    assert.equal(card.promoted, true);
    assert.ok(card.deployCost > resolveCard(collection.add('ember-whelp'), library).deployCost);
  });

  it('rejects a summary for a player who was not in the battle', () => {
    const { result } = playBattle();
    assert.throws(() => computeXpAwards(result, 'p9'), /No battle summary/);
  });
});
