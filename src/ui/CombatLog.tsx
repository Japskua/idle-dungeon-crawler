import { useEffect, useRef } from 'react';
import { useUi } from './store';

export function CombatLog() {
  const log = useUi((s) => s.log);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);
  return (
    <div className="combat-log" ref={ref}>
      {log.slice(-80).map((e) => (
        <div key={e.id} className={`log-line log-${e.cls}`}>
          {e.text}
        </div>
      ))}
    </div>
  );
}
