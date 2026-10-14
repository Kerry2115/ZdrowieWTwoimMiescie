import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';

const provinces=[['01','Dolnośląskie'],['02','Kujawsko-pomorskie'],['03','Lubelskie'],['04','Lubuskie'],['05','Łódzkie'],['06','Małopolskie'],['07','Mazowieckie'],['08','Opolskie'],['09','Podkarpackie'],['10','Podlaskie'],['11','Pomorskie'],['12','Śląskie'],['13','Świętokrzyskie'],['14','Warmińsko-mazurskie'],['15','Wielkopolskie'],['16','Zachodniopomorskie']];
const suggestions=['PORADNIA KARDIOLOGICZNA','PORADNIA MEDYCYNY SPORTOWEJ','PORADNIA LOGOPEDYCZNA','PORADNIA NEUROLOGICZNA','PORADNIA OKULISTYCZNA','PORADNIA ORTOPEDYCZNA','PORADNIA DERMATOLOGICZNA','PORADNIA POŁOŻNICZO-GINEKOLOGICZNA','ODDZIAŁ NEUROLOGICZNY'];
function firstDate(a){
 const d=a?.dates;
 if(!d) return null;
 // NFZ returns dates in various nested structures; only show valid explicit date strings.
 const candidates=[d?.['date'],d?.['first-date'],d?.['firstDate'],d?.['first-available-date'],d?.['date-of-first-availability'],d?.['date-of-first-available-appointment'],d?.['first-available-appointment'],d?.['first-available-term'],d?.['date-first'],d?.['date-of-first-available-term']];
 if(Array.isArray(d)) candidates.push(...d);
 for(const value of candidates){
  const raw=typeof value==='string'?value:null;
  if(raw && /^\d{4}-\d{2}-\d{2}/.test(raw) && !Number.isNaN(Date.parse(raw.slice(0,10)))) return raw.slice(0,10);
 }
 return null;
}
function Facility({item}){
 const a=item.attributes||{};
 const date=firstDate(a);
 return <article className="facility">
  <div className="facilityHead"><div><h3>{a.provider||a.place||'Placówka bez nazwy'}</h3><p className="muted">{a.benefit||'Świadczenie NFZ'}</p></div><span className="tag">NFZ</span></div>
  {a.place&&a.place!==a.provider&&<p><strong>Poradnia:</strong> {a.place}</p>}
  <p>📍 {[a.address,a.locality].filter(Boolean).join(', ')||'Brak adresu'}</p>
  <p>☎ {a.phone||'Brak numeru telefonu'}</p>
  <p>📅 <strong>Pierwszy wolny termin:</strong> {date||'Brak danych o terminie'}</p>
  <p className="muted small">Udogodnienia: {[
   ['ramp','podjazd'],['elevator','winda'],['car-park','parking'],['toilet','toaleta']
  ].filter(([key])=>a[key]==='Y').map(([,label])=>label).join(', ')||'Brak potwierdzonych informacji'}</p>
  {Number.isFinite(a.latitude)&&Number.isFinite(a.longitude)&&<a href={`https://www.google.com/maps?q=${a.latitude},${a.longitude}`} target="_blank" rel="noopener noreferrer">Pokaż na mapie ↗</a>}
 </article>;
}
function App(){
 const [province,setProvince]=useState('07');
 const [benefit,setBenefit]=useState('PORADNIA MEDYCYNY SPORTOWEJ');
 const [city,setCity]=useState('');
 const [sort,setSort]=useState('date');
 const [page,setPage]=useState(1);
 const [result,setResult]=useState(null);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(false);
 async function search(e,nextPage=1){
  e?.preventDefault();
  setLoading(true);setError('');
  try{
   const params=new URLSearchParams({province,benefit:benefit.trim(),limit:'10',page:String(nextPage),case:'1'});
   const response=await fetch(`/api/nfz/queues?${params}`);
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||`Błąd HTTP ${response.status}`);
   if(!Array.isArray(data.data))throw new Error('API NFZ zwróciło niepoprawne dane');
   setResult(data);setPage(nextPage);
  }catch(err){setError(err.message||'Nie udało się pobrać danych');setResult(null)}
  finally{setLoading(false)}
 }
 const all=result?.data||[];
 const filtered=all.filter(item=>!city.trim()||String(item.attributes?.locality||'').toLocaleLowerCase('pl').includes(city.trim().toLocaleLowerCase('pl')));
 const shown=[...filtered].sort((a,b)=>{
  if(sort==='name')return String(a.attributes?.provider||'').localeCompare(String(b.attributes?.provider||''),'pl');
  if(sort==='city')return String(a.attributes?.locality||'').localeCompare(String(b.attributes?.locality||''),'pl');
  return (firstDate(a.attributes)||'9999-12-31').localeCompare(firstDate(b.attributes)||'9999-12-31');
 });
 const count=Number(result?.meta?.count||0);
 return <main>
  <header><h1>Zdrowie w Twoim Mieście</h1><p>Wyszukiwarka świadczeń medycznych NFZ</p></header>
  <form onSubmit={e=>search(e,1)}>
   <div className="fields">
    <label>Województwo<select value={province} onChange={e=>setProvince(e.target.value)}>{provinces.map(([code,name])=><option value={code} key={code}>{name}</option>)}</select></label>
    <label>Świadczenie (nazwa lub fragment)<input list="benefits" value={benefit} onChange={e=>setBenefit(e.target.value)} placeholder="np. KARDIOLOGICZNA"/><datalist id="benefits">{suggestions.map(x=><option key={x} value={x}/>)}</datalist></label>
   </div>
   <button disabled={loading}>{loading?'Pobieranie…':'Szukaj terminów'}</button>
  </form>
  {error&&<p className="error" role="alert">{error}</p>}
  {result&&<section className="results">
   <div className="resultHead"><div><h2>Wyniki NFZ: {count.toLocaleString('pl-PL')}</h2><p className="muted">Pobrano {all.length} rekordów ze strony {page}. Filtry miasta i sortowanie dotyczą wyłącznie pobranej strony, a nie wszystkich wyników NFZ.</p></div></div>
   <div className="filters">
    <label>Filtruj miasto (na tej stronie)<input value={city} onChange={e=>setCity(e.target.value)} placeholder="np. Warszawa"/></label>
    <label>Sortuj wyniki<select value={sort} onChange={e=>setSort(e.target.value)}><option value="date">Najwcześniejszy termin</option><option value="name">Nazwa placówki A–Z</option><option value="city">Miasto A–Z</option></select></label>
   </div>
   <p className="muted">Widoczne placówki: {shown.length}. Brak daty nie oznacza braku świadczenia.</p>
   {shown.length?shown.map(item=><Facility key={item.id} item={item}/>):<div className="empty">Brak placówek spełniających wybrane kryteria na tej stronie. Zmień miasto, świadczenie lub przejdź do kolejnej strony.</div>}
   <div className="pager"><button type="button" disabled={loading||page<=1} onClick={()=>search(null,page-1)}>← Poprzednia</button><span>Strona {page}</span><button type="button" disabled={loading||!result.links?.next} onClick={()=>search(null,page+1)}>Następna →</button></div>
  </section>}
  <footer>Źródło: publiczne API NFZ. Dane i dostępność terminów mogą się zmieniać — potwierdź termin w placówce.</footer>
 </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
