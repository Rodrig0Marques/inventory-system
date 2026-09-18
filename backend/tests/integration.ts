// This suite only runs on an explicitly named disposable database/schema.
// It never clears or recreates production data. See compose.test.yml.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
const req = (method: 'GET'|'POST'|'PUT'|'DELETE', path: string, user: any, payload?: object) => app.inject({ method, url: path, headers: auth(user), ...(payload ? { payload } : {}) });
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
  const book = XLSX.read(r.rawPayload,{ type:'buffer' }); const pools = JSON.stringify(XLSX.utils.sheet_to_json(book.Sheets.POOLS,{ header:1 }));
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
