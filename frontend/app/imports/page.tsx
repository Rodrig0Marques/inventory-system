'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, getToken } from '../../lib/api';
import { canManage, getSessionUser } from '../../lib/session';

type Pool = { id: string; name: string };
type Category = { id: string; name: string };
type Job = { id: string; fileName: string; totalRows: number; successRows: number; errorRows: number; createdAt: string };

export default function ImportsPage() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [poolId, setPoolId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  async function load() {
    const [p, c, j] = await Promise.all([api<Pool[]>('/pools'), api<Category[]>('/categories'), api<Job[]>('/imports')]);
    setPools(p);
    setCategories(c);
    setJobs(j);
    setPoolId(v => v || p[0]?.id || '');
    setCategoryId(v => v || c[0]?.id || '');
  }

  useEffect(() => {
    setCanEdit(canManage(getSessionUser()?.role));
    load().catch(() => setError('Não foi possível carregar as importações.'));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || !poolId || !categoryId) return;
    setMessage('');
    setError('');
    setUploading(true);
    try {
      const body = new FormData();
      body.append('poolId', poolId);
      body.append('categoryId', categoryId);
      body.append('file', file);
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333'}/imports/assets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body,
      });
      const data = await response.json();
      if (!response.ok && response.status !== 207) throw new Error(data.message || 'Falha na importação.');
      setMessage(`Importação concluída: ${data.successRows} sucesso(s), ${data.errorRows} erro(s).`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha na importação.');
    } finally {
      setUploading(false);
    }
  }

  return <>
    <div className="page-head">
      <div><div className="eyebrow">Carga em lote</div><h1>Importações</h1><div className="page-description">Envie CSV, XLS, XLSX ou XML usando o modelo padrão.</div></div>
      <a className="secondary-link" href="/modelo_importacao_ativos.xlsx" download>Baixar modelo XLSX</a>
    </div>
    {(error || message) && <div className={`notice ${error ? 'notice-error' : 'notice-success'}`}>{error || message}</div>}
    {!canEdit && <div className="notice notice-info">Seu perfil é somente leitura. O histórico continua disponível, mas novas importações são restritas a gestores e administradores.</div>}

    {canEdit && <section className="import-layout">
      <div className="card form-card">
        <div className="card-heading"><div className="card-icon">UP</div><div><h2>Importar arquivo</h2><p>Escolha o destino e envie a planilha.</p></div></div>
        <form onSubmit={submit} className="stack-form">
          <div className="form-field"><label>Pool de destino</label><select value={poolId} onChange={e => setPoolId(e.target.value)} required><option value="">Selecione</option>{pools.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className="form-field"><label>Categoria</label><select value={categoryId} onChange={e => setCategoryId(e.target.value)} required><option value="">Selecione</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="form-field"><label>Arquivo</label><input className="file-input" type="file" accept=".csv,.xls,.xlsx,.xml" onChange={e => setFile(e.target.files?.[0] || null)} required /><div className="field-help">Colunas: patrimônio, nome, descrição, fabricante, modelo, preço, localização e responsável.</div></div>
          <button className="primary full-button" disabled={uploading || !pools.length || !categories.length}>{uploading ? 'Importando...' : 'Importar arquivo'}</button>
        </form>
      </div>

      <div className="card import-help">
        <div className="eyebrow">Como funciona</div><h2>Importação simples</h2>
        <div className="step-list">
          <div className="step-item"><span>1</span><div><strong>Baixe o modelo</strong><p>Use as oito colunas padrão.</p></div></div>
          <div className="step-item"><span>2</span><div><strong>Preencha os ativos</strong><p>Patrimônio e nome são os principais campos.</p></div></div>
          <div className="step-item"><span>3</span><div><strong>Selecione pool e categoria</strong><p>Todos os itens do arquivo usam o destino escolhido.</p></div></div>
          <div className="step-item"><span>4</span><div><strong>Envie o arquivo</strong><p>O sistema processa e registra o resultado.</p></div></div>
        </div>
      </div>
    </section>}

    <section className="card section-card">
      <div className="section-heading"><div><h2>Histórico</h2><p>Últimas cargas realizadas no sistema.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>Arquivo</th><th>Total</th><th>Sucesso</th><th>Erros</th><th>Data</th></tr></thead><tbody>
        {jobs.map(j => <tr key={j.id}><td><div className="entity-title">{j.fileName}</div></td><td>{j.totalRows}</td><td><span className="success-count">{j.successRows}</span></td><td><span className={j.errorRows ? 'error-count' : 'soft-badge'}>{j.errorRows}</span></td><td>{new Date(j.createdAt).toLocaleString('pt-BR')}</td></tr>)}
        {jobs.length === 0 && <tr><td colSpan={5}><div className="empty-state">Nenhuma importação realizada.</div></td></tr>}
      </tbody></table></div>
    </section>
  </>;
}
