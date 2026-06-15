/**
 * The Gambler's Cove — a seaside den of games of chance. Each game is a single
 * explicit player WAGER (a GAMBLE command applied at a tick boundary), resolved
 * with one draw from the seeded `rng.village` stream — so it's fully
 * deterministic and never touches wall-clock time. The player stakes village
 * gold; on a win they receive stake × payoutMult (a net gain of
 * (payoutMult−1)×stake), on a loss they forfeit the stake.
 *
 * Every game's expected value is deliberately BELOW the stake (winChance ×
 * payoutMult < 1) — the house always keeps a small edge, so the Cove is a gold
 * SINK — but the variance is the point: longshots like the Kraken Pot pay big.
 *
 * The auto-gamble "addicted" trait (a hero gambling its own purse while idle)
 * is deferred: it would accrue against wall-clock time, the one thing the sim
 * forbids. The Cove ships as pure, player-driven bets only.
 */
import type { CoveGame } from '../types';

export const COVE_GAMES: Record<string, CoveGame> = {
  coin_flip: {
    id: 'coin_flip',
    name: 'Captain’s Coin',
    blurb: 'Call it in the air. Heads you double, tails it’s gone.',
    winChance: 0.48,
    payoutMult: 2,
    minStake: 5,
    maxStake: 250,
    win: 'The coin lands true — {gold} gold richer!',
    lose: 'Wrong side up. The coin vanishes into the barkeep’s apron.',
  },
  dice_duel: {
    id: 'dice_duel',
    name: 'Dead Man’s Dice',
    blurb: 'Beat the house’s roll. The bones remember every loser.',
    winChance: 0.42,
    payoutMult: 2.2,
    minStake: 5,
    maxStake: 200,
    win: 'Boxcars! The dice fall your way for {gold} gold.',
    lose: 'Snake eyes. The house rakes the stake off the felt.',
  },
  high_card: {
    id: 'high_card',
    name: 'Cut the Deck',
    blurb: 'Draw higher than the dealer. One card, no take-backs.',
    winChance: 0.45,
    payoutMult: 2.1,
    minStake: 5,
    maxStake: 200,
    win: 'A face card! You cut the deck clean for {gold} gold.',
    lose: 'A two of cups. The dealer doesn’t even look up.',
  },
  wheel: {
    id: 'wheel',
    name: 'The Drowned Wheel',
    blurb: 'Spin the barnacled wheel. Land on gold, not the kraken.',
    winChance: 0.3,
    payoutMult: 3,
    minStake: 5,
    maxStake: 150,
    win: 'The wheel clatters to GOLD — a tidy {gold}!',
    lose: 'It stops on a little carved kraken. Of course it does.',
  },
  kraken_pot: {
    id: 'kraken_pot',
    name: 'Feed the Kraken',
    blurb: 'A longshot for a fortune. It almost never bites. Almost.',
    winChance: 0.1,
    payoutMult: 8,
    minStake: 5,
    maxStake: 60,
    win: 'THE KRAKEN BITES! It coughs up {gold} gold and a belch.',
    lose: 'The pot stays shut. The tentacle waves you off, politely.',
  },
};

export const COVE_GAME_IDS = Object.keys(COVE_GAMES);
