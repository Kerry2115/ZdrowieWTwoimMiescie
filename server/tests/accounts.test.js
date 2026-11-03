import test, { after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
const { app } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { runMigrations } = await import('../src/migrations.js');
runMigrations(db);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.on('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
after(() => {server.close();db.close();});
async function request(path, method='GET', body, cookie) {
 const res = await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
}
function cache(path, params, data) {
 const url=new URL('https://api.nfz.gov.pl/app-itl-api/'+path);
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
 url.searchParams.sort();
 db.prepare('INSERT OR REPLACE INTO api_cache(cache_key,payload,expires_at) VALUES(?,?,?)').run(url.toString(),JSON.stringify(data),new Date(Date.now()+60000).toISOString());
}
let cookie;
const id='11111111-1111-4111-8111-111111111111';
const item={type:'queue',id,attributes:{provider:'Poradnia testowa',benefit:'KARDIOLOGIA',locality:'Poznań',dates:{applicable:true,date:'2027-04-12'}}};
test('Chroni profil i ulubione przed dostępem bez konta',async()=>{
 assert.equal((await request('/favorites')).status,401);
 assert.equal((await request('/profile','PUT',{})).status,401);
});
test('Rejestracja tworzy sesję i nie udostępnia hasła',async()=>{
 const r=await request('/auth/register','POST',{email:'test@example.pl',password:'haslo-testowe-123'});
 assert.equal(r.status,200); assert.ok(r.cookie); cookie=r.cookie;
 assert.equal(r.body.data.email,'test@example.pl');assert.equal(r.body.data.password_hash,undefined);
 assert.notEqual(db.prepare('SELECT password_hash FROM users').get().password_hash,'haslo-testowe-123');
 assert.equal((await request('/auth/me','GET',null,cookie)).body.data.email,'test@example.pl');
});
test('Waliduje dane i trwale zapisuje profil',async()=>{
 assert.equal((await request('/profile','PUT',{firstName:1},cookie)).status,400);
 const profile={firstName:'Jan',lastName:'Kowalski',city:'Poznań',phone:'123456789'};
 assert.equal((await request('/profile','PUT',profile,cookie)).status,200);
 assert.equal((await request('/auth/me','GET',null,cookie)).body.data.firstName,'Jan');
});
test('Ulubione pobiera z NFZ, zapisuje idempotentnie i izoluje między kontami',async()=>{
 cache('queues/'+id,{format:'json'},{data:item});
 assert.equal((await request('/favorites/'+id,'PUT',null,cookie)).status,200);
 assert.equal((await request('/favorites/'+id,'PUT',null,cookie)).status,200);
 assert.equal((await request('/favorites','GET',null,cookie)).body.data.length,1);
 const other=await request('/auth/register','POST',{email:'other@example.pl',password:'inne-haslo-123'});
 assert.deepEqual((await request('/favorites','GET',null,other.cookie)).body.data,[]);
 await request('/favorites/'+id,'DELETE',null,other.cookie);
 assert.equal((await request('/favorites','GET',null,cookie)).body.data.length,1);
 await request('/favorites/'+id,'DELETE',null,cookie);
 assert.equal((await request('/favorites','GET',null,cookie)).body.data.length,0);
});
test('Przekazuje miasto do NFZ przed paginacją i waliduje limit',async()=>{
 cache('queues',{format:'json',case:'1',province:'15',limit:'25',page:'1',locality:'Poznań',benefit:'KARDIOLOGIA'},{data:[item],meta:{count:1}});
 const r=await request('/nfz/queues?province=15&locality=Pozna%C5%84&benefit=KARDIOLOGIA');
 assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.data[0].id,id);
 assert.equal((await request('/nfz/queues?limit=26')).status,400);
 assert.equal((await request('/nfz/queues?page=999999999999999999')).status,400);
});
test('Wylogowanie unieważnia sesję, ponowne logowanie przywraca profil',async()=>{
 await request('/logout','POST',null,cookie);
 assert.equal((await request('/auth/me','GET',null,cookie)).body.data,null);
 assert.equal((await request('/auth/login','POST',{email:'test@example.pl',password:'zle-haslo'})).status,401);
 const r=await request('/auth/login','POST',{email:'TEST@example.pl',password:'haslo-testowe-123'});
 assert.equal(r.status,200);assert.equal(r.body.data.firstName,'Jan');
});
test('Odrzuca zapis z obcej domeny',async()=>{
 const r=await fetch(base+'/auth/login',{method:'POST',headers:{origin:'https://obca.example','Content-Type':'application/json'},body:'{}'});
 assert.equal(r.status,403);
});

test('Słownik świadczeń korzysta z cache NFZ i waliduje nazwę',async()=>{
 cache('benefits',{format:'json',name:'PORADNIA',limit:25},{data:['PORADNIA ALERGOLOGICZNA']});
 const r=await request('/nfz/benefits');
 assert.equal(r.status,200);assert.deepEqual(r.body.data,['PORADNIA ALERGOLOGICZNA']);
 assert.equal((await request('/nfz/benefits?name='+ 'a'.repeat(251))).status,400);
});
test('Wygasła sesja traci dostęp do danych konta',async()=>{
 const r=await request('/auth/login','POST',{email:'test@example.pl',password:'haslo-testowe-123'});
 db.prepare('UPDATE sessions SET expires_at=0').run();
 assert.equal((await request('/favorites','GET',null,r.cookie)).status,401);
 assert.equal((await request('/auth/me','GET',null,r.cookie)).body.data,null);
});
