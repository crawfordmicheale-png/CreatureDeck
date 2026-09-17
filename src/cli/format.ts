/** Terminal rendering helpers for cards, decks and battle logs. */

import type { BattleEvent } from '../battle/types.ts';
import type { ResolvedCard } from '../core/cardInstance.ts';
import { xpToNextLevel } from '../core/leveling.ts';
import { STAT_KEYS, STAT_LABELS } from '../core/stats.ts';

const ESC = String.fromCharCode(27);
const useColor = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;

const CODES: Record<string, string> = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  grey: `${ESC}[90m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`,
  magenta: `${ESC}[35m`,
  cyan: `${ESC}[36m`,
  white: `${ESC}[97m`,
};

export function paint(text: string, ...styles: string[]): string {
  if (!useColor) return text;
  const prefix = styles.map((style) => CODES[style] ?? '').join('');
  return `${prefix}${text}${CODES['reset']}`;
}

const RARITY_STYLE: Record<string, string> = {
  common: 'grey',
  uncommon: 'green',
  rare: 'blue',
  epic: 'magenta',
  mythic: 'yellow',
};

const TIER_STYLE: Record<string, string> = {
  weak: 'grey',
  normal: 'white',
  elite: 'cyan',
  legendary: 'yellow',
  ascendant: 'red',
};

// Colour codes inflate string length, so padded columns need slack when on.
const RARITY_PAD = useColor ? 18 : 9;
const TIER_PAD = useColor ? 26 : 13;

export function rarityTag(card: ResolvedCard): string {
  return paint(card.rarity.label, RARITY_STYLE[card.definition.rarity] ?? 'white');
}

export function tierTag(card: ResolvedCard): string {
  const styled = paint(card.tier.label, TIER_STYLE[card.powerTier] ?? 'white', 'bold');
  return card.promoted ? `${styled}${paint(' (promoted)', 'green')}` : styled;
}

export function statLine(card: ResolvedCard): string {
  return STAT_KEYS.map(
    (key) => `${STAT_LABELS[key].slice(0, 3)} ${String(card.stats[key]).padStart(3)}`,
  ).join('  ');
}

export function heading(text: string): string {
  return `\n${paint(text, 'bold', 'white')}\n${paint('='.repeat(text.length), 'grey')}`;
}

/** Fills {placeholders} in an ability description from its params. */
export function describeAbility(
  description: string,
  params: Readonly<Record<string, number>>,
): string {
  return description.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

/** A full card panel — the view a player gets when inspecting one of their copies. */
export function formatCard(card: ResolvedCard, indent = ''): string {
  const lines: string[] = [];
  const level = card.isMaxLevel ? `L${card.level} (max)` : `L${card.level}`;

  lines.push(
    `${paint(card.displayName, 'bold')}  ${rarityTag(card)} / ${tierTag(card)} / ${paint(level, 'dim')}`,
  );
  lines.push(
    `${statLine(card)}   ${paint(`score ${card.powerScore}`, 'dim')}  ${paint(`cost ${card.deployCost}`, 'dim')}`,
  );

  const allocated = STAT_KEYS.filter((key) => card.instance.allocation[key] > 0)
    .map((key) => `${STAT_LABELS[key]} +${card.instance.allocation[key]}`)
    .join(', ');
  lines.push(
    `${paint('points', 'dim')} ${card.pointsSpent}/${card.pointsEarned} spent${
      allocated ? ` - ${allocated}` : ''
    }${card.pointsUnspent > 0 ? paint(`  (${card.pointsUnspent} unspent)`, 'yellow') : ''}`,
  );

  for (const ability of card.abilities) {
    lines.push(
      `${paint('*', 'green')} ${paint(ability.name, 'bold')} - ${describeAbility(ability.description, ability.params)}`,
    );
  }
  for (const ability of card.lockedAbilities) {
    const slot = card.definition.abilities.find((entry) => entry.abilityId === ability.id);
    lines.push(paint(`* ${ability.name} - locked until level ${slot?.unlockLevel ?? '?'}`, 'dim'));
  }

  if (card.scoreToNextTier !== null) {
    lines.push(paint(`${card.scoreToNextTier} power score to the next tier.`, 'dim'));
  }
  if (!card.isMaxLevel) {
    const needed = xpToNextLevel(card.definition.rarity, card.level);
    lines.push(paint(`XP ${card.instance.xp}/${needed} to level ${card.level + 1}.`, 'dim'));
  }

  return lines.map((line) => indent + line).join('\n');
}

export function formatCardRow(card: ResolvedCard): string {
  return [
    card.displayName.padEnd(31),
    rarityTag(card).padEnd(RARITY_PAD),
    tierTag(card).padEnd(TIER_PAD),
    `L${String(card.level).padStart(2)}`,
    statLine(card),
    paint(`score ${String(card.powerScore).padStart(4)}`, 'dim'),
    paint(`cost ${card.deployCost}`, 'dim'),
  ].join('  ');
}

const EVENT_STYLE: Partial<Record<BattleEvent['type'], string>> = {
  'round-start': 'bold',
  deploy: 'cyan',
  ability: 'magenta',
  death: 'red',
  revive: 'green',
  heal: 'green',
  'nexus-damage': 'yellow',
  'battle-end': 'bold',
  dodge: 'dim',
};

export function formatEvent(event: BattleEvent): string {
  const style = EVENT_STYLE[event.type];
  const text = event.type === 'round-start' ? `\n${event.message}` : `  ${event.message}`;
  return style ? paint(text, style) : text;
}

/** Battle logs are verbose; this trims the blow-by-blow unless asked for it. */
export function formatLog(log: readonly BattleEvent[], options: { verbose?: boolean } = {}): string {
  const noisy = new Set<BattleEvent['type']>(['draw', 'damage', 'attack', 'dodge']);
  return log
    .filter((event) => options.verbose === true || !noisy.has(event.type))
    .map(formatEvent)
    .join('\n');
}
