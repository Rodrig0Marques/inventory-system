// One policy for all data queries; missing membership always means an empty scope.
export function visiblePoolFilter(role: string | undefined, poolIds: readonly string[] | null | undefined, requested?: string): { poolId?: string | { in: string[] } } {
  if (role === 'ADMIN') return requested ? { poolId: requested } : {};
  const ids = poolIds ?? [];
  if (requested && !ids.includes(requested)) throw Object.assign(new Error('Setor ou recurso não encontrado ou sem acesso.'), { statusCode: 404 });
  return requested ? { poolId: requested } : { poolId: { in: [...ids] } };
}
