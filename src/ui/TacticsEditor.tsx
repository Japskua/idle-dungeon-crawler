/**
 * The tactics editor: priority-ordered IF trigger THEN action rules, multiple
 * named sets per hero, switchable mid-run. Edits are local until Save.
 */
import { useEffect, useState } from 'react';
import { app } from '../app/loop';
import { telemetry } from '../app/telemetry';
import { CLASSES, SKILLS } from '../game/content';
import type { Hero, TacticAction, TacticRule, TacticSet, Trigger } from '../game/types';

let uid = 1;
const newId = () => `u${Date.now().toString(36)}_${uid++}`;

interface TriggerMeta {
  k: Trigger['k'];
  label: string;
  param?: 'pct' | 'n' | 'delta' | 'skillId';
  def?: number;
}

const TRIGGERS: TriggerMeta[] = [
  { k: 'always', label: 'Always' },
  { k: 'selfHpBelow', label: 'My HP below %', param: 'pct', def: 35 },
  { k: 'selfMpAbove', label: 'My MP above %', param: 'pct', def: 50 },
  { k: 'allyHpBelow', label: 'Ally HP below %', param: 'pct', def: 50 },
  { k: 'allyDowned', label: 'An ally is down' },
  { k: 'enemiesAtLeast', label: 'Enemies ≥ N', param: 'n', def: 3 },
  { k: 'enemyIsBoss', label: 'Facing a boss' },
  { k: 'enemyIsElite', label: 'Facing an elite' },
  { k: 'enemyLevelAbove', label: 'Enemy level ≥ mine +', param: 'delta', def: 3 },
  { k: 'inMeleeRange', label: 'Enemy in melee range' },
  { k: 'skillReady', label: 'Skill is ready', param: 'skillId' },
];

interface ActionMeta {
  k: TacticAction['k'];
  label: string;
  param?: 'skillId' | 'potion';
}

const ACTIONS: ActionMeta[] = [
  { k: 'attack', label: 'Attack with weapon' },
  { k: 'castSkill', label: 'Cast skill', param: 'skillId' },
  { k: 'usePotion', label: 'Drink potion', param: 'potion' },
  { k: 'defend', label: 'Defend' },
  { k: 'retreat', label: 'Retreat' },
  { k: 'carryAlly', label: 'Carry downed ally' },
  { k: 'wait', label: 'Wait' },
];

function makeTrigger(k: Trigger['k'], skillFallback: string): Trigger {
  const meta = TRIGGERS.find((t) => t.k === k)!;
  if (meta.param === 'skillId') return { k: 'skillReady', skillId: skillFallback };
  if (meta.param === 'pct') return { k, pct: meta.def ?? 50 } as Trigger;
  if (meta.param === 'n') return { k: 'enemiesAtLeast', n: meta.def ?? 3 };
  if (meta.param === 'delta') return { k: 'enemyLevelAbove', delta: meta.def ?? 3 };
  return { k } as Trigger;
}

function makeAction(k: TacticAction['k'], skillFallback: string): TacticAction {
  if (k === 'castSkill') return { k, skillId: skillFallback };
  if (k === 'usePotion') return { k, potion: 'hp' };
  return { k } as TacticAction;
}

function RuleRow({
  rule,
  hero,
  onChange,
  onMove,
  onDelete,
}: {
  rule: TacticRule;
  hero: Hero;
  onChange: (r: TacticRule) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  // learned skills (guild spellbook included) plus class unlocks still to come
  const classSkills = [
    ...new Set([...hero.skills, ...(CLASSES[hero.classId]?.skillUnlocks.map((u) => u.skillId) ?? [])]),
  ];
  const skillFallback = classSkills[0] ?? 'heal';
  const trigger = rule.trigger as Record<string, unknown> & Trigger;
  const action = rule.action as Record<string, unknown> & TacticAction;
  const triggerMeta = TRIGGERS.find((t) => t.k === trigger.k);
  const actionMeta = ACTIONS.find((a) => a.k === action.k);

  return (
    <div className={`rule-row ${rule.enabled ? '' : 'rule-disabled'}`}>
      <input
        type="checkbox"
        checked={rule.enabled}
        title="enabled"
        onChange={(e) => onChange({ ...rule, enabled: e.target.checked })}
      />
      <span className="muted small">IF</span>
      <select
        value={trigger.k}
        onChange={(e) => onChange({ ...rule, trigger: makeTrigger(e.target.value as Trigger['k'], skillFallback) })}
      >
        {TRIGGERS.map((t) => (
          <option key={t.k} value={t.k}>
            {t.label}
          </option>
        ))}
      </select>
      {triggerMeta?.param && triggerMeta.param !== 'skillId' && (
        <input
          className="num-input"
          type="number"
          value={Number(trigger[triggerMeta.param] ?? triggerMeta.def)}
          onChange={(e) =>
            onChange({ ...rule, trigger: { ...trigger, [triggerMeta.param!]: Number(e.target.value) } as Trigger })
          }
        />
      )}
      {triggerMeta?.param === 'skillId' && (
        <select
          value={String(trigger.skillId ?? skillFallback)}
          onChange={(e) => onChange({ ...rule, trigger: { k: 'skillReady', skillId: e.target.value } })}
        >
          {classSkills.map((s) => (
            <option key={s} value={s}>
              {SKILLS[s]?.name ?? s}
            </option>
          ))}
        </select>
      )}
      <span className="muted small">THEN</span>
      <select
        value={action.k}
        onChange={(e) => onChange({ ...rule, action: makeAction(e.target.value as TacticAction['k'], skillFallback) })}
      >
        {ACTIONS.map((a) => (
          <option key={a.k} value={a.k}>
            {a.label}
          </option>
        ))}
      </select>
      {actionMeta?.param === 'skillId' && (
        <select
          value={String(action.skillId ?? skillFallback)}
          onChange={(e) => onChange({ ...rule, action: { k: 'castSkill', skillId: e.target.value } })}
        >
          {classSkills.map((s) => (
            <option key={s} value={s}>
              {SKILLS[s]?.name ?? s} {hero.skills.includes(s) ? '' : '(locked)'}
            </option>
          ))}
        </select>
      )}
      {actionMeta?.param === 'potion' && (
        <select
          value={String(action.potion ?? 'hp')}
          onChange={(e) => onChange({ ...rule, action: { k: 'usePotion', potion: e.target.value as 'hp' | 'mp' } })}
        >
          <option value="hp">healing</option>
          <option value="mp">mana</option>
        </select>
      )}
      <span className="rule-buttons">
        <button className="btn btn-tiny" onClick={() => onMove(-1)} title="higher priority">
          ↑
        </button>
        <button className="btn btn-tiny" onClick={() => onMove(1)} title="lower priority">
          ↓
        </button>
        <button className="btn btn-tiny btn-danger" onClick={onDelete}>
          ✕
        </button>
      </span>
    </div>
  );
}

export function TacticsEditor({ hero, onClose }: { hero: Hero; onClose: () => void }) {
  const [sets, setSets] = useState<TacticSet[]>(() => JSON.parse(JSON.stringify(hero.tactics.sets)));
  const [activeId, setActiveId] = useState(hero.tactics.activeSetId);
  useEffect(() => {
    telemetry.bump('tactics_editor_opened');
  }, []);
  const current = sets.find((s) => s.id === activeId) ?? sets[0]!;

  const updateSet = (updated: TacticSet) => setSets(sets.map((s) => (s.id === updated.id ? updated : s)));

  const moveRule = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= current.rules.length) return;
    const rules = [...current.rules];
    const tmp = rules[i]!;
    rules[i] = rules[j]!;
    rules[j] = tmp;
    updateSet({ ...current, rules });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title">
          Tactics — {hero.name}
          <span className="muted small"> rules are checked top to bottom; first feasible one wins</span>
        </div>
        <div className="row">
          <span>
            {sets.map((s) => (
              <button
                key={s.id}
                className={`btn btn-small ${s.id === current.id ? 'active' : ''}`}
                onClick={() => setActiveId(s.id)}
              >
                {s.name}
              </button>
            ))}
            <button
              className="btn btn-small"
              title="duplicate current set"
              onClick={() => {
                const copy: TacticSet = JSON.parse(JSON.stringify(current));
                copy.id = newId();
                copy.name = `${current.name} copy`;
                setSets([...sets, copy]);
                setActiveId(copy.id);
              }}
            >
              + set
            </button>
          </span>
          <span className="row-buttons">
            <button
              className="btn btn-tiny"
              onClick={() => {
                const name = prompt('Set name:', current.name);
                if (name) updateSet({ ...current, name });
              }}
            >
              rename
            </button>
            <button
              className="btn btn-tiny btn-danger"
              disabled={sets.length <= 1}
              onClick={() => {
                const rest = sets.filter((s) => s.id !== current.id);
                setSets(rest);
                setActiveId(rest[0]!.id);
              }}
            >
              delete set
            </button>
          </span>
        </div>
        <div className="rules">
          {current.rules.map((rule, i) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              hero={hero}
              onChange={(r) => updateSet({ ...current, rules: current.rules.map((x) => (x.id === r.id ? r : x)) })}
              onMove={(dir) => moveRule(i, dir)}
              onDelete={() => updateSet({ ...current, rules: current.rules.filter((x) => x.id !== rule.id) })}
            />
          ))}
          {current.rules.length === 0 && (
            <div className="muted small">No rules: the hero will just attack the nearest enemy.</div>
          )}
        </div>
        <button
          className="btn btn-small"
          onClick={() =>
            updateSet({
              ...current,
              rules: [
                ...current.rules,
                { id: newId(), enabled: true, trigger: { k: 'always' }, action: { k: 'attack' } },
              ],
            })
          }
        >
          + rule
        </button>
        <div className="row modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              const rules = sets.flatMap((s) => s.rules).filter((r) => r.enabled);
              telemetry.track('tactics_saved', {
                cls: hero.classId,
                value: rules.length,
                payload: {
                  sets: sets.length,
                  triggers: rules.map((r) => r.trigger.k),
                  actions: rules.map((r) => r.action.k),
                },
              });
              app.dispatch({ t: 'SET_TACTICS', heroId: hero.id, sets, activeSetId: activeId });
              onClose();
            }}
          >
            Save tactics
          </button>
        </div>
      </div>
    </div>
  );
}
