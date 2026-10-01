import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EFFECTS, STANDARD_LIBRARY } from '../src/content/index.ts';
import { createCardInstance, resolveCard } from '../src/core/cardInstance.ts';
import { createRng } from '../src/core/rng.ts';
import {
  UPGRADES,
  milestonesReached,
  upgradeChoices,
  upgradeMilestones,
} from '../src/core/upgrades.ts';
import { Collection } from '../src/game/collection.ts';
import {
  DEFAULT_DRAFT_RULES,
  RARITY_DRAFT_WEIGHT,
  optionId,
  recruitLevel,
  rollDraft,
} from '../src/game/draft.ts';

const library = STANDARD_LIBRARY;

describe('upgrade milestones', () => {
  it('hands out one fork every fourth level, scaled by rarity headroom', () => {
    assert.deepEqual(upgradeMilestones('common'), [4, 8]);
    assert.deepEqual(upgradeMilestones('uncommon'), [4, 8, 12]);
    assert.deepEqual(upgradeMilestones('mythic'), [4, 8, 12, 16, 20, 24]);
    assert.equal(milestonesReached('common', 1), 0);
    assert.equal(milestonesReached('common', 4), 1);
    assert.equal(milestonesReached('common', 9), 2);
  });

  it('always offers one offensive path against one that is not', () => {
    for (const card of library.cards) {
      for (const milestone of upgradeMilestones(card.rarity)) {
        const choice = upgradeChoices(card.id, milestone, [], []);
        assert.ok(choice, `${card.id} has no choice at ${milestone}`);
        const kinds = choice.map((option) => option.kind);
        assert.ok(kinds.includes('offence'), `${card.id}@${milestone} has no offensive path`);
        assert.ok(
          kinds.some((kind) => kind !== 'offence'),
          `${card.id}@${milestone} offers two offensive paths`,
        );
        assert.notEqual(choice[0].id, choice[1].id);
      }
    }
  });

  it('is stable for a card but differs between cards', () => {
    const a = upgradeChoices('ember-whelp', 4, [], []);
    const again = upgradeChoices('ember-whelp', 4, [], []);
    assert.deepEqual(a, again, 'the same card must always be offered the same fork');

    const everyFirstChoice = library.cards.map((card) =>
      upgradeChoices(card.id, 4, [], [])
        ?.map((option) => option.id)
        .join('/'),
    );
    assert.ok(new Set(everyFirstChoice).size > 3, 'cards should not all offer the same fork');
  });

  it('never offers an ability the card already has', () => {
    const choice = upgradeChoices('ember-whelp', 4, ['ferocity', 'hunt'], []);
    assert.ok(choice);
    for (const option of choice) {
      assert.ok(option.grantsAbility !== 'ferocity');
      assert.ok(option.grantsAbility !== 'hunt');
    }
  });

  it('never re-offers an upgrade already taken', () => {
    const first = upgradeChoices('pebble-grub', 4, [], []);
    assert.ok(first);
    const taken = first[0].id;
    const second = upgradeChoices('pebble-grub', 8, [], [taken]);
    assert.ok(second);
    assert.ok(second.every((option) => option.id !== taken));
  });

  it('prices every upgrade with something real', () => {
    for (const upgrade of UPGRADES) {
      const stats = Object.values(upgrade.stats).reduce((a, b) => a + (b ?? 0), 0);
      assert.ok(
        stats > 0 || upgrade.grantsAbility !== undefined || (upgrade.stamina ?? 0) > 0,
        `${upgrade.id} does nothing`,
      );
      if (upgrade.grantsAbility) {
        assert.ok(library.tryGetAbility(upgrade.grantsAbility), `${upgrade.id} grants a ghost`);
      }
    }
  });
});

describe('taking an upgrade', () => {
  it('reports a pending fork once the level is reached, and not before', () => {
    const collection = new Collection(library);
    const id = collection.add('ember-whelp', { level: 3 }).instanceId;
    assert.equal(collection.resolve(id).pendingUpgrades, 0);
    assert.equal(collection.resolve(id).upgradeChoice, null);

    collection.grantXp(id, 100000);
    const card = collection.resolve(id);
    assert.ok(card.pendingUpgrades > 0);
    assert.ok(card.upgradeChoice);
  });

  it('applies the chosen path to stats, abilities and stamina', () => {
    const collection = new Collection(library);
    const id = collection.add('pebble-grub', { level: 4 }).instanceId;
    const before = collection.resolve(id);
    const choice = before.upgradeChoice;
    assert.ok(choice);

    const pick = choice[0];
    collection.chooseUpgrade(id, pick.id);
    const after = collection.resolve(id);

    assert.equal(after.pendingUpgrades, before.pendingUpgrades - 1);
    assert.deepEqual(after.upgrades.map((u) => u.id), [pick.id]);

    for (const [key, bonus] of Object.entries(pick.stats)) {
      const stat = key as 'might' | 'vitality' | 'speed' | 'guard';
      assert.equal(after.stats[stat], before.stats[stat] + (bonus ?? 0), `${stat} should rise`);
    }
    if (pick.grantsAbility) {
      assert.ok(after.abilities.some((ability) => ability.id === pick.grantsAbility));
      assert.ok(after.powerScore > before.powerScore, 'a new ability should raise power score');
    }
    assert.equal(after.stamina, before.stamina + (pick.stamina ?? 0));
  });

  it('refuses an upgrade that is not on offer, or one taken too early', () => {
    const collection = new Collection(library);
    const early = collection.add('ember-whelp', { level: 2 }).instanceId;
    assert.throws(() => collection.chooseUpgrade(early, 'hooked-fangs'), /no upgrade waiting/);

    const ready = collection.add('ember-whelp', { level: 4 }).instanceId;
    const offered = collection.resolve(ready).upgradeChoice?.map((o) => o.id) ?? [];
    const notOffered = UPGRADES.find((u) => !offered.includes(u.id));
    assert.ok(notOffered);
    assert.throws(() => collection.chooseUpgrade(ready, notOffered.id), /not on offer/);
  });

  it('turns one printed card into two different creatures', () => {
    const collection = new Collection(library);
    const a = collection.add('ember-whelp', { level: 8, nickname: 'A' }).instanceId;
    const b = collection.add('ember-whelp', { level: 8, nickname: 'B' }).instanceId;

    // Two untouched copies are in the same state, so they see the same fork.
    const firstA = collection.resolve(a).upgradeChoice;
    const firstB = collection.resolve(b).upgradeChoice;
    assert.ok(firstA && firstB);
    assert.deepEqual(
      firstA.map((o) => o.id),
      firstB.map((o) => o.id),
      'identical copies must be offered identical forks',
    );

    // Take opposite paths, then take whatever each is offered next. From here
    // the offers themselves diverge, because the pool excludes what each copy
    // already holds — divergence is meant to compound.
    collection.chooseUpgrade(a, firstA[0].id);
    collection.chooseUpgrade(b, firstB[1].id);

    const secondA = collection.resolve(a).upgradeChoice;
    const secondB = collection.resolve(b).upgradeChoice;
    assert.ok(secondA && secondB);
    collection.chooseUpgrade(a, secondA[0].id);
    collection.chooseUpgrade(b, secondB[1].id);

    const left = collection.resolve(a);
    const right = collection.resolve(b);
    assert.equal(left.level, right.level);
    assert.equal(left.pendingUpgrades, 0);
    assert.notDeepEqual(
      left.upgrades.map((u) => u.id),
      right.upgrades.map((u) => u.id),
    );
    const differs =
      left.stats.might !== right.stats.might ||
      left.stats.vitality !== right.stats.vitality ||
      left.stats.guard !== right.stats.guard ||
      left.abilities.length !== right.abilities.length;
    assert.ok(differs, 'opposite paths should produce visibly different creatures');
  });

  it('keeps offering forks that fit what a copy has already become', () => {
    const collection = new Collection(library);
    const id = collection.add('reef-sentinel', { level: 12 }).instanceId;

    const taken: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const choice = collection.resolve(id).upgradeChoice;
      if (!choice) break;
      for (const option of choice) {
        assert.ok(!taken.includes(option.id), `${option.id} was offered twice`);
        if (option.grantsAbility) {
          assert.ok(
            !collection.resolve(id).abilities.some((a) => a.id === option.grantsAbility),
            `offered ${option.grantsAbility}, which it already has`,
          );
        }
      }
      collection.chooseUpgrade(id, choice[0].id);
      taken.push(choice[0].id);
    }
    assert.equal(taken.length, 3, 'an uncommon at level 12 has three milestones');
  });

  it('leaves an un-upgraded copy untouched', () => {
    const collection = new Collection(library);
    const plain = collection.add('ember-whelp', { level: 8 }).instanceId;
    const fresh = resolveCard(
      createCardInstance(library.getCard('ember-whelp'), { instanceId: 'probe', level: 8 }),
      library,
    );
    assert.deepEqual(collection.resolve(plain).stats, fresh.stats);
  });
});

describe('drafting', () => {
  const emptyContext = { rosterLevels: [1], copies: new Map<string, number>() };

  it('offers the requested number of distinct cards', () => {
    const options = rollDraft(createRng(5), library, EFFECTS, emptyContext);
    assert.equal(options.length, DEFAULT_DRAFT_RULES.count);
    assert.equal(new Set(options.map(optionId)).size, options.length);
  });

  it('is deterministic for a seed', () => {
    const a = rollDraft(createRng(99), library, EFFECTS, emptyContext);
    const b = rollDraft(createRng(99), library, EFFECTS, emptyContext);
    assert.deepEqual(a, b);
  });

  it('never offers a card the deck is already full of', () => {
    const copies = new Map<string, number>();
    for (const card of library.cards) copies.set(card.id, 2);
    const options = rollDraft(createRng(3), library, EFFECTS, { rosterLevels: [1], copies });
    assert.ok(options.length > 0);
    assert.ok(
      options.every((option) => option.kind === 'effect'),
      'with every creature maxed out, only effects should be offered',
    );
  });

  it('returns nothing when the whole set is exhausted', () => {
    const copies = new Map<string, number>();
    for (const card of library.cards) copies.set(card.id, 2);
    for (const effect of EFFECTS) copies.set(effect.id, 2);
    const options = rollDraft(createRng(3), library, EFFECTS, { rosterLevels: [1], copies });
    assert.equal(options.length, 0);
  });

  it('weights common cards above mythic ones', () => {
    assert.ok(RARITY_DRAFT_WEIGHT.common > RARITY_DRAFT_WEIGHT.mythic * 5);

    const counts: Record<string, number> = {};
    for (let seed = 0; seed < 400; seed += 1) {
      for (const option of rollDraft(createRng(seed), library, EFFECTS, emptyContext)) {
        counts[option.rarity] = (counts[option.rarity] ?? 0) + 1;
      }
    }
    assert.ok(
      (counts['common'] ?? 0) > (counts['mythic'] ?? 0),
      `commons should dominate the pool: ${JSON.stringify(counts)}`,
    );
  });

  it('recruits at the middle of the warband, capped by rarity', () => {
    assert.equal(recruitLevel([], 'common'), 1);
    assert.equal(recruitLevel([6, 6, 6], 'common'), 6);
    assert.equal(recruitLevel([2, 6, 10], 'common'), 6);
    // A common cannot join above its own level cap.
    assert.equal(recruitLevel([20, 20, 20], 'common'), 10);
    assert.equal(recruitLevel([20, 20, 20], 'mythic'), 20);
  });

  it('offers recruits at a level worth taking late in a run', () => {
    const options = rollDraft(createRng(12), library, EFFECTS, {
      rosterLevels: [8, 8, 9, 9, 10],
      copies: new Map(),
    });
    for (const option of options) {
      if (option.kind === 'creature') {
        assert.ok(option.level >= 8, `${option.name} would join at level ${option.level}`);
      }
    }
  });
});
