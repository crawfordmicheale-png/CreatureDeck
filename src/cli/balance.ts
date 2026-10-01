/**
 * Balance harness.
 *
 *   npm run balance            200 runs per style
 *   npm run balance -- 600     more runs
 *
 * Walks generated maps with the AI on both sides — routing, fighting,
 * drafting, resting and levelling — so what it reports is the game as
 * published rather than an idealised version of it.
 *
 * What to look for:
 *   - The opening rows should be comfortably winnable. If depth 0 is under
 *     half, the starting deck is structurally behind and no play skill fixes it.
 *   - Fights that end in a handful of turns are decided before the stamina and
 *     lane decisions ever come up.
 *   - A style that cannot clear is a trap, not a strategy.
 */

import { STANDARD_LIBRARY } from '../content/index.ts';
import { AGGRESSIVE_STYLE, BALANCED_STYLE, DEFENSIVE_STYLE, sweep } from '../game/runSim.ts';
import type { PlayerStyle, SweepReport } from '../game/runSim.ts';
import { heading, paint } from './format.ts';

const library = STANDARD_LIBRARY;

/** Per-fight win rate we are aiming for, easing down as the map climbs. */
function target(depth: number): number {
  return Math.max(0.5, 0.82 - depth * 0.03);
}

function report(label: string, data: SweepReport): void {
  console.log(paint(`\n${label}`, 'bold'));

  for (const row of data.depths) {
    if (row.played < 5) continue;
    const want = target(row.depth);
    const delta = row.winRate - want;
    const flag =
      Math.abs(delta) <= 0.12
        ? paint('on target', 'green')
        : delta > 0
          ? paint(`${Math.round(delta * 100)}pt easy`, 'yellow')
          : paint(`${Math.round(-delta * 100)}pt hard`, 'red');
    console.log(
      `  row ${String(row.depth).padStart(2)}` +
        `  fought ${String(row.played).padStart(4)}` +
        `  won ${String(Math.round(row.winRate * 100)).padStart(3)}%` +
        ` (want ${Math.round(want * 100)}%)` +
        `  ${row.averageTurns.toFixed(0).padStart(2)} turns  ${flag}`,
    );
  }

  const kinds = Object.entries(data.byKind)
    .map(([kind, v]) => `${kind} ${Math.round((v.won / Math.max(1, v.played)) * 100)}%`)
    .join('  ');
  console.log(`  ${paint('by node', 'dim')} ${kinds}`);
  console.log(
    `  ${paint('clears', 'bold')} ${data.clears}/${data.runs} ` +
      `(${Math.round(data.clearRate * 100)}%)   average depth ${data.averageDepth.toFixed(1)}/12`,
  );
  if (data.worst.length > 0) {
    const worst = data.worst
      .slice(0, 3)
      .map((e) => `${e.name} ${Math.round(e.winRate * 100)}%`)
      .join('  ·  ');
    console.log(`  ${paint('hardest', 'dim')} ${worst}`);
  }
}

function main(): void {
  const runs = Number(process.argv[2] ?? 200);
  console.log(heading(`Map sweep — ${runs} runs per style`));

  const styles: readonly PlayerStyle[] = [BALANCED_STYLE, AGGRESSIVE_STYLE, DEFENSIVE_STYLE];
  for (const style of styles) report(`${style.name} build`, sweep(library, runs, { style }));

  report('Balanced, no drafting', sweep(library, runs, { style: BALANCED_STYLE, draft: false }));
  console.log();
}

main();
