// This suite only runs on an explicitly named disposable database/schema.
// It never clears or recreates production data. See compose.test.yml.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import { UserRole } from '@prisma/client';
import { defaultPermissionsForRole } from '../src/utils/permissions.js';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/plugins/prisma.js';

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (process.env.RUN_INTEGRATION_TESTS !== '1' || !url.pathname.endsWith('_test') || url.searchParams.get('schema') !== 'test_v7') {
  throw new Error('Refusing to run: use RUN_INTEGRATION_TESTS=1, a database ending in _test and schema=test_v7.');
}
const tag = randomUUID().slice(0,8), password = 'IntegrationOnly!239';
let app: Awaited<ReturnType<typeof buildApp>>;
let ti: any, rh: any, root: any, c8: any, c2666: any, c3200: any, computer: any;
let admin: any, manager: any, rhManager: any, viewer: any, isolated: any;
let pc1: any, pc2: any, rhAsset: any, profile: any, other: any;
let externalComponent = '', stockComponent = '';
const auth = (user: any) => ({ authorization: `Bearer ${user.token}` });
const req = (method: 'GET'|'POST'|'PUT'|'DELETE', path: string, user: any, payload?: object) => {
  const needsId = method === 'POST' && /^\/non-patrimonial(?:\/[^/]+\/(?:stock|transfer))?$/.test(path);
  return app.inject({ method, url: path, headers: auth(user), ...(payload ? { payload: needsId ? { requestId: randomUUID(), ...payload } : payload } : {}) });
};
const body = (response: Awaited<ReturnType<typeof req>>) => response.json() as any;
async function expect(method: 'GET'|'POST'|'PUT'|'DELETE', path: string, user: any, payload: object | undefined, code: number) {
  const response = await req(method,path,user,payload); assert.equal(response.statusCode,code,response.body); return body(response);
}
async function makeUser(name: string, role: UserRole, pools: string[]) {
  const permissions = role === UserRole.ADMIN ? [] : defaultPermissionsForRole(role);
  const user = await prisma.user.create({
    data: {
      name,
      email: `${name}-${tag}@test.local`,
      password: await bcrypt.hash(password, 10),
      role,
      permissionsInitialized: true,
      permissions: { create: permissions.map(permission => ({ permission })) },
      poolAccess: { create: pools.map(poolId => ({ poolId })) },
    },
  });
  return { ...user, token: app.jwt.sign({ sub: user.id, name: user.name, email: user.email, role: user.role, tokenVersion: user.tokenVersion }) };
}
async function makeProfile(name: string, available: number) {
  return expect('POST','/stock/profiles',manager,{ requestId: randomUUID(), poolId: ti.id, categoryId: c2666.id, name: `${name}-${tag}`, initialAvailable: available },201);
}
async function catalogProfile(id: string) {
  const data = await expect('GET','/stock/catalog',manager,undefined,200); return data.profiles.find((p:any) => p.id === id);
}
function multipart(csv: string) {
  const boundary = `test-${tag}`;
  return { headers: { ...auth(rhManager), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n` };
}
before(async () => {
  app = await buildApp(false); await app.ready();
  ti = await prisma.pool.create({ data: { name: `TI-${tag}` } }); rh = await prisma.pool.create({ data: { name: `RH-${tag}` } });
  root = await prisma.category.create({ data: { name: `Memorias-${tag}` } });
  c8 = await prisma.category.create({ data: { name: `Memoria 8gb-${tag}`, parentId: root.id } });
  c2666 = await prisma.category.create({ data: { name: `8gb 2666Ghz-${tag}`, parentId: c8.id } });
  c3200 = await prisma.category.create({ data: { name: `8gb 3200Ghz-${tag}`, parentId: c8.id } });
  computer = await prisma.category.create({ data: { name: `Computadores-${tag}` } });
  admin = await makeUser('admin',UserRole.ADMIN,[]); manager = await makeUser('ti-manager',UserRole.MANAGER,[ti.id]);
  rhManager = await makeUser('rh-manager',UserRole.MANAGER,[rh.id]); viewer = await makeUser('rh-viewer',UserRole.VIEWER,[rh.id]); isolated = await makeUser('isolated',UserRole.VIEWER,[]);
  pc1 = await prisma.asset.create({ data: { name: 'PC 1', patrimonyNumber: `PC1-${tag}`, poolId: ti.id, categoryId: computer.id } });
  pc2 = await prisma.asset.create({ data: { name: 'PC 2', patrimonyNumber: `PC2-${tag}`, poolId: ti.id, categoryId: computer.id } });
  rhAsset = await prisma.asset.create({ data: { name: 'RH PC', patrimonyNumber: `RH-${tag}`, poolId: rh.id, categoryId: computer.id } });
});
after(async () => { if (app) await app.close(); await prisma.$disconnect(); });

test('login and current-user read work on the actual API', async () => {
  const r = await app.inject({ method:'POST',url:'/auth/login',payload:{ email:viewer.email,password } }); assert.equal(r.statusCode,200,r.body);
  assert.ok(r.json().token); const me = await expect('GET','/auth/me',viewer,undefined,200); assert.deepEqual(me.poolIds,[rh.id]);
});
test('RH viewer sees only RH assets and counts', async () => {
  const list = await expect('GET','/assets',viewer,undefined,200); assert.equal(list.total,1); assert.equal(list.items[0].id,rhAsset.id);
  const summary = await expect('GET','/assets/summary',viewer,undefined,200); assert.equal(summary.total,1);
  const pools = await expect('GET','/pools',viewer,undefined,200); assert.deepEqual(pools.map((p:any) => p.id),[rh.id]);
});
test('direct asset IDs and query-string pool IDs cannot bypass visibility', async () => {
  await expect('GET',`/assets/${pc1.id}`,viewer,undefined,404); await expect('GET',`/assets?poolId=${ti.id}`,viewer,undefined,404);
  await expect('GET',`/stock/assets/${pc1.id}/components`,viewer,undefined,404); await expect('GET',`/folders?poolId=${ti.id}`,viewer,undefined,404);
});
test('no membership gives empty lists and zero aggregates', async () => {
  assert.equal((await expect('GET','/assets',isolated,undefined,200)).total,0);
  assert.equal((await expect('GET','/assets/summary',isolated,undefined,200)).total,0);
  assert.deepEqual(await expect('GET','/pools',isolated,undefined,200),[]);
  assert.deepEqual((await expect('GET','/stock/catalog',isolated,undefined,200)).totals,{ available:0,installed:0,total:0 });
});
test('only ADMIN manages global users, pools and categories', async () => {
  await expect('GET','/users',manager,undefined,403); await expect('POST','/pools',manager,{ name:`Forbidden-${tag}` },403);
  await expect('POST','/categories',manager,{ name:`Forbidden-${tag}` },403);
});
test('viewer cannot write, even in an allowed pool', async () => {
  await expect('POST','/assets',viewer,{ poolId:rh.id,categoryId:computer.id,name:'Denied',patrimonyNumber:'DENIED' },403);
});
test('manager cannot create or move assets or folders across unauthorized pools', async () => {
  await expect('POST','/assets',manager,{ poolId:rh.id,categoryId:computer.id,name:'Denied',patrimonyNumber:'DENIED' },404);
  await expect('POST','/folders',manager,{ poolId:rh.id,name:'Denied' },404);
  await expect('POST',`/assets/${pc1.id}/move`,manager,{ poolId:rh.id },404);
});
test('TXT baseline: 200 total 8gb components, 10 available', async () => {
  profile = await makeProfile('RAM 2666',2);
  other = await expect('POST','/stock/profiles',manager,{ requestId:randomUUID(),poolId:ti.id,categoryId:c3200.id,name:`RAM 3200-${tag}`,initialAvailable:8 },201);
  await expect('POST','/stock/assign',manager,{ requestId:randomUUID(),poolId:ti.id,assetIds:[pc1.id],components:[{ profileId:profile.id,quantity:98,origin:'REGISTER_INSTALLED' },{ profileId:other.id,quantity:92,origin:'REGISTER_INSTALLED' }] },200);
  const data = await expect('GET','/stock/catalog',manager,undefined,200);
  const category = data.categories.find((c:any) => c.id === c8.id); assert.equal(category.total,200); assert.equal(category.available,10);
});
test('registering an already installed component changes 200/10 to 201/10', async () => {
  const r = await expect('POST','/stock/assign',manager,{ requestId:randomUUID(),poolId:ti.id,assetIds:[pc2.id],components:[{ profileId:profile.id,quantity:1,origin:'REGISTER_INSTALLED' }] },200);
  externalComponent = r.componentIds[0]; const p = await catalogProfile(profile.id); assert.equal(p.total,101); assert.equal(p.available,2);
  const c = (await expect('GET','/stock/catalog',manager,undefined,200)).categories.find((x:any) => x.id === c8.id); assert.equal(c.total,201); assert.equal(c.available,10);
});
test('installing a stock unit preserves total and decrements availability', async () => {
  const r = await expect('POST','/stock/assign',manager,{ requestId:randomUUID(),poolId:ti.id,assetIds:[pc2.id],components:[{ profileId:profile.id,quantity:1,origin:'FROM_STOCK' }] },200);
  stockComponent = r.componentIds[0]; const p = await catalogProfile(profile.id); assert.equal(p.total,101); assert.equal(p.available,1);
});
test('same requestId is idempotent; reused with a different body is rejected', async () => {
  const p = await makeProfile('Idempotent',0), id = randomUUID();
  const payload = { requestId:id,poolId:ti.id,assetIds:[pc2.id],components:[{ profileId:p.id,quantity:1,origin:'REGISTER_INSTALLED' }] };
  const first = await expect('POST','/stock/assign',manager,payload,200); const second = await expect('POST','/stock/assign',manager,payload,200);
  assert.deepEqual(first,second); assert.equal((await catalogProfile(p.id)).total,1);
  await expect('POST','/stock/assign',manager,{ ...payload,components:[{ ...payload.components[0],quantity:2 }] },409);
});
test('insufficient available stock never creates a partial association', async () => {
  const before = await prisma.assetComponent.count({ where:{ assetId:pc2.id } });
  await expect('POST','/stock/assign',manager,{ requestId:randomUUID(),poolId:ti.id,assetIds:[pc2.id],components:[{ profileId:profile.id,quantity:5,origin:'FROM_STOCK' }] },409);
  assert.equal(await prisma.assetComponent.count({ where:{ assetId:pc2.id } }),before); assert.equal((await catalogProfile(profile.id)).available,1);
});
test('RH cannot see TI stock, movement history or use its profiles', async () => {
  assert.equal((await expect('GET','/stock/catalog',viewer,undefined,200)).profiles.length,0);
  assert.equal((await expect('GET','/stock/movements',viewer,undefined,200)).total,0);
  await expect('POST','/stock/assign',rhManager,{ requestId:randomUUID(),poolId:rh.id,assetIds:[rhAsset.id],components:[{ profileId:profile.id,quantity:1,origin:'REGISTER_INSTALLED' }] },400);
});
test('returning installed units does not invent a new total', async () => {
  await expect('POST',`/stock/components/${externalComponent}/remove`,manager,{ requestId:randomUUID(),quantity:1,disposition:'RETURN_TO_STOCK',notes:'Return test' },200);
  const p = await catalogProfile(profile.id); assert.equal(p.available,2); assert.equal(p.total,101);
});
test('retiring installed units decreases total, and removal cannot be repeated', async () => {
  await expect('POST',`/stock/components/${stockComponent}/remove`,manager,{ requestId:randomUUID(),quantity:1,disposition:'RETIRE_INSTALLED',notes:'Retire test' },200);
  const p = await catalogProfile(profile.id); assert.equal(p.total,100); assert.equal(p.available,2);
  await expect('POST',`/stock/components/${stockComponent}/remove`,manager,{ requestId:randomUUID(),quantity:1,disposition:'RETURN_TO_STOCK',notes:'Repeated test' },409);
});
test('an asset with installed components cannot be silently deleted or transferred', async () => {
  await expect('DELETE',`/assets/${pc1.id}`,manager,undefined,409); await expect('POST',`/assets/${pc1.id}/move`,admin,{ poolId:rh.id },409);
});
test('concurrent allocation of the last available unit permits exactly one writer', async () => {
  const p = await makeProfile('Concurrent',1);
  const results = await Promise.all([pc1,pc2].map(a => req('POST','/stock/assign',manager,{ requestId:randomUUID(),poolId:ti.id,assetIds:[a.id],components:[{ profileId:p.id,quantity:1,origin:'FROM_STOCK' }] })));
  assert.deepEqual(results.map(r => r.statusCode).sort(),[200,409]); const final = await catalogProfile(p.id); assert.equal(final.available,0); assert.equal(final.installed,1); assert.equal(final.total,1);
});
test('batch creates/reuses folders, registers units per equipment and retries safely', async () => {
  const p = await makeProfile('Batch',6);
  const payload = { requestId:randomUUID(),poolId:ti.id,categoryId:computer.id,folderPrefix:`Batch-${tag}`,assets:[1,2,3].map(i => ({ patrimonyNumber:`B${i}-${tag}`,name:`Batch PC ${i}`,folderPath:i === 3 ? 'Room B / Desk 1' : 'Room A' })),components:[{ profileId:p.id,quantity:2,origin:'FROM_STOCK' }] };
  const first = await expect('POST','/assets/batch',manager,payload,201); const again = await expect('POST','/assets/batch',manager,payload,201); assert.deepEqual(first,again);
  const final = await catalogProfile(p.id); assert.equal(final.available,0); assert.equal(final.total,6); assert.equal(first.assets.length,3);
  assert.equal(await prisma.folder.count({ where:{ poolId:ti.id,name:'Room A' } }),1);
});
test('one invalid item rolls back assets, new subfolders and stock for the whole batch', async () => {
  const p = await makeProfile('Rollback',0), code=`RB-${tag}`, folder=`Rollback-${tag}`;
  await expect('POST','/assets/batch',manager,{ requestId:randomUUID(),poolId:ti.id,categoryId:computer.id,folderPrefix:folder,assets:[{ patrimonyNumber:code,name:'Never created',folderPath:'Nested / Folder' }],components:[{ profileId:p.id,quantity:1,origin:'FROM_STOCK' }] },409);
  assert.equal(await prisma.asset.count({ where:{ poolId:ti.id,patrimonyNumber:code } }),0); assert.equal(await prisma.folder.count({ where:{ poolId:ti.id,name:folder } }),0);
});
test('a duplicate existing patrimony rolls back earlier rows in the batch', async () => {
  const code=`DUP-${tag}`;
  await expect('POST','/assets/batch',manager,{ requestId:randomUUID(),poolId:ti.id,categoryId:computer.id,assets:[{ patrimonyNumber:code,name:'New row' },{ patrimonyNumber:pc1.patrimonyNumber,name:'Existing row' }] },409);
  assert.equal(await prisma.asset.count({ where:{ poolId:ti.id,patrimonyNumber:code } }),0);
});
test('import preview rejects another pool without revealing records from that pool', async () => {
  const csv = `patrimonio;nome;pool;categoria\nFOREIGN;Example;${ti.name};${computer.name}`;
  const r = await app.inject({ method:'POST',url:'/imports/assets/preview',...multipart(csv) }); assert.equal(r.statusCode,200,r.body); assert.equal(r.json().validRows,0);
});
test('template contains only authorized pool names', async () => {
  const r = await req('GET','/imports/template',viewer); assert.equal(r.statusCode,200);
  const book = XLSX.read(r.rawPayload,{ type:'buffer' });
  assert.ok(book.Sheets.SETORES, 'The import template must include its sectors worksheet');
  const pools = JSON.stringify(XLSX.utils.sheet_to_json(book.Sheets.SETORES,{ header:1 }));
  assert.ok(pools.includes(rh.name)); assert.ok(!pools.includes(ti.name));
});
test('non-admin users do not see import history of other users or legacy unscoped jobs', async () => {
  await prisma.importJob.create({ data:{ fileName:'legacy.csv',fileType:'csv' } });
  await prisma.importJob.create({ data:{ fileName:'private.csv',fileType:'csv',userId:manager.id,poolIds:[ti.id] } });
  assert.deepEqual(await expect('GET','/imports',viewer,undefined,200),[]);
});
test('revoking membership takes effect on the next request with the existing JWT', async () => {
  await expect('PUT',`/users/${viewer.id}`,admin,{ poolIds:[] },200);
  assert.equal((await expect('GET','/assets',viewer,undefined,200)).total,0);
  await expect('GET',`/assets/${rhAsset.id}`,viewer,undefined,404);
});
test('password reset revokes previously signed tokens', async () => {
  await expect('PUT',`/users/${isolated.id}/password`,admin,{ password:'AnotherTestPassword!984' },200);
  await expect('GET','/auth/me',isolated,undefined,401);
});

// Workflow regressions: all records below live in the disposable integration DB.
async function upload(user: any, path: string, csv: string, previewId?: string) {
  const boundary = `workflow-${tag}`;
  return app.inject({ method: 'POST', url: path, headers: { ...auth(user), 'content-type': `multipart/form-data; boundary=${boundary}`, ...(previewId ? { 'x-request-id': previewId } : {}) }, payload: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="workflow.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n` });
}
async function analyzed(user: any, path: string, mode: string, csv: string) {
  const result = await upload(user, `${path}/preview?mode=${mode}`, csv); assert.equal(result.statusCode, 200, result.body); return result.json() as any;
}

test('global lookup pages repeated patrimonies without false notFound results', async () => {
  const code = `COMMON-${tag}`, last = `ZZ-LAST-${tag}`;
  const pools = await Promise.all(Array.from({ length: 51 }, (_, i) => prisma.pool.create({ data: { name: `LOOKUP-${tag}-${i}` } })));
  await prisma.asset.createMany({ data: pools.map(pool => ({ poolId: pool.id, categoryId: computer.id, name: 'Repeated code', patrimonyNumber: code })) });
  await prisma.asset.create({ data: { poolId: pools[0].id, categoryId: computer.id, name: 'Last code', patrimonyNumber: last } });
  const result = await expect('GET', `/assets/global-lookup?patrimony=${code},${last}`, admin, undefined, 200);
  assert.equal(result.total, 52); assert.equal(result.items.length, 50); assert.deepEqual(result.notFound, []); assert.deepEqual(result.ambiguous, [code]); assert.equal(result.hasMore, true);
  const next = await expect('GET', `/assets/global-lookup?patrimony=${code},${last}&page=2`, admin, undefined, 200); assert.equal(next.items.length, 2);
  const filtered = await expect('GET', `/assets/global-lookup?patrimony=${code}&poolId=${pools[0].id}`, admin, undefined, 200); assert.equal(filtered.total, 1); assert.deepEqual(filtered.ambiguous, []);
  await expect('GET', `/assets/global-lookup?patrimony=${code}`, manager, undefined, 403);
});

test('profile archive can be listed and reactivated without recycling its identity', async () => {
  const p = await makeProfile('archive-flow', 0);
  await expect('DELETE', `/stock/profiles/${p.id}`, manager, undefined, 200);
  assert.equal(await catalogProfile(p.id), undefined);
  const archived = await expect('GET', '/stock/catalog?active=false', manager, undefined, 200); assert.ok(archived.profiles.some((item: any) => item.id === p.id));
  await expect('POST', '/stock/profiles', manager, { requestId: randomUUID(), poolId: ti.id, categoryId: c2666.id, name: p.name }, 409);
  await expect('POST', `/stock/profiles/${p.id}/reactivate`, manager, undefined, 200); assert.equal((await catalogProfile(p.id)).active, true);
});

test('whole equipment transfer preserves installed/global totals and retries once', async () => {
  const operator = await makeUser('transfer-operator', UserRole.MANAGER, [ti.id, rh.id]);
  const p = await makeProfile('transfer-component', 4);
  const asset = await expect('POST', '/assets', operator, { poolId: ti.id, categoryId: computer.id, name: 'Complete equipment', patrimonyNumber: `MOVE-${tag}` }, 201);
  await expect('POST', '/stock/assign', operator, { requestId: randomUUID(), poolId: ti.id, assetIds: [asset.id], components: [{ profileId: p.id, quantity: 2, origin: 'FROM_STOCK' }] }, 200);
  const before = (await expect('GET', '/stock/catalog', admin, undefined, 200)).totals;
  const payload = { poolId: rh.id, requestId: randomUUID(), transferComponents: true };
  await expect('POST', `/assets/${asset.id}/move`, manager, payload, 404);
  const moved = await expect('POST', `/assets/${asset.id}/move`, operator, payload, 200); assert.equal(moved.poolId, rh.id);
  await expect('POST', `/assets/${asset.id}/move`, operator, payload, 200);
  const after = (await expect('GET', '/stock/catalog', admin, undefined, 200)).totals; assert.deepEqual(after, before);
  const components = await expect('GET', `/stock/assets/${asset.id}/components`, operator, undefined, 200); assert.equal(components.length, 1); assert.equal(components[0].quantity, 2); assert.equal(components[0].profile.poolId, rh.id);
  assert.equal(await prisma.stockMovement.count({ where: { assetId: asset.id, type: 'TRANSFER_OUT' } }), 1);
  assert.equal(await prisma.stockMovement.count({ where: { assetId: asset.id, type: 'TRANSFER_IN' } }), 1);
  assert.equal((await prisma.itemProfile.findUniqueOrThrow({ where: { id: p.id } })).availableQty, 2);
});

test('incompatible destination component profiles roll back the whole equipment transfer', async () => {
  const operator = await makeUser('transfer-conflict', UserRole.MANAGER, [ti.id, rh.id]);
  const p = await makeProfile('conflicting-spec', 2);
  await expect('POST', '/stock/profiles', operator, { requestId: randomUUID(), poolId: rh.id, categoryId: c3200.id, name: p.name, specifications: 'Different specification' }, 201);
  const asset = await expect('POST', '/assets', operator, { poolId: ti.id, categoryId: computer.id, name: 'Blocked transfer', patrimonyNumber: `BLOCK-${tag}` }, 201);
  await expect('POST', '/stock/assign', operator, { requestId: randomUUID(), poolId: ti.id, assetIds: [asset.id], components: [{ profileId: p.id, quantity: 1, origin: 'FROM_STOCK' }] }, 200);
  await expect('POST', `/assets/${asset.id}/move`, operator, { requestId: randomUUID(), poolId: rh.id, transferComponents: true }, 409);
  assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).poolId, ti.id);
  assert.equal(await prisma.assetComponent.count({ where: { assetId: asset.id, removedAt: null, profileId: p.id } }), 1);
  assert.equal(await prisma.stockMovement.count({ where: { assetId: asset.id, type: 'TRANSFER_OUT' } }), 0);
});

test('asset archive preserves history, is reversible and is excluded from summary/list', async () => {
  const a = await expect('POST', '/assets', manager, { poolId: ti.id, categoryId: computer.id, name: 'Preserved asset', patrimonyNumber: `ARCHIVE-${tag}` }, 201);
  await expect('PUT', `/assets/${a.id}`, manager, { location: 'Archive room' }, 200);
  const totalBefore = (await expect('GET', '/assets/summary', manager, undefined, 200)).total;
  await expect('DELETE', `/assets/${a.id}`, manager, undefined, 200);
  const stored = await prisma.asset.findUniqueOrThrow({ where: { id: a.id } }); assert.ok(stored.archivedAt);
  assert.equal((await expect('GET', '/assets/summary', manager, undefined, 200)).total, totalBefore - 1);
  assert.equal((await expect('GET', `/assets?search=${a.patrimonyNumber}`, manager, undefined, 200)).total, 0);
  assert.equal((await expect('GET', `/assets?search=${a.patrimonyNumber}&archived=true`, manager, undefined, 200)).total, 1);
  const detail = await expect('GET', `/assets/${a.id}`, manager, undefined, 200); assert.equal(detail.movements.length, 1);
  await expect('PUT', `/assets/${a.id}`, manager, { name: 'Must not edit archived' }, 409);
  await expect('POST', `/assets/${a.id}/reactivate`, manager, undefined, 200);
  assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: a.id } })).archivedAt, null);
});

test('asset/category filters consistently include descendants and allow exact filtering', async () => {
  const a = await expect('POST', '/assets', manager, { poolId: ti.id, categoryId: c2666.id, name: 'Nested category asset', patrimonyNumber: `NESTED-${tag}` }, 201);
  assert.ok((await expect('GET', `/assets?categoryId=${root.id}&pageSize=100`, manager, undefined, 200)).items.some((item: any) => item.id === a.id));
  assert.equal((await expect('GET', `/assets?categoryId=${root.id}&includeDescendants=false`, manager, undefined, 200)).items.length, 0);
  const category = (await expect('GET', '/categories', manager, undefined, 200)).find((item: any) => item.id === root.id); assert.ok(category.assetTotal > 0); assert.equal(category._count.assets, 0);
});

test('custom field requirements, types, options and unknown keys are enforced on create and edits', async () => {
  const c = await prisma.category.create({ data: { name: `Custom-${tag}` } });
  await expect('POST', `/categories/${c.id}/fields`, admin, { key: 'capacity', name: 'Capacity', type: 'NUMBER', required: true }, 201);
  await expect('POST', `/categories/${c.id}/fields`, admin, { key: 'grade', name: 'Grade', type: 'SELECT', options: [] }, 400);
  await expect('POST', `/categories/${c.id}/fields`, admin, { key: 'grade', name: 'Grade', type: 'SELECT', options: ['A', 'B'] }, 201);
  const base = { poolId: ti.id, categoryId: c.id, name: 'Custom equipment', patrimonyNumber: `CUSTOM-${tag}` };
  await expect('POST', '/assets', manager, base, 400);
  await expect('POST', '/assets', manager, { ...base, customValues: { capacity: '8' } }, 400);
  await expect('POST', '/assets', manager, { ...base, customValues: { capacity: 8, grade: 'C' } }, 400);
  const a = await expect('POST', '/assets', manager, { ...base, customValues: { capacity: 8, grade: 'A' } }, 201);
  await expect('PUT', `/assets/${a.id}`, manager, { name: 'Keeps retained fields' }, 200);
  await expect('PUT', `/assets/${a.id}`, manager, { customValues: { capacity: null } }, 400);
  await expect('PUT', `/assets/${a.id}`, manager, { customValues: { unknown: 3 } }, 400);
  const csv = `patrimonio,nome,setor,categoria\n${base.patrimonyNumber},Updated through import,${ti.name},${c.name}\n`;
  const retainedPreview = await analyzed(manager, '/imports/assets', 'UPDATE', csv);
  assert.equal(retainedPreview.validRows, 1);
  assert.equal((await upload(manager, '/imports/assets', csv, retainedPreview.previewId)).statusCode, 201);
  const requiredPreview = await analyzed(manager, '/imports/assets', 'CREATE', csv.replace(base.patrimonyNumber, `CUSTOM-NEW-${tag}`));
  assert.equal(requiredPreview.validRows, 0);
  assert.ok(requiredPreview.rows[0].errors.some((error: string) => error.includes('Capacity')));
});

test('persisted import preview prevents duplicate creations and file substitution', async () => {
  const csv = `patrimonio,nome,setor,categoria\nIMP-${tag},Imported equipment,${ti.name},${computer.name}\n`;
  const preview = await analyzed(manager, '/imports/assets', 'CREATE', csv); assert.equal(preview.validRows, 1);
  const invalid = await upload(manager, '/imports/assets', csv + '\nchanged', preview.previewId); assert.equal(invalid.statusCode, 409);
  const first = await upload(manager, '/imports/assets', csv, preview.previewId); assert.equal(first.statusCode, 201, first.body);
  const retry = await upload(manager, '/imports/assets', csv, preview.previewId); assert.equal(retry.statusCode, 201, retry.body); assert.equal(first.json().id, retry.json().id);
  assert.equal(await prisma.asset.count({ where: { poolId: ti.id, patrimonyNumber: `IMP-${tag}` } }), 1);
  assert.equal((await upload(manager, '/imports/assets/preview?mode=CREATE', csv)).statusCode, 409);
  assert.equal((await upload(rhManager, '/imports/assets', csv, preview.previewId)).statusCode, 404);
});

test('non-patrimonial import separates metadata updates and final balance with optimistic checks', async () => {
  const item = await expect('POST', '/non-patrimonial', manager, { poolId: ti.id, categoryId: c2666.id, name: 'Consumable', quantity: 20 }, 201);
  const csv = `codigo_interno,nome,setor,categoria,quantidade\n${item.internalCode},Updated consumable,${ti.name},${c2666.name},5\n`;
  const update = await analyzed(manager, '/imports/non-patrimonial', 'UPDATE', csv); assert.equal(update.rows[0].quantityBefore, 20); assert.equal(update.rows[0].quantityAfter, 20);
  const updated = await upload(manager, '/imports/non-patrimonial', csv, update.previewId); assert.equal(updated.statusCode, 201, updated.body);
  assert.equal((await prisma.nonPatrimonialItem.findUniqueOrThrow({ where: { id: item.id } })).quantity, 20);
  const stale = await analyzed(manager, '/imports/non-patrimonial', 'SET_BALANCE', csv);
  await expect('POST', `/non-patrimonial/${item.id}/stock`, manager, { type: 'ENTRY', quantity: 2, notes: 'Concurrent receipt' }, 200);
  const rejected = await upload(manager, '/imports/non-patrimonial', csv, stale.previewId); assert.equal(rejected.statusCode, 207); assert.equal(rejected.json().successRows, 0);
  const balance = await analyzed(manager, '/imports/non-patrimonial', 'SET_BALANCE', csv); assert.equal(balance.rows[0].quantityBefore, 22); assert.equal(balance.rows[0].quantityAfter, 5);
  const result = await upload(manager, '/imports/non-patrimonial', csv, balance.previewId); assert.equal(result.statusCode, 201, result.body);
  assert.equal((await prisma.nonPatrimonialItem.findUniqueOrThrow({ where: { id: item.id } })).quantity, 5);
});

test('concurrent confirmations from two previews of the same new-material file do not duplicate stock', async () => {
  const csv = `nome,setor,categoria,quantidade\nNew material ${tag},${ti.name},${c2666.name},4\n`;
  const a = await analyzed(manager, '/imports/non-patrimonial', 'CREATE', csv), b = await analyzed(manager, '/imports/non-patrimonial', 'CREATE', csv);
  const responses = await Promise.all([upload(manager, '/imports/non-patrimonial', csv, a.previewId), upload(manager, '/imports/non-patrimonial', csv, b.previewId)]);
  for (const response of responses) assert.equal(response.statusCode, 201, response.body);
  assert.equal(responses[0].json().id, responses[1].json().id);
  assert.equal(await prisma.nonPatrimonialItem.count({ where: { name: `New material ${tag}`, poolId: ti.id } }), 1);
});

test('non-patrimonial history pages all records rather than silently cutting at 200', async () => {
  const item = await expect('POST', '/non-patrimonial', manager, { poolId: ti.id, categoryId: c2666.id, name: 'Long history', quantity: 0 }, 201);
  await prisma.nonPatrimonialMovement.createMany({ data: Array.from({ length: 205 }, (_, i) => ({ itemId: item.id, userId: manager.id, type: 'ADJUSTMENT' as const, quantity: 1, quantityBefore: i, quantityAfter: i + 1 })) });
  const result = await expect('GET', `/non-patrimonial/${item.id}/movements?page=5&pageSize=50`, manager, undefined, 200); assert.equal(result.total, 205); assert.equal(result.items.length, 5);
  await expect('GET', `/non-patrimonial/${item.id}/movements`, rhManager, undefined, 404);
});

test('audit search is administrative and preserves archived asset events', async () => {
  const readonly = await makeUser('audit-viewer', UserRole.VIEWER, [ti.id]);
  await expect('GET', '/audit', readonly, undefined, 403);
  await expect('GET', '/audit', manager, undefined, 403);
  const result = await expect('GET', '/audit?entity=Asset&action=ARCHIVE', admin, undefined, 200); assert.ok(result.total > 0); assert.ok(result.items.every((item: any) => item.action === 'ARCHIVE'));
});

test('initialized accounts cannot regain revoked permissions through old global flags', async () => {
  const user = await makeUser('legacy-flags', UserRole.VIEWER, [ti.id]);
  await prisma.user.update({ where: { id: user.id }, data: { canGlobalAssetLookup: true, permissionsInitialized: true } });
  await expect('GET', `/assets/global-lookup?patrimony=PC1-${tag}`, user, undefined, 403);
  await prisma.user.update({ where: { id: user.id }, data: { permissionsInitialized: false } });
  await expect('GET', `/assets/global-lookup?patrimony=PC1-${tag}`, user, undefined, 200);
});

test('additive SQL upgrade is repeatable and preserves legacy grants without restoring revoked grants', async () => {
  const legacy = await makeUser('upgrade-legacy', UserRole.MANAGER, [ti.id]);
  const initialized = await makeUser('upgrade-initialized', UserRole.VIEWER, [ti.id]);
  await prisma.userPermission.deleteMany({ where: { userId: legacy.id } });
  await prisma.user.update({ where: { id: legacy.id }, data: { permissionsInitialized: false, canGlobalAssetLookup: true } });
  await prisma.user.update({ where: { id: initialized.id }, data: { canGlobalAssetLookup: true } });
  const sql = await readFile(new URL('../prisma/updates/20261111_workflows.sql', import.meta.url), 'utf8');
  for (let run = 0; run < 2; run++) {
    for (const statement of sql.split(';').filter(part => part.trim())) await prisma.$executeRawUnsafe(statement);
  }
  const migrated = await prisma.user.findUniqueOrThrow({ where: { id: legacy.id }, include: { permissions: true } });
  assert.equal(migrated.permissionsInitialized, true);
  assert.ok(migrated.permissions.some(grant => grant.permission === 'GLOBAL_ASSET_LOOKUP'));
  assert.ok(migrated.permissions.some(grant => grant.permission === 'ASSET_CREATE'));
  assert.equal(await prisma.userPermission.count({ where: { userId: initialized.id, permission: 'GLOBAL_ASSET_LOOKUP' } }), 0);
  await expect('GET', `/assets/global-lookup?patrimony=PC1-${tag}`, legacy, undefined, 200);
  await expect('GET', `/assets/global-lookup?patrimony=PC1-${tag}`, initialized, undefined, 403);
});

test('non-patrimonial creation requires a request ID and replays without duplicate opening stock', async () => {
  const data = { poolId: ti.id, categoryId: c2666.id, name: `Once-${tag}`, quantity: 9 };
  const missing = await app.inject({ method: 'POST', url: '/non-patrimonial', headers: auth(manager), payload: data });
  assert.equal(missing.statusCode, 400);
  const payload = { ...data, requestId: randomUUID() };
  const first = await expect('POST', '/non-patrimonial', manager, payload, 201);
  const retry = await expect('POST', '/non-patrimonial', manager, payload, 201);
  assert.equal(first.id, retry.id);
  assert.equal(await prisma.nonPatrimonialItem.count({ where: { name: data.name } }), 1);
  assert.equal(await prisma.nonPatrimonialMovement.count({ where: { itemId: first.id } }), 1);
  await expect('POST', '/non-patrimonial', manager, { ...payload, quantity: 10 }, 409);
});

test('non-patrimonial entries, exits and adjustments replay once even with simultaneous requests', async () => {
  const item = await expect('POST', '/non-patrimonial', manager, { poolId: ti.id, categoryId: c2666.id, name: 'Retry movements', quantity: 5 }, 201);
  const path = `/non-patrimonial/${item.id}/stock`;
  const missing = await app.inject({ method: 'POST', url: path, headers: auth(manager), payload: { type: 'ENTRY', quantity: 1, notes: 'Missing ID' } });
  assert.equal(missing.statusCode, 400);
  for (const [type, quantity, expected] of [['ENTRY', 4, 9], ['EXIT', 2, 7], ['ADJUSTMENT', 3, 3]] as const) {
    const payload = { requestId: randomUUID(), type, quantity, notes: 'Retry-safe movement' };
    const responses = await Promise.all([req('POST', path, manager, payload), req('POST', path, manager, payload)]);
    for (const response of responses) assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(responses[0].json(), responses[1].json());
    assert.equal((await prisma.nonPatrimonialItem.findUniqueOrThrow({ where: { id: item.id } })).quantity, expected);
    await expect('POST', path, manager, { ...payload, quantity: quantity + 1 }, 409);
  }
  assert.equal(await prisma.nonPatrimonialMovement.count({ where: { itemId: item.id } }), 4);
});

test('non-patrimonial transfers replay once, use destination data and preserve existing destination metadata', async () => {
  const operator = await makeUser('np-transfer-safe', UserRole.MANAGER, [ti.id, rh.id]);
  const item = await expect('POST', '/non-patrimonial', operator, { poolId: ti.id, categoryId: c2666.id, name: 'Transfer utensils', quantity: 10, location: 'Source room', responsible: 'Source person' }, 201);
  const payload = { requestId: randomUUID(), toPoolId: rh.id, quantity: 4, notes: 'Deliver to RH', toLocation: 'RH cabinet', toResponsible: 'Destination person' };
  const path = `/non-patrimonial/${item.id}/transfer`;
  const responses = await Promise.all([req('POST', path, operator, payload), req('POST', path, operator, payload)]);
  for (const response of responses) assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(responses[0].json(), responses[1].json());
  const first = responses[0].json();
  assert.equal(first.source.quantity, 6); assert.equal(first.destination.quantity, 4);
  assert.equal(first.destination.location, 'RH cabinet'); assert.equal(first.destination.responsible, 'Destination person');
  const second = await expect('POST', path, operator, { ...payload, requestId: randomUUID(), quantity: 2, toLocation: 'Must not overwrite', toResponsible: 'Must not overwrite' }, 200);
  assert.equal(second.destination.id, first.destination.id); assert.equal(second.destination.quantity, 6);
  assert.equal(second.destination.location, 'RH cabinet'); assert.equal(second.destination.responsible, 'Destination person');
  assert.equal(await prisma.nonPatrimonialMovement.count({ where: { itemId: item.id, type: 'TRANSFER_OUT' } }), 2);
  await prisma.userPool.delete({ where: { userId_poolId: { userId: operator.id, poolId: rh.id } } });
  await expect('POST', path, operator, payload, 404);
});

test('a new non-patrimonial destination leaves unspecified custody data pending rather than copying the source', async () => {
  const operator = await makeUser('np-pending-destination', UserRole.MANAGER, [ti.id, rh.id]);
  const item = await expect('POST', '/non-patrimonial', operator, { poolId: ti.id, categoryId: c2666.id, name: 'Unassigned delivery', quantity: 2, location: 'Old room', responsible: 'Old person' }, 201);
  const result = await expect('POST', `/non-patrimonial/${item.id}/transfer`, operator, { requestId: randomUUID(), toPoolId: rh.id, quantity: 2, notes: 'Awaiting allocation' }, 200);
  assert.equal(result.destination.location, null); assert.equal(result.destination.responsible, null);
  assert.equal(result.source.location, 'Old room'); assert.equal(result.source.responsible, 'Old person');
});

test('available-component transfers preserve global totals and installed units, and reuse compatible profiles', async () => {
  const operator = await makeUser('available-transfer', UserRole.MANAGER, [ti.id, rh.id]);
  const p = await makeProfile('available-transfer', 10);
  await expect('POST', '/stock/assign', manager, { requestId: randomUUID(), poolId: ti.id, assetIds: [pc2.id], components: [{ profileId: p.id, quantity: 2, origin: 'FROM_STOCK' }] }, 200);
  const before = (await expect('GET', '/stock/catalog', admin, undefined, 200)).totals;
  const payload = { requestId: randomUUID(), toPoolId: rh.id, quantity: 3, notes: 'Move spare units' };
  const path = `/stock/profiles/${p.id}/transfer`;
  await expect('POST', path, manager, payload, 404);
  const responses = await Promise.all([req('POST', path, operator, payload), req('POST', path, operator, payload)]);
  for (const response of responses) assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(responses[0].json(), responses[1].json());
  const first = responses[0].json(); assert.equal(first.source.available, 5); assert.equal(first.destination.available, 3);
  const second = await expect('POST', path, operator, { ...payload, requestId: randomUUID(), quantity: 1 }, 200);
  assert.equal(second.destination.id, first.destination.id); assert.equal(second.destination.available, 4);
  assert.deepEqual((await expect('GET', '/stock/catalog', admin, undefined, 200)).totals, before);
  assert.equal(await prisma.assetComponent.count({ where: { profileId: p.id, removedAt: null, quantity: 2 } }), 1);
  assert.equal(await prisma.stockMovement.count({ where: { operationId: payload.requestId } }), 2);
  await expect('POST', path, operator, { ...payload, quantity: 2 }, 409);
  await expect('POST', path, operator, { ...payload, requestId: randomUUID(), toPoolId: ti.id }, 400);
  await prisma.userPool.delete({ where: { userId_poolId: { userId: operator.id, poolId: rh.id } } });
  await expect('POST', path, operator, payload, 404);
});

test('available transfers reject incompatible or archived profiles and insufficient stock atomically', async () => {
  const operator = await makeUser('available-conflicts', UserRole.MANAGER, [ti.id, rh.id]);
  const p = await makeProfile('available-conflicts', 3);
  const destination = await expect('POST', '/stock/profiles', operator, { requestId: randomUUID(), poolId: rh.id, categoryId: c3200.id, name: p.name, initialAvailable: 0 }, 201);
  const path = `/stock/profiles/${p.id}/transfer`, payload = { requestId: randomUUID(), toPoolId: rh.id, quantity: 2, notes: 'Conflicting specs' };
  await expect('POST', path, operator, payload, 409);
  assert.equal((await prisma.itemProfile.findUniqueOrThrow({ where: { id: p.id } })).availableQty, 3);
  assert.equal(await prisma.stockMovement.count({ where: { operationId: payload.requestId } }), 0);
  await expect('PUT', `/stock/profiles/${destination.id}`, operator, { categoryId: p.categoryId }, 200);
  await expect('DELETE', `/stock/profiles/${destination.id}`, operator, undefined, 200);
  await expect('POST', path, operator, { ...payload, requestId: randomUUID() }, 409);
  await expect('POST', path, operator, { ...payload, requestId: randomUUID(), quantity: 4 }, 409);
  const missing = await app.inject({ method: 'POST', url: path, headers: auth(operator), payload: { toPoolId: rh.id, quantity: 1, notes: 'Missing ID' } });
  assert.equal(missing.statusCode, 400);
});

test('concurrent transfers of different operations cannot overdraw the available stock', async () => {
  const operator = await makeUser('available-race', UserRole.MANAGER, [ti.id, rh.id]);
  const p = await makeProfile('available-race', 5);
  await expect('POST', '/stock/profiles', operator, { requestId: randomUUID(), poolId: rh.id, categoryId: p.categoryId, name: p.name, initialAvailable: 0 }, 201);
  const responses = await Promise.all([1, 2].map(() => req('POST', `/stock/profiles/${p.id}/transfer`, operator, { requestId: randomUUID(), toPoolId: rh.id, quantity: 4, notes: 'Concurrent transfer' })));
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 409]);
  assert.equal((await prisma.itemProfile.findUniqueOrThrow({ where: { id: p.id } })).availableQty, 1);
});

test('import reports retain rejected source rows, export safe CSV, and enforce ownership', async () => {
  const csv = `patrimonio,nome,setor,categoria\nREPORT-${tag},Valid row,${ti.name},${computer.name}\n,=HYPERLINK("danger"),${ti.name},${computer.name}\n`;
  const preview = await analyzed(manager, '/imports/assets', 'CREATE', csv); assert.equal(preview.validRows, 1); assert.equal(preview.errorRows, 1);
  const response = await upload(manager, '/imports/assets', csv, preview.previewId); assert.equal(response.statusCode, 207, response.body);
  const job = response.json();
  const report = await expect('GET', `/imports/${job.id}`, manager, undefined, 200);
  assert.equal(report.errors.length, 1); assert.equal(report.errors[0].row, 3); assert.ok(report.errors[0].data.nome.startsWith('='));
  const download = await req('GET', `/imports/${job.id}/errors.csv`, manager); assert.equal(download.statusCode, 200);
  assert.ok(download.headers['content-type']?.includes('text/csv'));
  assert.ok(download.body.includes('motivo_erro')); assert.ok(download.body.includes("'=HYPERLINK")); assert.ok(!download.body.includes('Valid row'));
  const retryPreview = await analyzed(manager, '/imports/assets', 'CREATE', download.body);
  assert.equal(retryPreview.totalRows, 1); assert.equal(retryPreview.errorRows, 1);
  const otherUser = await makeUser('report-not-owner', UserRole.MANAGER, [ti.id]);
  await expect('GET', `/imports/${job.id}`, otherUser, undefined, 404);
  await expect('GET', `/imports/${job.id}/errors.csv`, otherUser, undefined, 404);
  await expect('GET', `/imports/${job.id}`, admin, undefined, 200);
});

test('import reports show commit-time rejections and remain compatible with old error records', async () => {
  const item = await expect('POST', '/non-patrimonial', manager, { poolId: ti.id, categoryId: c2666.id, name: 'Report stale balance', quantity: 10 }, 201);
  const csv = `codigo_interno,nome,setor,categoria,quantidade\n${item.internalCode},Report stale balance,${ti.name},${c2666.name},3\n`;
  const preview = await analyzed(manager, '/imports/non-patrimonial', 'SET_BALANCE', csv);
  await expect('POST', `/non-patrimonial/${item.id}/stock`, manager, { type: 'ENTRY', quantity: 1, notes: 'Concurrent receipt' }, 200);
  const result = await upload(manager, '/imports/non-patrimonial', csv, preview.previewId); assert.equal(result.statusCode, 207);
  const report = await expect('GET', `/imports/${result.json().id}`, manager, undefined, 200);
  assert.equal(report.errors[0].data.codigo_interno, item.internalCode); assert.ok(report.errors[0].message.includes('mudou'));
  const old = await prisma.importJob.create({ data: { fileName: 'old.csv', fileType: 'csv', userId: manager.id, poolIds: [ti.id], errorRows: 1, errors: [{ row: 2, message: 'Legacy rejection' }] } });
  const legacy = await expect('GET', `/imports/${old.id}`, manager, undefined, 200); assert.equal(legacy.errors[0].message, 'Legacy rejection');
  assert.ok((await req('GET', `/imports/${old.id}/errors.csv`, manager)).body.includes('Legacy rejection'));
  const revoked = await makeUser('report-revoked', UserRole.MANAGER, [ti.id]);
  const privateJob = await prisma.importJob.create({ data: { fileName: 'revoked.csv', fileType: 'csv', userId: revoked.id, poolIds: [ti.id] } });
  await prisma.userPool.delete({ where: { userId_poolId: { userId: revoked.id, poolId: ti.id } } });
  await expect('GET', `/imports/${privateJob.id}`, revoked, undefined, 404);
  await expect('GET', `/imports/${privateJob.id}/errors.csv`, revoked, undefined, 404);
});
