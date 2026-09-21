'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { getSessionUser, hasPermission } from '../lib/session';

type Summary = { total: number; totalValue: string | number; byStatus: Array<{ status: string; _count: { _all: number } }>; countsAreGlobal?: boolean };
type Pool = { id: string; name: string; _count: { assets: number; folders: number } };
type Category = { id: string; name: string; _count: { assets: number } };

export default function Dashboard() {
  const [data, setData] = useState<Summary | null>(null);
  const [pools, setPools] = useState<Pool[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [canCreateAsset, setCanCreateAsset] = useState(false);
  const [canImport, setCanImport] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const session = getSessionUser();
    setCanCreateAsset(hasPermission('ASSET_CREATE', session));
    setCanImport(hasPermission('IMPORT_ASSETS', session));
    setIsAdmin(session?.role === 'ADMIN');
    Promise.all([
      api<Summary>('/assets/summary'),
      api<Pool[]>('/pools'),
      api<Category[]>('/categories'),
    ]).then(([summary, poolData, categoryData]) => {
      setData(summary);
      setPools(poolData);
      setCategories(categoryData);
    }).catch(() => {});
  }, []);

  const count = (status: string) => data?.byStatus.find(item => item.status === status)?._count._all || 0;
  const money = Number(data?.totalValue || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return <>
    <section className="hero-panel">
      <div>
        <div className="eyebrow hero-eyebrow">Visão geral</div>
        <h1>Controle seus ativos em um único lugar.</h1>
        <p>Acompanhe patrimônio, organização, responsáveis e importações de forma simples.</p>
        <div className="hero-actions">
          <Link className="hero-primary" href="/assets">{canCreateAsset ? 'Cadastrar ativo' : 'Consultar ativos'}</Link>
          {canImport && <Link className="hero-secondary" href="/imports">Importar planilha</Link>}
        </div>
      </div>
      <div className="hero-visual">
        <div className="hero-ring"><strong>{data?.total ?? 0}</strong><span>ativos</span></div>
      </div>
    </section>

    <div className="page-head dashboard-head">
      <div><div className="eyebrow">Indicadores</div><h2 className="page-section-title">Resumo patrimonial</h2></div>
    </div>

    {data?.countsAreGlobal && !isAdmin && <div className="notice notice-info">Os indicadores Total de ativos, Valor patrimonial, Em uso e Disponíveis consideram todos os Setores. A distribuição por Setor e as categorias continuam respeitando apenas os Setores liberados para sua conta.</div>}

    <section className="grid kpi-grid">
      <div className="card kpi-card"><div className="kpi-icon kpi-blue">A</div><div><div className="label">Total de ativos</div><div className="kpi">{data?.total ?? '-'}</div></div></div>
      <div className="card kpi-card"><div className="kpi-icon kpi-violet">R$</div><div><div className="label">Valor patrimonial</div><div className="kpi money-kpi">{money}</div></div></div>
      <div className="card kpi-card"><div className="kpi-icon kpi-green">U</div><div><div className="label">Em uso</div><div className="kpi">{count('IN_USE')}</div></div></div>
      <div className="card kpi-card"><div className="kpi-icon kpi-orange">D</div><div><div className="label">Disponíveis</div><div className="kpi">{count('AVAILABLE')}</div></div></div>
    </section>

    <section className="dashboard-bottom">
      <div className="card section-card">
        <div className="section-heading"><div><h2>Distribuição por setor</h2><p>Quantidade atual de ativos por agrupamento.</p></div><Link href="/pools" className="text-link">Ver setores</Link></div>
        <div className="simple-list">
          {pools.slice(0, 6).map(pool => <div className="simple-list-row" key={pool.id}><div><Link href={`/assets?poolId=${encodeURIComponent(pool.id)}`}><strong>{pool.name}</strong></Link><span>{pool._count.folders} pasta(s)</span></div><span className="number-chip">{pool._count.assets}</span></div>)}
          {pools.length === 0 && <div className="empty-state">Nenhum setor cadastrado.</div>}
        </div>
      </div>

      <div className="card section-card">
        <div className="section-heading"><div><h2>Categorias</h2><p>Principais grupos de ativos cadastrados.</p></div><Link href="/structure" className="text-link">Ver estrutura</Link></div>
        <div className="simple-list">
          {categories.slice(0, 6).map(category => <div className="simple-list-row" key={category.id}><div><Link href={`/assets?categoryId=${encodeURIComponent(category.id)}`}><strong>{category.name}</strong></Link><span>Categoria de ativo</span></div><span className="number-chip">{category._count.assets}</span></div>)}
          {categories.length === 0 && <div className="empty-state">Nenhuma categoria cadastrada.</div>}
        </div>
      </div>
    </section>
  </>;
}
