import { useEffect, useRef } from 'react';
import type { Hero, ItemInstance } from '../game/types';
import { ITEMS } from '../game/content';
import { derive } from '../game/hero/derive';
import { atlasDraw, getAtlas } from '../render/spriteCompiler';

/** An animated pixel portrait of a class (idle bob, faces right). */
export function ClassSprite({ classId, scale = 3 }: { classId: string; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    let frame = 0;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      atlasDraw(ctx, getAtlas(), `hero/${classId}`, frame, 0, 0, false, scale);
    };
    draw();
    const iv = setInterval(() => {
      frame = 1 - frame;
      draw();
    }, 450);
    return () => clearInterval(iv);
  }, [classId, scale]);
  return <canvas ref={ref} width={16 * scale} height={16 * scale} className="class-sprite" />;
}

export function Bar({ value, max, color, label }: { value: number; max: number; color: string; label?: string }) {
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="bar" title={`${Math.floor(value)} / ${max}`}>
      <div className="bar-fill" style={{ width: `${frac * 100}%`, background: color }} />
      <span className="bar-label">
        {label ? `${label} ` : ''}
        {Math.floor(value)}/{max}
      </span>
    </div>
  );
}

const rarityColor: Record<string, string> = {
  common: '#b8b6cf',
  magic: '#4f7ad1',
  rare: '#f2c94c',
  epic: '#a14fd1',
};

export function itemLabel(item: ItemInstance): string {
  const def = ITEMS[item.defId];
  const affix = item.affixes[0];
  return `${def?.name ?? item.defId}${affix ? ` ${affix.name}` : ''}`;
}

export function ItemName({ item }: { item: ItemInstance }) {
  const def = ITEMS[item.defId];
  const stats: string[] = [];
  if (def?.base?.dmg) stats.push(`${def.base.dmg} dmg`);
  if (def?.base?.armor) stats.push(`${def.base.armor} armor`);
  if (def?.base?.stats) {
    for (const [k, v] of Object.entries(def.base.stats)) stats.push(`+${v} ${k}`);
  }
  for (const affix of item.affixes) {
    for (const mod of affix.mods) {
      if (mod.kind === 'attr') stats.push(`+${mod.add} ${mod.attr}`);
    }
  }
  if (def?.weight) stats.push(`${def.weight}kg`);
  const title = [def?.flavor, stats.join(', ')].filter(Boolean).join(' — ');
  return (
    <span className="item-name" style={{ color: rarityColor[item.rarity] }} title={title}>
      {itemLabel(item)}
      {stats.length > 0 && <span className="item-stats"> ({stats.join(', ')})</span>}
    </span>
  );
}

export function HeroVitals({ hero }: { hero: Hero }) {
  const d = derive(hero);
  return (
    <>
      <Bar value={hero.hp} max={d.maxHp} color="#4fae4f" label="HP" />
      <Bar value={hero.mp} max={d.maxMp} color="#4f7ad1" label="MP" />
    </>
  );
}
