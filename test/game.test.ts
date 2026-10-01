import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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
import { applyXpAwards, autoDevelop, computeDuelXp } from '../src/game/rewards.ts';

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
  function roster(): { collection: Collection; ids: string[] } {
    const collection = new Collection(library);
    const ids = [
      'ember-whelp',
      'thicket-hare',
      'tide-minnow',
      'pebble-grub',
      'dusk-mite',
    ].map((definitionId) => collection.add(definitionId).instanceId);
    return { collection, ids };
  }

  it('pays every card in the deck the same, drawn or not', () => {
    const { collection, ids } = roster();
    const awards = computeDuelXp(collection, ids, 1, true);
    assert.equal(awards.length, ids.length);
    assert.equal(new Set(awards.map((award) => award.xp)).size, 1);
    assert.ok((awards[0] as { xp: number }).xp > 0);
  });

  it('pays more for a win than a loss', () => {
    const { collection, ids } = roster();
    const won = computeDuelXp(collection, ids, 2, true)[0] as { xp: number };
    const lost = computeDuelXp(collection, ids, 2, false)[0] as { xp: number };
    assert.ok(won.xp > lost.xp);
  });

  it('pays more as the run goes on, because levels cost more', () => {
    const { collection, ids } = roster();
    const early = computeDuelXp(collection, ids, 1, true)[0] as { xp: number };
    const late = computeDuelXp(collection, ids, 4, true)[0] as { xp: number };
    assert.ok(late.xp > early.xp * 2, 'the curve should keep pace with rising level costs');
  });

  it('applies awards and reports what each card gained', () => {
    const { collection, ids } = roster();
    const before = ids.map((id) => collection.resolve(id).level);
    const applied = applyXpAwards(collection, computeDuelXp(collection, ids, 1, true));

    assert.equal(applied.length, ids.length);
    assert.ok(applied.every((award) => award.levelsGained > 0));
    const after = ids.map((id) => collection.resolve(id).level);
    assert.ok(after.every((level, index) => level > (before[index] as number)));
    for (const id of ids) assert.equal(collection.get(id).battlesFought, 1);
  });

  it('lands a common at roughly level 4, 6, 8 and 10 across a run', () => {
    const { collection, ids } = roster();
    const levels: number[] = [];
    for (let duel = 1; duel <= 4; duel += 1) {
      applyXpAwards(collection, computeDuelXp(collection, ids, duel, true));
      levels.push(collection.resolve(ids[0] as string).level);
    }
    assert.deepEqual(levels, [4, 6, 8, 10]);
  });

  it('autoDevelop takes every pending fork and spends every point', () => {
    const { collection, ids } = roster();
    const id = ids[0] as string;
    applyXpAwards(collection, computeDuelXp(collection, ids, 3, true));

    assert.ok(collection.resolve(id).pendingUpgrades > 0, 'the fixture should have a fork waiting');
    autoDevelop(collection, id, ['might'], true);

    const card = collection.resolve(id);
    assert.equal(card.pendingUpgrades, 0);
    assert.equal(card.pointsUnspent, 0);
    assert.ok(card.upgrades.length > 0);
  });

  it('turns repeated duels into a promotion', () => {
    const { collection, ids } = roster();
    const id = ids[0] as string;
    assert.equal(collection.resolve(id).powerTier, 'weak');
    for (let duel = 1; duel <= 4; duel += 1) {
      applyXpAwards(collection, computeDuelXp(collection, ids, duel, true));
      autoDevelop(collection, id, ['might', 'vitality'], true);
    }
    const card = collection.resolve(id);
    assert.equal(card.promoted, true);
    assert.ok(card.powerScore > 120);
  });
});
