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

export * from './battle/types.ts';
export * from './battle/engine.ts';
export * from './battle/controllers.ts';
export { ABILITY_HANDLERS, hooksFor } from './battle/abilityHandlers.ts';

export * from './game/collection.ts';
export * from './game/deck.ts';
export * from './game/rewards.ts';

export { ABILITIES, CREATURES, STANDARD_LIBRARY } from './content/index.ts';
