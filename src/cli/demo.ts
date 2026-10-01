/**
 * Terminal tour of the CreatureDeck systems.
 *
 *   npm run demo                 every section
 *   npm run demo -- roster       the printed set, by rarity
 *   npm run demo -- divergence   one card, three owners
 *   npm run demo -- paths        the upgrade forks a card is offered
 *   npm run demo -- run          a simulated campaign, duel by duel
 *
 * The game itself is in the browser; this exists so the card systems can be
 * inspected without one.
 */

import { STANDARD_LIBRARY } from '../content/index.ts';
import { resolveCard } from '../core/cardInstance.ts';
import { trainTo } from '../core/leveling.ts';
import { RARITIES, rarityProfile } from '../core/rarity.ts';
import type { StatKey } from '../core/stats.ts';
import { upgradeMilestones } from '../core/upgrades.ts';
import { Collection } from '../game/collection.ts';
import { BALANCED_STYLE, simulateRun } from '../game/runSim.ts';
import { formatCard, formatCardRow, heading, paint } from './format.ts';

const library = STANDARD_LIBRARY;

interface Options {
  readonly sections: readonly string[];
  readonly seed: number;
}

function parseArgs(argv: readonly string[]): Options {
  const sections: string[] = [];
  let seed = 20261001;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--seed') {
      i += 1;
      seed = Number(argv[i] ?? seed);
    } else if (!arg.startsWith('-')) sections.push(arg);
  }
  return {
    sections: sections.length > 0 ? sections : ['roster', 'divergence', 'paths', 'run'],
    seed,
  };
}

function showRoster(): void {
  console.log(heading('The printed set'));
  console.log(
    paint('Every copy enters a collection exactly like this. Levelling is what changes it.\n', 'dim'),
  );

  const collection = new Collection(library);
  for (const rarity of RARITIES) {
    const profile = rarityProfile(rarity);
    console.log(
      paint(
        `\n${profile.label} — max level ${profile.maxLevel}, ${profile.growthPointsPerLevel} points per level, ` +
          `${upgradeMilestones(rarity).length} upgrade fork(s)`,
        'bold',
      ),
    );
    for (const definition of library.cards.filter((card) => card.rarity === rarity)) {
      const instance = collection.add(definition.id);
      console.log('  ' + formatCardRow(collection.resolve(instance.instanceId)));
    }
  }
}

function showDivergence(): void {
  console.log(heading('One card, three owners'));
  const collection = new Collection(library);

  const builds: ReadonlyArray<{ name: string; focus: readonly StatKey[]; note: string }> = [
    { name: 'Cinderbite', focus: ['might'], note: 'Everything into Might. Kills fast, dies faster.' },
    { name: 'Old Scar', focus: ['vitality', 'guard'], note: 'Will not die, will not hurry.' },
    { name: 'Flicker', focus: ['speed', 'might'], note: 'Slips blows and hits back.' },
  ];

  const fresh = collection.add('ember-whelp', { nickname: 'Unlevelled' });
  console.log(paint('\nAs printed:', 'bold'));
  console.log(formatCard(collection.resolve(fresh.instanceId), '  '));

  console.log(paint('\nThe same common at level 10, built three ways:\n', 'dim'));
  for (const build of builds) {
    const instance = collection.add('ember-whelp', { nickname: build.name, level: 10 });
    collection.autoAllocate(instance.instanceId, build.focus);
    console.log(formatCard(collection.resolve(instance.instanceId), '  '));
    console.log(paint(`  ${build.note}\n`, 'dim'));
  }
}

function showPaths(): void {
  console.log(heading('Upgrade forks'));
  console.log(
    paint(
      'Every fourth level a card offers two paths. The pair is fixed per card, so two copies\n' +
        'see the same fork — until they take different ones, after which the offers diverge too.\n',
      'dim',
    ),
  );

  const collection = new Collection(library);
  for (const definitionId of ['ember-whelp', 'pebble-grub', 'ashfang-jackal', 'nightmare-stalker']) {
    const definition = library.getCard(definitionId);
    console.log(paint(`\n${definition.name} (${definition.rarity})`, 'bold'));

    const id = collection.add(definitionId, { level: rarityProfile(definition.rarity).maxLevel })
      .instanceId;
    for (let step = 0; step < 6; step += 1) {
      const card = collection.resolve(id);
      if (card.upgradeChoice === null) break;
      const [left, right] = card.upgradeChoice;
      console.log(
        `  level ${(step + 1) * 4}  ${paint(left.name, 'yellow')} — ${left.description}`,
      );
      console.log(`           ${paint(right.name, 'cyan')} — ${right.description}`);
      collection.chooseUpgrade(id, left.id);
    }
  }
}

function showRun(options: Options): void {
  console.log(heading('A simulated run'));
  console.log(
    paint('Both sides played by the AI, so this is about the decks and the route.\n', 'dim'),
  );

  const outcome = simulateRun(library, { seed: options.seed, style: BALANCED_STYLE });
  for (const fight of outcome.fights) {
    const verdict = fight.won ? paint('won ', 'green') : paint('lost', 'red');
    const kind = fight.kind === 'elite' ? paint('elite', 'yellow') : fight.kind;
    console.log(
      `  row ${String(fight.depth).padStart(2)} ${kind.padEnd(6)} ` +
        `${fight.encounterName.padEnd(26)} ${verdict}` +
        `  ${String(fight.turns).padStart(2)} turns  deck ${fight.deckSize}`,
    );
  }
  console.log(
    paint(
      `\n  Route: ${outcome.visited.join(' -> ')}\n` +
        `  Reached row ${outcome.depthReached + 1} of 12; ` +
        `${outcome.cleared ? 'cleared' : 'fell short'}. Deck ended at ` +
        `${outcome.finalCreatures} creatures and ${outcome.finalEffects} effects.`,
      'dim',
    ),
  );
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const sections: Record<string, () => void> = {
    roster: showRoster,
    divergence: showDivergence,
    paths: showPaths,
    run: () => showRun(options),
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
