export type CategoryNode = { id: string; name: string; parentId?: string | null };
export function categoryPath(categories: CategoryNode[], id: string): string {
  const parts: string[] = [], seen = new Set<string>();
  let node = categories.find(c => c.id === id);
  while (node && !seen.has(node.id)) { seen.add(node.id); parts.unshift(node.name); node = categories.find(c => c.id === node!.parentId); }
  return parts.join(' / ');
}
export function descendantIds(categories: CategoryNode[], id: string): Set<string> {
  const result = new Set([id]), pending = [id];
  while (pending.length) { const parent = pending.pop(); for (const c of categories) if (c.parentId === parent && !result.has(c.id)) { result.add(c.id); pending.push(c.id); } }
  return result;
}
// getRandomValues is available on HTTP intranets where randomUUID may not be exposed.
export function requestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
