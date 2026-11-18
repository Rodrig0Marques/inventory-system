'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from './Icon';

type Segment = { key: string; label: string; color: string; count: number };
const format = (value: number) => value.toLocaleString('pt-BR');

export function StatusChart({ segments, total }: { segments: Segment[]; total: number }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const active = segments.find(s => s.key === (hovered || selected));
  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return <>
    <div className="distribution-content">
      <div className="status-chart">
        <svg viewBox="0 0 200 200" aria-hidden="true" className="status-ring">
          <circle cx="100" cy="100" r={radius} fill="none" stroke="var(--soft)" strokeWidth="17" />
          {segments.map(segment => {
            const length = total ? segment.count / total * circumference : 0;
            const start = offset; offset += length;
            return segment.count > 0 && <circle key={segment.key} cx="100" cy="100" r={radius} fill="none" stroke={segment.color} strokeWidth={active?.key === segment.key ? 22 : 17} strokeDasharray={`${Math.max(0, length - 4)} ${circumference - Math.max(0, length - 4)}`} strokeDashoffset={-start} strokeLinecap="round" transform="rotate(-90 100 100)" style={{ opacity: active && active.key !== segment.key ? .22 : 1 }} onMouseEnter={() => setHovered(segment.key)} onMouseLeave={() => setHovered(null)} />;
          })}
        </svg>
        <div className="status-chart-center" aria-live="polite" aria-atomic="true"><strong>{format(active ? active.count : total)}</strong><span>{active ? active.label : 'ativos no total'}</span>{active && <small>{total ? Math.round(active.count / total * 100) : 0}% do patrimônio</small>}</div>
      </div>
      <div className="chart-legend" aria-label="Explorar situação dos ativos">
        {segments.map(segment => <button type="button" className={`legend-row${selected === segment.key ? ' selected' : ''}`} key={segment.key} aria-pressed={selected === segment.key} onClick={() => setSelected(current => current === segment.key ? null : segment.key)} onMouseEnter={() => setHovered(segment.key)} onMouseLeave={() => setHovered(null)}><span className="legend-dot" style={{ background: segment.color }} /><span>{segment.label}</span><strong>{format(segment.count)}</strong><small>{total ? Math.round(segment.count / total * 100) : 0}%</small></button>)}
      </div>
    </div>
    <div className="chart-insight"><span>{selected ? 'Situação selecionada' : 'Explore seu inventário'}<small>{selected ? segments.find(s => s.key === selected)?.label : 'Selecione uma situação para ver os detalhes.'}</small></span><Link className="text-link" href={selected && selected !== 'OTHER' ? `/assets?status=${encodeURIComponent(selected)}` : '/assets'}>Ver ativos <Icon name="arrow" /></Link></div>
  </>;
}
