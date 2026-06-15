/**
 * Interactive dungeon events: small, idle-safe moments that pause the auto-crawl
 * and ask the player to choose. Each event is pure data — a prompt plus 2-3
 * choices, each with weighted outcomes built from concrete EventEffects the sim
 * resolves through the same helpers combat/loot already use. One choice per event
 * is the `default` (the cautious option that auto-fires if the player is away, so
 * idling never softlocks).
 */
import type { DungeonEventDef } from '../types';

export const DUNGEON_EVENTS: Record<string, DungeonEventDef> = {
  strange_tomb: {
    id: 'strange_tomb',
    name: 'The Strange Tomb',
    minDepth: 1,
    rarity: 10,
    prompt:
      'A cracked stone sarcophagus squats in the corner, its lid slightly ajar. Something inside catches the torchlight. The seal is ancient and very much meant to stay shut.',
    choices: [
      {
        key: 'open',
        label: 'Pry it open',
        outcomes: [
          { weight: 40, effects: [{ k: 'loot' }, { k: 'morale', delta: 3 }], text: 'Treasure! The tomb was richer than it looked.' },
          { weight: 25, effects: [{ k: 'trap', dmgBase: 8, status: 'poisoned', statusTicks: 50 }, { k: 'morale', delta: -3 }], text: 'A cloud of grave-dust — everyone coughs and chokes.' },
          { weight: 20, effects: [{ k: 'spawnEnemy', defId: 'skeleton', elite: true }, { k: 'morale', delta: -5 }], text: 'Something very much NOT dead lurches out!' },
          { weight: 15, effects: [], text: 'Nothing but a politely surprised skeleton and stale air.' },
        ],
      },
      {
        key: 'leave',
        label: 'Leave it sealed',
        default: true,
        outcomes: [
          { weight: 90, effects: [{ k: 'morale', delta: 1 }], text: 'The party moves on, faintly relieved.' },
          { weight: 10, effects: [{ k: 'favor', delta: 1 }], text: 'A superstitious soul insists you did the right thing.' },
        ],
      },
    ],
  },

  stranger_in_need: {
    id: 'stranger_in_need',
    name: 'A Stranger Asking for Help',
    minDepth: 2,
    rarity: 7,
    prompt:
      "A ragged figure waves you down from the shadows. 'Thank the gods, real adventurers! Help me out of this pit and I'll make it worth your while — I swear it.'",
    choices: [
      {
        key: 'help',
        label: 'Help them up',
        outcomes: [
          { weight: 45, effects: [{ k: 'spawnAlly', defId: 'goblin', ttl: 1200 }, { k: 'morale', delta: 6 }], text: 'A real ally — they draw a blade and join the fight!' },
          { weight: 30, effects: [{ k: 'spawnEnemy', defId: 'goblin', count: 2 }, { k: 'morale', delta: -8 }], text: 'Ambush! The “stranger” was bait for bandits.' },
          { weight: 25, effects: [{ k: 'bless', ticks: 300 }, { k: 'favor', delta: 2 }], text: 'The grateful stranger lays a blessing on the whole party.' },
        ],
      },
      {
        key: 'potion',
        label: 'Toss them a potion and move on',
        outcomes: [{ weight: 100, effects: [{ k: 'spendPotion', kind: 'hp' }, { k: 'favor', delta: 1 }, { k: 'morale', delta: 2 }], text: 'You spare a potion. They bless your name.' }],
      },
      {
        key: 'walk',
        label: 'Walk past',
        default: true,
        outcomes: [
          { weight: 70, effects: [{ k: 'morale', delta: -2 }], text: 'You walk on. Someone mutters about it for a while.' },
          { weight: 30, effects: [{ k: 'morale', delta: 3 }], text: 'It WAS a trap — and you sidestepped it cleanly.' },
        ],
      },
    ],
  },

  mysterious_shrine: {
    id: 'mysterious_shrine',
    name: 'The Mysterious Shrine',
    minDepth: 1,
    rarity: 9,
    prompt:
      'A moss-furred shrine to a forgotten god stands here, offering bowl empty, eyes carved watchful. You could leave an offering... or help yourself to what others left.',
    choices: [
      {
        key: 'pray',
        label: 'Pray and offer 25 gold',
        outcomes: [{ weight: 100, effects: [{ k: 'spendGold', amount: 25 }, { k: 'favor', delta: 3 }, { k: 'bless', ticks: 200 }], text: 'The god accepts. A warm blessing settles over the party.' }],
      },
      {
        key: 'desecrate',
        label: 'Desecrate it for loot',
        outcomes: [
          { weight: 50, effects: [{ k: 'loot' }, { k: 'favor', delta: -4 }], text: 'You pocket the offerings. The carved eyes narrow.' },
          { weight: 30, effects: [{ k: 'trap', dmgBase: 12 }, { k: 'favor', delta: -6 }], text: 'Divine wrath! A searing light scours the party.' },
          { weight: 20, effects: [{ k: 'favor', delta: -4 }, { k: 'morale', delta: 2 }], text: 'Some cheer, some shudder — you take the coins and go.' },
        ],
      },
      {
        key: 'bow',
        label: 'Bow and move on',
        default: true,
        outcomes: [{ weight: 100, effects: [{ k: 'favor', delta: 1 }], text: 'You bow respectfully. The shrine watches you leave.' }],
      },
    ],
  },

  wounded_adventurer: {
    id: 'wounded_adventurer',
    name: 'The Wounded Adventurer',
    minDepth: 2,
    rarity: 6,
    prompt:
      "A fellow delver lies slumped against the wall, clutching a gashed leg and a heavy-looking pack. 'Can't... walk. Take my gear, just tell my guild I made it deep, would you?'",
    choices: [
      {
        key: 'bind',
        label: 'Bind their wounds (costs a potion)',
        outcomes: [
          { weight: 60, effects: [{ k: 'spendPotion', kind: 'hp' }, { k: 'loot' }, { k: 'favor', delta: 2 }, { k: 'morale', delta: 4 }], text: 'Patched up and grateful, they hand over their pack.' },
          { weight: 40, effects: [{ k: 'spendPotion', kind: 'hp' }, { k: 'spawnAlly', defId: 'skeleton', ttl: 900 }, { k: 'morale', delta: 5 }], text: 'They recover enough to fight their way out alongside you!' },
        ],
      },
      {
        key: 'take',
        label: 'Take the pack, leave them',
        outcomes: [
          { weight: 70, effects: [{ k: 'loot' }, { k: 'favor', delta: -3 }, { k: 'morale', delta: -6 }], text: 'You take the pack and walk. Nobody says much.' },
          { weight: 30, effects: [{ k: 'trap', dmgBase: 10, selfOnly: true }, { k: 'morale', delta: -4 }], text: 'The pack was booby-trapped by its paranoid owner.' },
        ],
      },
      {
        key: 'promise',
        label: 'Promise to send help, move on',
        default: true,
        outcomes: [{ weight: 100, effects: [{ k: 'morale', delta: -1 }], text: 'You promise to send help. Everyone knows you won’t.' }],
      },
    ],
  },

  gambling_imp: {
    id: 'gambling_imp',
    name: 'The Gambling Imp',
    minDepth: 3,
    rarity: 5,
    prompt:
      "A pot-bellied imp shuffles a deck of bone cards on an overturned crate. 'Double or nothing, friends! One cut of the deck. Surely heroes such as YOU feel lucky.'",
    choices: [
      {
        key: 'wager',
        label: 'Wager 50 gold',
        outcomes: [
          { weight: 40, effects: [{ k: 'gold', amount: 100 }, { k: 'morale', delta: 4 }], text: 'Winner! The imp grumbles and pays out double.' },
          { weight: 45, effects: [{ k: 'spendGold', amount: 50 }, { k: 'morale', delta: -3 }], text: 'The imp cackles and rakes in your coin.' },
          { weight: 15, effects: [{ k: 'gold', amount: 250 }, { k: 'morale', delta: 6 }], text: 'JACKPOT — a triple! The imp vanishes in a puff of sulphur.' },
        ],
      },
      {
        key: 'refuse',
        label: 'Refuse to play',
        default: true,
        outcomes: [{ weight: 100, effects: [{ k: 'morale', delta: 1 }], text: 'The imp shrugs and deals himself a hand.' }],
      },
    ],
  },

  wishing_well: {
    id: 'wishing_well',
    name: 'The Wishing Well',
    minDepth: 1,
    rarity: 9,
    prompt:
      'An old well, water black and still, ringed with the tarnished coins of luckier — or unluckier — adventurers. A faint glow rises from far below. You could make a wish.',
    choices: [
      {
        key: 'wish',
        label: 'Toss in a coin and wish (10 gold)',
        outcomes: [
          { weight: 40, effects: [{ k: 'spendGold', amount: 10 }, { k: 'heal', amount: 12 }, { k: 'favor', delta: 2 }, { k: 'morale', delta: 3 }], text: 'A wish granted — a warm light knits the party’s wounds.' },
          { weight: 35, effects: [{ k: 'spendGold', amount: 10 }, { k: 'morale', delta: 1 }], text: 'Just a well. But it was a nice moment.' },
          { weight: 25, effects: [{ k: 'spawnEnemy', defId: 'slime' }, { k: 'morale', delta: -3 }], text: 'Something wishes BACK — a wet thing climbs out!' },
        ],
      },
      {
        key: 'fish',
        label: 'Fish the old coins out',
        outcomes: [
          { weight: 60, effects: [{ k: 'goldDepth', mult: 15 }, { k: 'favor', delta: -2 }], text: 'You scoop out fistfuls of tarnished coins. The wishes were not yours to take.' },
          { weight: 40, effects: [{ k: 'trap', dmgBase: 5, status: 'chilled', statusTicks: 80, selfOnly: true }, { k: 'goldDepth', mult: 7 }], text: 'You overbalance into the cold water — but come up with half the coins.' },
        ],
      },
      {
        key: 'moveon',
        label: 'Move on',
        default: true,
        outcomes: [{ weight: 100, effects: [], text: 'The well keeps its secrets and its coins.' }],
      },
    ],
  },
};

export const DUNGEON_EVENT_IDS = Object.keys(DUNGEON_EVENTS);
