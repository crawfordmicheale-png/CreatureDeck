/**
 * Playable demo of the CreatureDeck systems.
 *
 *   npm run demo                 every section
 *   npm run demo -- roster       the printed set, by rarity
 *   npm run demo -- divergence   three identical commons, three different builds
 *   npm run demo -- battle       one full battle
 *   npm run demo -- season       five battles, with XP carried between them
 *
 * Add `--verbose` for the blow-by-blow battle log, and `--seed <n>` to change
 * the deterministic seed.
 */

import { runBattle } from '../battle/engine.ts';
import type { BattlePlayerSetup } from '../battle/engine.ts';
import { GREEDY_CONTROLLER, VALUE_CONTROLLER } from '../battle/controllers.ts';
import { STANDARD_LIBRARY } from '../content/index.ts';
import type { ResolvedCard } from '../core/cardInstance.ts';
import { RARITIES, rarityProfile } from '../core/rarity.ts';
import type { StatKey } from '../core/stats.ts';
import { Collection } from '../game/collection.ts';
import { describeDeck } from '../game/deck.ts';
import { applyXpAwards, computeXpAwards } from '../game/rewards.ts';
import { formatCard, formatCardRow, formatLog, heading, paint } from './format.ts';

const library = STANDARD_LIBRARY;

interface Options {
  readonly sections: readonly string[];
  readonly verbose: boolean;
  readonly seed: number;
}

function parseArgs(argv: readonly string[]): Options {
  const sections: string[] = [];
  let verbose = false;
  let seed = 20260917;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--verbose' || arg === '-v') verbose = true;
    else if (arg === '--seed') {
      i += 1;
      seed = Number(argv[i] ?? seed);
    } else if (!arg.startsWith('-')) sections.push(arg);
  }

  return {
    sections: sections.length > 0 ? sections : ['roster', 'divergence', 'battle', 'season'],
    verbose,
    seed,
  };
}

// --------------------------------------------------------------- the roster

function showRoster(): void {
  console.log(heading('The printed set'));
  console.log(
    paint(
      'Every copy of a card enters a collection exactly like this. Levelling is the only thing that changes it.\n',
      'dim',
    ),
  );

  const collection = new Collection(library);
  for (const rarity of RARITIES) {
    const profile = rarityProfile(rarity);
    console.log(
      paint(
        `\n${profile.label} - max level ${profile.maxLevel}, ${profile.growthPointsPerLevel} growth points per level, ${profile.abilitySlots} ability slot(s)`,
        'bold',
      ),
    );
    for (const definition of library.cards.filter((card) => card.rarity === rarity)) {
      const instance = collection.add(definition.id);
      console.log('  ' + formatCardRow(collection.resolve(instance.instanceId)));
    }
  }
}

// ------------------------------------------------------------- the divergence

/** The pitch: same printed card, same starting tier, three different creatures. */
function showDivergence(): void {
  console.log(heading('One card, three owners'));

  const collection = new Collection(library);
  const builds: ReadonlyArray<{ nickname: string; focus: readonly StatKey[]; note: string }> = [
    {
      nickname: 'Cinderbite',
      focus: ['might'],
      note: 'Everything into Might. Kills fast, dies faster.',
    },
    {
      nickname: 'Old Scar',
      focus: ['vitality', 'guard'],
      note: 'Vitality and Guard. Will not die, will not hurry.',
    },
    {
      nickname: 'Flicker',
      focus: ['speed', 'might'],
      note: 'Speed and Might. Strikes first and dodges the reply.',
    },
  ];

  const fresh = collection.add('ember-whelp', { nickname: 'Unlevelled' });
  console.log(paint('\nAs printed:', 'bold'));
  console.log(formatCard(collection.resolve(fresh.instanceId), '  '));

  console.log(
    paint(
      '\nThe same common, taken to level 10 three different ways (18 growth points each):\n',
      'dim',
    ),
  );

  for (const build of builds) {
    const instance = collection.add('ember-whelp', { nickname: build.nickname, level: 10 });
    collection.autoAllocate(instance.instanceId, build.focus);
    console.log(formatCard(collection.resolve(instance.instanceId), '  '));
    console.log(paint(`  ${build.note}`, 'dim'));
    console.log();
  }

  console.log(
    paint(
      'All three are Elite now - the same power tier, and the same deploy cost. The power score\n' +
        'barely moved between builds, because a growth point is worth the same score in any stat.\n' +
        'What changed is what the creature actually does on the board.\n',
      'dim',
    ),
  );

  const maxedCommon = collection.resolve(
    collection.autoAllocate(
      collection.add('ember-whelp', { nickname: 'Cinderbite', level: 10 }).instanceId,
      ['might'],
    ).instanceId,
  );
  const freshEpic = collection.resolve(collection.add('pyreclaw-tyrant').instanceId);
  console.log(paint('And the reason rarity still matters:', 'bold'));
  console.log('  ' + formatCardRow(maxedCommon));
  console.log('  ' + formatCardRow(freshEpic));
  console.log(
    paint(
      '\n  A maxed common finally catches an epic that has never been played - and that epic has\n' +
        '  twelve more levels of headroom to go.',
      'dim',
    ),
  );
}

// -------------------------------------------------------------------- decks

interface BuiltDeck {
  readonly name: string;
  readonly collection: Collection;
  readonly instanceIds: readonly string[];
}

/** A veteran deck: cheap cards, levelled hard and built with intent. */
function buildVeteranDeck(): BuiltDeck {
  const collection = new Collection(library);
  const plan: ReadonlyArray<[string, number, readonly StatKey[], string]> = [
    ['ember-whelp', 10, ['might'], 'Cinderbite'],
    ['ember-whelp', 9, ['might', 'speed'], 'Scorch'],
    ['scrapfang-pup', 10, ['might', 'vitality'], 'Gnash'],
    ['thicket-hare', 10, ['speed'], 'Flicker'],
    ['pebble-grub', 10, ['vitality', 'guard'], 'Old Scar'],
    ['tide-minnow', 9, ['might', 'vitality'], 'Brine'],
    ['dusk-mite', 10, ['speed', 'might'], 'Whisper'],
    ['ashfang-jackal', 12, ['might'], 'Ashfang'],
    ['cinder-imp', 12, ['might', 'speed'], 'Ember'],
    ['reef-sentinel', 12, ['vitality', 'guard'], 'Bulwark'],
    ['grave-moth', 11, ['speed', 'might'], 'Pall'],
    ['bramble-warden', 12, ['vitality', 'guard'], 'Thistle'],
  ];

  const instanceIds = plan.map(([definitionId, level, focus, nickname]) => {
    const instance = collection.add(definitionId, { level, nickname });
    collection.autoAllocate(instance.instanceId, focus);
    return instance.instanceId;
  });

  return { name: 'Ashen Vanguard', collection, instanceIds };
}

/** A rich deck: rares and epics, straight out of the packs, never levelled. */
function buildFreshDeck(): BuiltDeck {
  const collection = new Collection(library);
  const plan: readonly string[] = [
    'stormcaller-roc',
    'stormcaller-roc',
    'magma-colossus',
    'abyssal-serpent',
    'abyssal-serpent',
    'verdant-matriarch',
    'nightmare-stalker',
    'nightmare-stalker',
    'pyreclaw-tyrant',
    'glacierheart-titan',
    'void-harbinger',
    'skyfather-drake',
  ];
  const instanceIds = plan.map((definitionId) => collection.add(definitionId).instanceId);
  return { name: 'Gilded Menagerie', collection, instanceIds };
}

function summariseDeck(deck: BuiltDeck): void {
  const stats = describeDeck(deck.collection.deckInstances(deck.instanceIds), library);
  const tiers = Object.entries(stats.tierCounts)
    .map(([tier, count]) => `${count} ${tier}`)
    .join(', ');
  console.log(
    `  ${paint(deck.name.padEnd(20), 'bold')} avg level ${stats.averageLevel.toFixed(1)}  ` +
      `total cost ${stats.totalDeployCost}  total score ${stats.totalPowerScore}  [${tiers}]`,
  );
}

function setupFor(deck: BuiltDeck, id: string, controllerIndex: number): BattlePlayerSetup {
  return {
    id,
    name: deck.name,
    deck: deck.collection.deckInstances(deck.instanceIds),
    controller: controllerIndex === 0 ? GREEDY_CONTROLLER : VALUE_CONTROLLER,
  };
}

// ------------------------------------------------------------------- battle

function showBattle(options: Options): void {
  console.log(heading('A battle'));

  const veterans = buildVeteranDeck();
  const fresh = buildFreshDeck();
  summariseDeck(veterans);
  summariseDeck(fresh);
  console.log(
    paint(
      '\n  The levelled deck is worth far more power score - and costs half again as much energy to\n' +
        '  get onto the board. That is the trade the power-tier system makes: growth is paid for in\n' +
        '  tempo, which is what keeps an unlevelled collection playable.\n',
      'dim',
    ),
  );

  const result = runBattle(
    [setupFor(veterans, 'p1', 0), setupFor(fresh, 'p2', 1)],
    library,
    { seed: options.seed },
  );

  console.log(formatLog(result.log, { verbose: options.verbose }));

  console.log(paint('\nCard performance:', 'bold'));
  for (const player of result.players) {
    console.log(paint(`\n  ${player.name} - nexus ${player.nexusHealth}`, 'bold'));
    const fought = player.cards.filter((card) => card.deployed);
    for (const card of [...fought].sort((a, b) => b.damageDealt - a.damageDealt)) {
      console.log(
        `    ${card.name.padEnd(24)} ${String(card.damageDealt).padStart(4)} dealt  ` +
          `${String(card.damageTaken).padStart(4)} taken  ${card.kills} kill(s)  ` +
          (card.survived ? paint('survived', 'green') : paint('fell', 'red')),
      );
    }
  }
}

// ------------------------------------------------------------------- season

/** The loop that makes levelling matter: fight, earn, spend, fight again. */
function showSeason(options: Options): void {
  console.log(heading('A season: five battles, XP carried forward'));

  const rookies = new Collection(library);
  const plan: ReadonlyArray<[string, readonly StatKey[], string]> = [
    ['ember-whelp', ['might'], 'Cinderbite'],
    ['scrapfang-pup', ['might', 'vitality'], 'Gnash'],
    ['thicket-hare', ['speed'], 'Flicker'],
    ['pebble-grub', ['vitality', 'guard'], 'Old Scar'],
    ['tide-minnow', ['might', 'vitality'], 'Brine'],
    ['dusk-mite', ['speed', 'might'], 'Whisper'],
    ['gale-sprite', ['vitality'], 'Zephyr'],
    ['ashfang-jackal', ['might'], 'Ashfang'],
    ['cinder-imp', ['might', 'speed'], 'Ember'],
    ['reef-sentinel', ['vitality', 'guard'], 'Bulwark'],
    ['grave-moth', ['speed', 'might'], 'Pall'],
    ['bramble-warden', ['vitality', 'guard'], 'Thistle'],
  ];

  const focusByInstance = new Map<string, readonly StatKey[]>();
  const instanceIds = plan.map(([definitionId, focus, nickname]) => {
    const instance = rookies.add(definitionId, { nickname });
    focusByInstance.set(instance.instanceId, focus);
    return instance.instanceId;
  });

  const before = instanceIds.map((id) => rookies.resolve(id));
  const opponent = buildFreshDeck();

  for (let battle = 1; battle <= 5; battle += 1) {
    const result = runBattle(
      [
        {
          id: 'p1',
          name: 'Rookies',
          deck: rookies.deckInstances(instanceIds),
          controller: GREEDY_CONTROLLER,
        },
        setupFor(opponent, 'p2', 1),
      ],
      library,
      { seed: options.seed + battle },
    );

    const awards = computeXpAwards(result, 'p1');
    const applied = applyXpAwards(rookies, awards);

    // Each owner spends their new points along the line they picked for that copy.
    for (const instanceId of instanceIds) {
      rookies.autoAllocate(instanceId, focusByInstance.get(instanceId) ?? ['might']);
    }

    const levelled = applied.filter((award) => award.levelsGained > 0);
    const outcome =
      result.winner === 'p1' ? paint('won', 'green') : result.winner === null ? 'drew' : paint('lost', 'red');
    console.log(
      `\n  Battle ${battle}: ${outcome} in ${result.rounds} rounds. ` +
        `${levelled.length} card(s) levelled.`,
    );
    for (const award of levelled) {
      const unlocked =
        award.abilitiesUnlocked.length > 0
          ? paint(
              `  unlocked ${award.abilitiesUnlocked.map((id) => library.getAbility(id).name).join(', ')}`,
              'green',
            )
          : '';
      console.log(
        `    ${award.name.padEnd(18)} +${String(award.xp).padStart(4)} XP  ` +
          `-> L${award.newLevel} (+${award.growthPointsGained} points)${unlocked}`,
      );
    }
  }

  console.log(paint('\n  Where the roster ended up:\n', 'bold'));
  const after = instanceIds.map((id) => rookies.resolve(id));
  for (let i = 0; i < after.length; i += 1) {
    const start = before[i] as ResolvedCard;
    const end = after[i] as ResolvedCard;
    const promoted =
      end.powerTier !== start.powerTier
        ? paint(`  ${start.tier.label} -> ${end.tier.label}`, 'green')
        : '';
    console.log(
      `    ${end.displayName.padEnd(18)} L${String(start.level).padStart(2)} -> L${String(end.level).padStart(2)}  ` +
        `score ${String(start.powerScore).padStart(4)} -> ${String(end.powerScore).padStart(4)}  ` +
        `cost ${start.deployCost} -> ${end.deployCost}${promoted}`,
    );
  }
}

// --------------------------------------------------------------------- main

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const sections: Record<string, () => void> = {
    roster: showRoster,
    divergence: showDivergence,
    battle: () => showBattle(options),
    season: () => showSeason(options),
  };

  for (const name of options.sections) {
    const section = sections[name];
    if (!section) {
      console.error(`Unknown section "${name}". Try: ${Object.keys(sections).join(', ')}`);
      process.exitCode = 1;
      return;
    }
    section();
  }
  console.log();
}

main();
