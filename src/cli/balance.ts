/**
 * Balance harness.
 *
 *   npm run balance            200 runs of the shipped campaign
 *   npm run balance -- 600     more runs
 *
 * Plays whole runs with the AI on both sides, including drafting, levelling
 * and upgrade forks, so what it reports is the game as published rather than
 * an idealised version of it.
 *
 * What to look for:
 *   - The opening duel should be comfortably winnable. If duel one is under
 *     half, the starting deck is structurally behind and no amount of play
 *     skill will fix it.
 *   - Duels that end in a handful of turns are decided before the stamina and
 *     lane decisions ever come up.
 */

import { STANDARD_LIBRARY } from '../content/index.ts';
import {
  AGGRESSIVE_STYLE,
  BALANCED_STYLE,
  DEFENSIVE_STYLE,
  sweep,
} from '../game/runSim.ts';
import type { PlayerStyle, SweepReport } from '../game/runSim.ts';
import { heading, paint } from './format.ts';

const library = STANDARD_LIBRARY;

/** Win rates we are aiming for: a gentle opener tightening to a hard boss. */
const TARGET = [0.8, 0.7, 0.6, 0.6, 0.45];

function reportLine(report: SweepReport): void {
  for (const stage of report.stages) {
    if (stage.played === 0) {
      console.log(`  ${String(stage.stage + 1)} ${stage.name.padEnd(24)} ${paint('never reached', 'red')}`);
      continue;
    }
    const target = TARGET[stage.stage] ?? 0.5;
    const delta = stage.winRate - target;
    const flag =
      Math.abs(delta) <= 0.12
        ? paint('on target', 'green')
        : delta > 0
          ? paint(`${Math.round(delta * 100)}pt too easy`, 'yellow')
          : paint(`${Math.round(-delta * 100)}pt too hard`, 'red');

    console.log(
      `  ${String(stage.stage + 1)} ${stage.name.padEnd(24)}` +
        ` reached ${String(stage.played).padStart(4)}` +
        ` won ${String(Math.round(stage.winRate * 100)).padStart(3)}%` +
        ` (target ${Math.round(target * 100)}%)` +
        `  ${stage.averageTurns.toFixed(0).padStart(2)} turns` +
        `  deck ${stage.averageDeckSize.toFixed(0)}` +
        `  ${flag}`,
    );
  }
  console.log(
    `  ${paint('full clears', 'bold')} ${report.clears}/${report.runs} ` +
      `(${Math.round(report.clearRate * 100)}%)`,
  );
}

function main(): void {
  const runs = Number(process.argv[2] ?? 200);

  console.log(heading(`Campaign sweep — ${runs} runs per style`));
  const styles: readonly PlayerStyle[] = [BALANCED_STYLE, AGGRESSIVE_STYLE, DEFENSIVE_STYLE];

  for (const style of styles) {
    console.log(paint(`\n${style.name} build`, 'bold'));
    reportLine(sweep(library, runs, { style }));
  }

  console.log(paint('\nFixed deck (no drafting), balanced build', 'bold'));
  reportLine(sweep(library, runs, { style: BALANCED_STYLE, draft: false }));
  console.log();
}

main();
