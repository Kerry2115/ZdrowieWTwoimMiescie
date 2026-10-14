import { db } from './db.js';
const TTL = 15 * 60 * 1000;
export class ApiError extends Error { constructor(message,status=502){super(message);this.status=status;} }
export async function cachedJson(base, params) {
 const url=new URL(base);
 for(const [key,val] of Object.entries(params)) if(val!==undefined && val!==null && val!=='') url.searchParams.set(key,String(val));
 const key=url.toString();
 const row=db.prepare('SELECT payload FROM api_cache WHERE cache_key=? AND expires_at > ?').get(key,new Date().toISOString());
 if(row) return JSON.parse(row.payload);
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),8000);
 try {
  const response=await fetch(url,{signal:controller.signal,headers:{accept:'application/json'}});
  if(!response.ok) throw new ApiError(`API zwróciło HTTP ${response.status}`,502);
  const json=await response.json();
  if(!json || typeof json!=='object') throw new ApiError('Nieprawidłowa odpowiedź API');
  db.prepare(`INSERT INTO api_cache(cache_key,payload,expires_at) VALUES(?,?,?)
    ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at`)
    .run(key,JSON.stringify(json),new Date(Date.now()+TTL).toISOString());
  return json;
 } catch(err) {
  if(err.name==='AbortError') throw new ApiError('Przekroczono czas odpowiedzi API',504);
  if(err instanceof ApiError) throw err;
  throw new ApiError('Nie udało się pobrać danych z API');
 } finally {clearTimeout(timer);}
}
export const nfzQueues = (params) =>
  cachedJson('https://api.nfz.gov.pl/app-itl-api/queues', {
    format: 'json',
    case: '1',
    ...params,
    province: String(params.province ?? '07').padStart(2, '0')
  });
export const gusUnits = (params)=>cachedJson('https://bdl.stat.gov.pl/api/v1/units',params);
