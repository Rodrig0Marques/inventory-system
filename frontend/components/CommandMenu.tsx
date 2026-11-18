'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { navigation, normalizeSearch } from '../lib/navigation';
import { hasPermission, type SessionUser } from '../lib/session';
import { Dialog } from './Dialog';
import { Icon, type IconName } from './Icon';

type AssetResult = { id: string; name: string; patrimonyNumber: string; pool: { name: string } };
type Command = { id: string; href: string; label: string; detail: string; icon: IconName; group: string };

export function CommandMenu({ open, onClose, user }: { open: boolean; onClose: () => void; user: SessionUser | null }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [assets, setAssets] = useState<AssetResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const search = query.trim();

  useEffect(() => { if (open) { setQuery(''); setAssets([]); setError(''); setActive(0); input.current?.focus(); } }, [open]);

  useEffect(() => {
    if (!open || search.length < 2) { setAssets([]); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(''); setAssets([]);
    const timer = window.setTimeout(() => {
      api<{ items: AssetResult[] }>(`/assets?search=${encodeURIComponent(search)}&pageSize=5`, { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) setAssets(result.items); })
        .catch(() => { if (!controller.signal.aborted) setError('Não foi possível consultar os ativos. Tente novamente.'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, search]);

  const commands = useMemo(() => {
    const routes: Command[] = navigation.filter(item => !item.roles || (user && item.roles.includes(user.role)))
      .map(item => ({ ...item, id: item.href, detail: item.group, group: 'Navegar para' }));
    if (hasPermission('ASSET_CREATE', user)) routes.push({ id: 'create', href: '/assets#new-asset', label: 'Cadastrar novo ativo', detail: 'Patrimônio', icon: 'plus', group: 'Ações rápidas' });
    const matches = routes.filter(item => normalizeSearch(`${item.label} ${item.detail}`).includes(normalizeSearch(search)));
    if (search.length >= 2) {
      matches.push(...assets.map(asset => ({ id: asset.id, href: `/assets/${asset.id}`, label: asset.name, detail: `${asset.patrimonyNumber} · ${asset.pool.name}`, icon: 'box' as IconName, group: 'Ativos encontrados' })));
      matches.push({ id: 'search-all', href: `/assets?search=${encodeURIComponent(search)}`, label: `Buscar “${search}” em ativos`, detail: 'Ver todos os resultados', icon: 'search', group: 'Pesquisa' });
    }
    return matches;
  }, [search, assets, user]);

  useEffect(() => { setActive(0); }, [commands]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  function select(command: Command) { onClose(); router.push(command.href); }

  return <Dialog open={open} onClose={onClose} title="Busca rápida" className="command-dialog">
    <div className="command-input"><Icon name="search" /><input ref={input} autoComplete="off" spellCheck={false} role="combobox" aria-label="Buscar páginas e ativos" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={commands[active] ? `${listId}-${active}` : undefined} placeholder="Encontre um ativo ou acesse uma página…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(current => commands.length ? (current + (event.key === 'ArrowDown' ? 1 : -1) + commands.length) % commands.length : 0); }
      if (event.key === 'Enter' && commands[active]) { event.preventDefault(); select(commands[active]); }
    }} /><kbd>esc</kbd></div>
    <div ref={list} id={listId} className="command-results" role="listbox" aria-label="Resultados da busca" aria-busy={loading}>
      {commands.map((command, index) => <div key={command.id}>
        {(index === 0 || commands[index - 1].group !== command.group) && <div className="command-group" role="presentation">{command.group}</div>}
        <div id={`${listId}-${index}`} role="option" aria-selected={active === index} className="command-option" onMouseMove={() => setActive(index)} onClick={() => select(command)}><span className="command-option-icon"><Icon name={command.icon} /></span><span><strong>{command.label}</strong><small>{command.detail}</small></span><Icon name="arrow" /></div>
      </div>)}
      {!commands.length && <div className="empty-state">Digite ao menos dois caracteres para buscar ativos.</div>}
    </div>
    <div className="command-status" role="status">{loading ? 'Buscando ativos nos seus setores…' : error || (search.length >= 2 && !assets.length ? 'Nenhum ativo encontrado nesta busca.' : 'As buscas respeitam os setores da sua conta.')}</div>
    <div className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>↵</kbd> abrir</span><span><Icon name="command" /> Seu inventário, mais perto.</span></div>
  </Dialog>;
}
