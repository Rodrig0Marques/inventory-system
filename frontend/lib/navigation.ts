import type { IconName } from '../components/Icon';
import type { UserRole } from './session';

export type NavigationItem = { href: string; label: string; icon: IconName; group: string; roles?: UserRole[] };

export const navigation: NavigationItem[] = [
  { href: '/', label: 'Visão geral', icon: 'grid', group: 'Workspace' },
  { href: '/assets', label: 'Ativos', icon: 'box', group: 'Workspace' },
  { href: '/non-patrimonial', label: 'Não patrimoniados', icon: 'clipboard', group: 'Workspace' },
  { href: '/stock', label: 'Estoque e componentes', icon: 'layers', group: 'Workspace' },
  { href: '/pools', label: 'Setores', icon: 'users', group: 'Organização' },
  { href: '/structure', label: 'Estrutura', icon: 'folder', group: 'Organização' },
  { href: '/imports', label: 'Importações', icon: 'upload', group: 'Organização' },
  { href: '/audit', label: 'Auditoria', icon: 'history', group: 'Administração', roles: ['ADMIN'] },
  { href: '/users', label: 'Usuários', icon: 'shield', group: 'Administração', roles: ['ADMIN'] },
];

export function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}
