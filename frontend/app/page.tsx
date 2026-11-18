'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CiaLogo } from '../components/CiaLogo';
import { Icon, type IconName } from '../components/Icon';
import { StatusChart } from '../components/StatusChart';
import { api } from '../lib/api';
import { getSessionUser, hasPermission } from '../lib/session';

type Summary = { total: number; totalValue: string | number; byStatus: Array<{ status: string; _count: { _all: number } }>; countsAreGlobal?: boolean };
type Pool = { id: string; name: string; _count: { assets: number; folders: number } };
type Category = { id: string; name: string; assetTotal: number; _count: { assets: number } };
type RecentAsset = { id: string; name: string; patrimonyNumber: string; status: string; pool: { name: string }; category: { name: string } };
const statuses = [
  { key: 'IN_USE', label: 'Em uso', color: '#2563eb' },
  { key: 'AVAILABLE', label: 'Disponíveis', color: '#10b981' },
  { key: 'MAINTENANCE', label: 'Em manutenção', color: '#f59e0b' },
];
const number = (value: number) => value.toLocaleString('pt-BR');

export default function Dashboard() {
  const [data, setData] = useState<Summary | null>(null);
  const [pools, setPools] = useState<Pool[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [canCreate, setCanCreate] = useState(false);
  const [canImport, setCanImport] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [sectorOrder, setSectorOrder] = useState<'count' | 'name'>('count');
  const [recent, setRecent] = useState<RecentAsset[]>([]);
  const [recentError, setRecentError] = useState(false);

  async function load() {
    setLoading(true); setError('');
    try {
      const [summary, poolData, categoryData, recentData] = await Promise.allSettled([
        api<Summary>('/assets/summary'), api<Pool[]>('/pools'), api<Category[]>('/categories'), api<{ items: RecentAsset[] }>('/assets?pageSize=5'),
      ]);
      if (summary.status === 'fulfilled') { setData(summary.value); setUpdatedAt(new Date()); }
      else setError('Não foi possível atualizar os indicadores. Os últimos dados disponíveis foram mantidos.');
      if (poolData.status === 'fulfilled') setPools(poolData.value);
      else setError(current => current || 'Não foi possível atualizar os setores. Tente novamente.');
      if (categoryData.status === 'fulfilled') setCategories(categoryData.value);
      else setError(current => current || 'Não foi possível atualizar as categorias. Tente novamente.');
      setRecentError(recentData.status === 'rejected');
      if (recentData.status === 'fulfilled') setRecent(recentData.value.items);
    } catch { setError('Não foi possível atualizar os indicadores. Tente novamente.'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    const session = getSessionUser();
    setName(session?.name?.split(' ')[0] || '');
    setCanCreate(hasPermission('ASSET_CREATE', session));
    setCanImport(hasPermission('IMPORT_ASSETS', session));
    setIsAdmin(session?.role === 'ADMIN');
    void load();
  }, []);

  const count = (status: string) => data?.byStatus.find(item => item.status === status)?._count._all || 0;
  const total = data?.total || 0;
  const money = Number(data?.totalValue || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const known = new Set(statuses.map(s => s.key));
  const distribution = [...statuses, { key: 'OTHER', label: 'Outras situações', color: '#a9b1c0' }].map(s => ({
    ...s, count: s.key === 'OTHER'
      ? (data?.byStatus.filter(item => !known.has(item.status)).reduce((sum, item) => sum + item._count._all, 0) || 0)
      : count(s.key),
  }));
  const topPools = [...pools].sort((a, b) => sectorOrder === 'count' ? b._count.assets - a._count.assets : a.name.localeCompare(b.name, 'pt-BR')).slice(0, 5);
  const maxPool = Math.max(...pools.map(p => p._count.assets), 1);
  const metrics: Array<{ label: string; value: string; note: string; icon: IconName; tone: string; href: string }> = [
    { label: 'Total de ativos', value: number(total), note: 'Bens no inventário', icon: 'box', tone: 'blue', href: '/assets' },
    { label: 'Em uso', value: number(count('IN_USE')), note: `${total ? Math.round(count('IN_USE') / total * 100) : 0}% dos ativos cadastrados`, icon: 'check', tone: 'green', href: '/assets?status=IN_USE' },
    { label: 'Disponíveis', value: number(count('AVAILABLE')), note: 'Prontos para alocar', icon: 'layers', tone: 'orange', href: '/assets?status=AVAILABLE' },
  ];
  const shortcuts: Array<{ href: string; icon: IconName; label: string; description: string }> = [
    { href: '/assets', icon: 'search', label: 'Explorar ativos', description: 'Localize um patrimônio' },
    { href: '/stock', icon: 'layers', label: 'Estoque e componentes', description: 'Consulte saldos e movimentações' },
    canImport
      ? { href: '/imports', icon: 'upload', label: 'Importar planilha', description: 'Traga seus dados para cá' }
      : { href: '/pools', icon: 'grid', label: 'Explorar setores', description: 'Consulte a organização dos ativos' },
  ];

  return <div className="dashboard home-dashboard">
    <header className="home-heading">
      <div><div className="home-eyebrow"><span className="welcome-dot" />OLÁ{name ? `, ${name.toLocaleUpperCase('pt-BR')}` : ''}. SEU WORKSPACE ESTÁ AQUI.</div><h1>Seu patrimônio.<br className="dashboard-title-break" /> <span>Sob controle.</span></h1><p>Acompanhe os recursos, encontre o que precisa e cuide do próximo passo.</p></div>
      <div className="home-heading-actions">
        <button type="button" className="refresh-button" onClick={() => void load()} disabled={loading} aria-label="Atualizar indicadores"><Icon name="refresh" /><span>Atualizar</span></button>
        <Link href={canCreate ? '/assets#new-asset' : '/assets'} className="primary"><Icon name={canCreate ? 'plus' : 'search'} />{canCreate ? 'Novo ativo' : 'Consultar ativos'}</Link>
      </div>
    </header>

    {error && <div className="notice notice-error" role="alert">{error} <button className="retry-button" onClick={() => void load()} disabled={loading}>Tentar novamente</button></div>}
    {data?.countsAreGlobal && !isAdmin && <div className="notice notice-info">Os indicadores consideram todos os setores. As distribuições por setor e categoria respeitam os acessos da sua conta.</div>}

    <div className="overview-context"><span><Icon name="grid" />Visão geral do inventário<span className="context-scope">{data?.countsAreGlobal ? 'Indicadores globais' : 'Seus setores'}</span></span>{updatedAt && <time dateTime={updatedAt.toISOString()}><Icon name="calendar" />{updatedAt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })}</time>}</div>

    <section className="home-overview" aria-label="Resumo do patrimônio" aria-busy={loading}>
      <div className="home-stats">
        {metrics.map(metric => <Link className={`card metric-card metric-${metric.tone}`} href={metric.href} key={metric.label}>
          <div className={`home-stat-icon kpi-${metric.tone}`}><Icon name={metric.icon} /></div>
          <span className="home-stat-label">{metric.label}</span>
          <strong className="metric-value">{loading ? <span className="skeleton">&nbsp;</span> : data ? metric.value : '—'}</strong>
          <div className="metric-note"><span>{metric.note}</span><Icon name="arrow" /></div>
        </Link>)}
      </div>
      <div className="portfolio-card">
        <div className="portfolio-decoration" aria-hidden="true"><CiaLogo size={175} /></div>
        <div className="portfolio-top"><span><Icon name="wallet" />VALOR PATRIMONIAL</span><span className="portfolio-tag">VISÃO CONSOLIDADA</span></div>
        <strong className="portfolio-value">{loading ? <span className="skeleton">&nbsp;</span> : data ? money : '—'}</strong>
        <p>Valor de aquisição dos ativos registrados.</p>
        <div className="portfolio-bottom"><span><span className={`sync-dot${loading ? ' syncing' : ''}`} />{loading ? 'Atualizando…' : updatedAt ? `Atualizado às ${updatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}` : 'Dados indisponíveis'}</span><Link href="/assets" aria-label="Consultar patrimônio"><Icon name="arrow" /></Link></div>
      </div>
    </section>

    <nav className="home-shortcuts" aria-label="Acessos rápidos">
      {shortcuts.map(item => <Link href={item.href} key={item.href}><span className="shortcut-icon"><Icon name={item.icon} /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><Icon name="arrow" /></Link>)}
    </nav>

    <div className="home-section-title"><div><span className="home-eyebrow">PATRIMÔNIO EM FOCO</span><h2>Entenda a sua operação</h2></div><span>Dados da consulta atual</span></div>
    <section className="dashboard-charts home-charts">
      <div className="card section-card distribution-card">
        <div className="section-heading"><div><h2>Situação dos ativos</h2><p>Como o patrimônio está sendo utilizado.</p></div><span className="heading-icon"><Icon name="chart" /></span></div>
        {loading ? <div className="chart-placeholder" role="status"><div className="skeleton-ring" /><span>Carregando indicadores…</span></div> : !data ? <div className="empty-state">Indicadores indisponíveis.</div> : <StatusChart segments={distribution} total={total} />}
      </div>
      <div className="card section-card home-sectors">
        <div className="section-heading"><div><h2>Patrimônio por setor</h2><p>Onde os recursos estão alocados.</p></div><Link href="/pools" className="text-link">Todos os setores <Icon name="arrow" /></Link></div>
        <div className="sector-controls"><div className="segmented-control" role="group" aria-label="Ordenar setores"><button type="button" aria-pressed={sectorOrder === 'count'} onClick={() => setSectorOrder('count')}>Mais ativos</button><button type="button" aria-pressed={sectorOrder === 'name'} onClick={() => setSectorOrder('name')}>Nome A–Z</button></div><span>{pools.length} setores no seu acesso</span></div>
        <div className="sector-bars">{topPools.map((pool, i) => <Link href={`/assets?poolId=${encodeURIComponent(pool.id)}`} className="sector-row" key={pool.id}><div><span className="sector-name"><span className="sector-rank">{String(i + 1).padStart(2, '0')}</span>{pool.name}</span><strong>{number(pool._count.assets)} <small>ativos</small></strong></div><div className="bar-track"><span style={{ width: `${pool._count.assets / maxPool * 100}%`, opacity: 1 - i * .12 }} /></div></Link>)}</div>
        {!pools.length && <div className="empty-state">{loading ? 'Carregando setores…' : error ? 'Setores indisponíveis.' : 'Seus setores aparecerão aqui após o cadastro.'}</div>}
      </div>
    </section>

    <section className="card section-card recent-assets" aria-busy={loading}>
      <div className="section-heading"><div><span className="section-kicker">SEMPRE POR PERTO</span><h2>Últimos ativos cadastrados</h2><p>Continue a partir dos registros mais recentes dos seus setores.</p></div><Link href="/assets" className="text-link">Ver todos <Icon name="arrow" /></Link></div>
      {loading ? <div className="recent-loading" role="status" aria-label="Carregando ativos recentes">{Array.from({ length: 3 }, (_, index) => <div className="skeleton" key={index} />)}</div> : recentError ? <div className="empty-state">Não foi possível consultar os ativos recentes. <button className="retry-button" onClick={() => void load()}>Tentar novamente</button></div> : recent.length ? <div className="recent-list">{recent.map(asset => <Link href={`/assets/${asset.id}`} key={asset.id} className="recent-asset"><span className="recent-asset-icon"><Icon name="box" /></span><span className="recent-asset-name"><strong>{asset.name}</strong><small>{asset.patrimonyNumber} <span>·</span> {asset.category.name}</small></span><span className="recent-asset-pool">{asset.pool.name}</span><span className={`asset-status asset-status-${asset.status.toLowerCase()}`}>{({ AVAILABLE: 'Disponível', IN_USE: 'Em uso', MAINTENANCE: 'Manutenção', RESERVED: 'Reservado', DAMAGED: 'Danificado', LOST: 'Perdido', LOANED: 'Emprestado', DISPOSED: 'Baixado', SOLD: 'Vendido', INACTIVE: 'Inativo' } as Record<string, string>)[asset.status] || asset.status}</span><Icon name="arrow" /></Link>)}</div> : <div className="empty-state illustrated-empty"><Icon name="box" /><strong>Seu inventário começa aqui.</strong><span>Os novos ativos aparecerão nesta lista.</span>{canCreate && <Link className="text-link" href="/assets#new-asset">Cadastrar primeiro ativo <Icon name="arrow" /></Link>}</div>}
    </section>

    <section className="home-bottom-grid">
      <div className="card section-card home-categories">
        <div className="section-heading"><div><h2>Explore por categoria</h2><p>Um caminho mais curto para encontrar o que precisa.</p></div><Link href="/structure" className="text-link">Ver estrutura <Icon name="arrow" /></Link></div>
        <div className="category-tiles">{[...categories].sort((a, b) => b.assetTotal - a.assetTotal).slice(0, 6).map(category => <Link key={category.id} href={`/assets?categoryId=${encodeURIComponent(category.id)}`}><Icon name="box" /><strong>{category.name}</strong><span>{number(category.assetTotal)} ativos</span><Icon name="arrow" /></Link>)}</div>
        {!categories.length && <div className="empty-state">{loading ? 'Carregando categorias…' : error ? 'Categorias indisponíveis.' : 'Nenhuma categoria cadastrada.'}</div>}
      </div>
      <aside className="home-attention">
        <span className="attention-icon"><Icon name="alert" /></span><div className="home-eyebrow">PRÓXIMOS PASSOS</div><h2>O que precisa<br />da sua atenção.</h2>
        <p>Uma consulta rápida para acompanhar os bens que precisam de cuidado.</p>
        {(['MAINTENANCE', 'DAMAGED', 'LOST'] as const).map(status => <Link className="attention-row" key={status} href={`/assets?status=${status}`}><span>{({ MAINTENANCE: 'Em manutenção', DAMAGED: 'Danificados', LOST: 'Não localizados' })[status]}</span><strong>{data ? number(count(status)) : '—'}</strong><Icon name="arrow" /></Link>)}
      </aside>
    </section>
    <footer className="dashboard-footer"><span><Icon name="shield" /> Cia do Crédito · Inventário corporativo</span><span>Informações conforme o acesso da sua conta</span></footer>
  </div>;
}
