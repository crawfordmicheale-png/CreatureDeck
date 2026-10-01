/** Public surface of the CreatureDeck engine. */

export * from './core/abilities.ts';
export * from './core/cardDefinition.ts';
export * from './core/cardInstance.ts';
export * from './core/leveling.ts';
export * from './core/library.ts';
export * from './core/powerTier.ts';
export * from './core/rarity.ts';
export * from './core/rng.ts';
export * from './core/scoring.ts';
export * from './core/stats.ts';
export * from './core/effects.ts';
export * from './core/upgrades.ts';

// The legacy auto-resolver in `src/battle/` is no longer the game — it is kept
// only for the CLI demo and the balance harness, and is not re-exported here.

export * from './game/collection.ts';
export * from './game/deck.ts';
export * from './game/rewards.ts';

export * from './duel/types.ts';
export * from './duel/engine.ts';
export * from './duel/ai.ts';
export { DUEL_ABILITIES, abilityText } from './duel/abilities.ts';
export { EFFECT_HANDLERS } from './duel/effects.ts';

export { ABILITIES, CREATURES, EFFECTS, EFFECT_BY_ID, STANDARD_LIBRARY } from './content/index.ts';
