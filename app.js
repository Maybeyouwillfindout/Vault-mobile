
// v2.7.2 — Jahresrückblick als gestapeltes Balkendiagramm
const FIXED_PASSWORD="test1234";

// --- crypto + idb (unchanged) ---
const enc=new TextEncoder(),dec=new TextDecoder();
function b64(b){return btoa(String.fromCharCode(...new Uint8Array(b)))}
function ub64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function keyFrom(pwd,salt){const km=await crypto.subtle.importKey("raw",enc.encode(pwd),"PBKDF2",false,["deriveKey"]);return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:200000,hash:"SHA-256"},km,{name:"AES-GCM",length:256},false,["encrypt","decrypt"])}
async function encJSON(k,o){const iv=crypto.getRandomValues(new Uint8Array(12));const pt=enc.encode(JSON.stringify(o));const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},k,pt);return{iv:b64(iv),ct:b64(ct)}}
async function decJSON(k,b){const iv=ub64(b.iv),ct=ub64(b.ct);const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv},k,ct);return JSON.parse(dec.decode(pt))}
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open("vault-db",22);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains("meta"))db.createObjectStore("meta");if(!db.objectStoreNames.contains("tx"))db.createObjectStore("tx",{keyPath:"id",autoIncrement:true});if(!db.objectStoreNames.contains("dups"))db.createObjectStore("dups",{keyPath:"hash"});};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function metaSet(k,v){const db=await idb();const t=db.transaction("meta","readwrite");t.objectStore("meta").put(v,k);return new Promise(r=>t.oncomplete=r)}
async function metaGet(k){const db=await idb();const t=db.transaction("meta","readonly");return new Promise(r=>{const q=t.objectStore("meta").get(k);q.onsuccess=()=>r(q.result);q.onerror=()=>r(undefined)})}
async function txAdd(e){const db=await idb();const t=db.transaction("tx","readwrite");t.objectStore("tx").add(e);return new Promise(r=>t.oncomplete=r)}
async function txAll(){const db=await idb();const t=db.transaction("tx","readonly");return new Promise(r=>{const q=t.objectStore("tx").getAll();q.onsuccess=()=>r(q.result||[]);q.onerror=()=>r([])})}
async function dupHas(h){const db=await idb();const t=db.transaction("dups","readonly");return new Promise(r=>{const q=t.objectStore("dups").get(h);q.onsuccess=()=>r(!!q.result);q.onerror=()=>r(false)})}
async function dupAdd(h){const db=await idb();const t=db.transaction("dups","readwrite");t.objectStore("dups").put({hash:h});return new Promise(r=>t.oncomplete=r)}

let aesKey=null;
async function ensureSalt(){let s=await metaGet("salt");if(!s){s=b64(crypto.getRandomValues(new Uint8Array(16)));await metaSet("salt",s)}return ub64(s)}
async function autoLogin(){aesKey=await keyFrom(FIXED_PASSWORD,await ensureSalt());if(!await metaGet("marker"))await metaSet("marker",await encJSON(aesKey,{ok:true}))}

// --- helpers ---
function norm(s){return String(s||'').toLowerCase().replace(/\s+/g,' ').trim()}
async function hashRec(r){const base=`${r.date}|${(r.amount||0).toFixed(2)}|${norm(r.description)}`;const dig=await crypto.subtle.digest('SHA-256',enc.encode(base));return b64(dig)}
function parseAmt(x){ if(x==null) return 0; let s=String(x).trim().replace(/\u00A0/g,'').replace(/'/g,''); const hasC=s.includes(','), hasD=s.includes('.'); if(hasC&&hasD) s=s.replace(/\./g,'').replace(',', '.'); else if(hasC) s=s.replace(',', '.'); else if(!hasC&&hasD){const parts=s.split('.'); if(parts.length>2){const last=parts.pop(); s=parts.join('')+'.'+last;}} const v=parseFloat(s); return isNaN(v)?0:v; }
function monthLabel(ym){const [y,m]=ym.split('-');const n=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];return `${n[parseInt(m)-1]} ${y}`}
function filterMonth(rows,ym){return rows.filter(r=>r.date && r.date.startsWith(ym))}
function curYM(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}

// colors & categories (same palette as 2.7.1)
const CATEGORY_COLORS={
  'Lebensmittel':'#34c759',
  'Gastronomie':'#ff9500',
  'Transport':'#5856d6',
  'ÖV':'#5ac8fa',
  'Elektronik/Online':'#ff2d55',
  'Gesundheit':'#ffcc00',
  'Versicherung':'#8e8e93',
  'Gutschrift':'#00c7be',
  'Sonstiges':'#ff3b30'
};
function colorFor(cat){return CATEGORY_COLORS[cat]||'#007aff'}
function categorize(r){
  const d=norm(r.description); const amt=r.amount||0; const has=(...k)=>k.some(x=>d.includes(x));
  if(has('coop','migros','denner','aldi','lidl','volg','migrolino','spar','manor food')) return 'Lebensmittel';
  if(has('sbb','vbz','zvv','postauto','tl ','bus','tram','bahnpass','ga abo')) return 'ÖV';
  if(has('kfc','mcdonald','burger king','subway','cafe','café','restaurant','take away','kebab','pizzeria','starbucks')) return 'Gastronomie';
  if(has('shell','avia','bp','esso','agrola','tamoil','eni','tank','migrol','coop pronto')) return amt>25 ? 'Transport' : 'Lebensmittel';
  if(has('galaxus','digitec','amazon','aliexpress','microspot','brack','melectronics')) return 'Elektronik/Online';
  if(has('apotheke','pharma','drogerie','medico','doctor')) return 'Gesundheit';
  if(has('versicherung','axa','mobiliar','generali','helvetia','swica','suva')) return 'Versicherung';
  if(has('twint','gutschrift','refund','rückzahlung','erstattung','cashback')) return 'Gutschrift';
  return 'Sonstiges';
}

// --- CSV import (kept minimal to demo) ---
function toYearFromYY(yy){const y=parseInt(yy,10);return y>=70?`19${yy}`:`20${yy}`}
function toISODate(s){s=String(s).trim();let m=s.match(/^(\d{2})\.(\d{2})\.(\d{2,4})$/);if(m){const d=m[1],mo=m[2],y=m[3].length===2?toYearFromYY(m[3]):m[3];return `${y}-${mo}-${d}`;} if(/\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10); return s;}
function parseCSV(text){
  const res = Papa.parse(text, {header:true, skipEmptyLines:true, dynamicTyping:false});
  const rows=[]; const headers=(res.meta.fields||[]).map(h=>h.toLowerCase());
  const findCol=names=>headers.find(h=>names.some(n=>h.includes(n)));
  const dateCol=findCol(['datum','date','buchung','valuta','booking']);
  const descCol=findCol(['beschreibung','text','verwendung','empfänger','auftraggeber','recipient','purpose']);
  const amtCol=findCol(['betrag','amount','umsatz','value','chf','eur']);
  for(const r of res.data){
    const date=(r[dateCol]||'').toString(); const desc=(r[descCol]||r[Object.keys(r)[0]]||'').toString();
    const amt=parseAmt(r[amtCol]||'0');
    if(date && desc && amt!==0) rows.push({date:toISODate(date), description:desc.trim(), amount:amt});
  }
  return rows;
}

// --- Monthly & Yearly Views ---
async function getAllDecrypted(){
  const raws=await txAll(); const out=[]; for(const e of raws){try{out.push(await decJSON(aesKey,e))}catch{}}
  out.forEach(r=>{ if(!r.category) r.category=categorize(r); });
  return out;
}

async function showMonth(preferLast=true){
  const decd=await getAllDecrypted();
  let ym=curYM(); const li=await metaGet('lastImport'); if(preferLast&&li?.ym) ym=li.ym;
  let rows=filterMonth(decd,ym); if(!rows.length&&decd.length){const months=[...new Set(decd.map(r=>r.date.slice(0,7)))].sort(); ym=months.pop(); rows=filterMonth(decd,ym);}
  const m=new Map(); for(const r of rows){const k=(r.category||'—')||'—'; m.set(k,(m.get(k)||0)+(r.amount||0));}
  const items=[...m.entries()].sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])); const total=[...m.values()].reduce((a,b)=>a+b,0);
  document.getElementById('screen').innerHTML=`
    <h2>Monatsübersicht ${monthLabel(ym)}</h2>
    <div class="pie-wrap"><canvas id="pie" class="pie"></canvas></div>
    <ul id="legend" class="legend"></ul>
    <h3>Details: <span id="catName">—</span></h3>
    <table class="table"><thead><tr><th>Datum</th><th>Beschreibung</th><th class="right">Betrag</th></tr></thead><tbody id="details"></tbody></table>`;
  const ctx=document.getElementById('pie');
  const labels=items.map(i=>i[0]), data=items.map(i=>i[1]), colors=labels.map(l=>colorFor(l));
  new Chart(ctx,{type:'pie',data:{labels,datasets:[{data,backgroundColor:colors,borderColor:'#fff',borderWidth:1}]},options:{plugins:{legend:{display:false}}}});
  const ul=document.getElementById('legend'); const selectCat=(cat)=>{document.getElementById('catName').textContent=cat; document.getElementById('details').innerHTML=rows.filter(r=>(r.category||'—')===cat).map(r=>`<tr><td>${r.date}</td><td>${r.description}</td><td class="right">${(r.amount||0).toFixed(2)} CHF</td></tr>`).join('')||'<tr><td colspan="3" class="muted">Keine Daten</td></tr>'; };
  labels.forEach((l,i)=>{const v=data[i],p=total?Math.round(v/total*100):0; const li=document.createElement('li'); li.className='chip'; li.innerHTML=`<span class="swatch" style="background:${colors[i]}"></span>${l} • ${v.toFixed(2)} CHF (${p}%)`; li.onclick=()=>selectCat(l); ul.appendChild(li); });
  if(labels.length) selectCat(labels[0]);
}

async function showYear(){
  const decd=await getAllDecrypted();
  const y=(new Date()).getFullYear();
  const months=Array.from({length:12},(_,i)=>`${y}-${String(i+1).padStart(2,'0')}`);
  // Kategorien ermitteln
  const cats=[...new Set(decd.map(r=>r.category||'Sonstiges'))].sort();
  // Datenmatrix: cat x month
  const sums={}; cats.forEach(c=>sums[c]=months.map(()=>0));
  decd.forEach(r=>{ if(r.date.startsWith(String(y))){ const m=parseInt(r.date.slice(5,7),10)-1; sums[r.category||'Sonstiges'][m]+= (r.amount||0); }});
  const datasets=cats.map(c=>({label:c,data:sums[c],backgroundColor:colorFor(c),stack:'sum'}));
  document.getElementById('screen').innerHTML=`
    <div class="row">
      <h2 style="margin-right:auto">Jahresrückblick ${y}</h2>
      <select id="mode">
        <option value="stacked" selected>Gestapelt (Summe)</option>
        <option value="grouped">Gruppiert (nebeneinander)</option>
      </select>
    </div>
    <canvas id="bar" style="max-width:980px;width:100%;height:auto"></canvas>
    <p class="muted">Tipp: Auf einen Monat tippen, um die Monatsübersicht zu öffnen.</p>
  `;
  const ctx=document.getElementById('bar').getContext('2d');
  let stacked=true;
  const chart=new Chart(ctx,{
    type:'bar',
    data:{labels:months.map(m=>monthLabel(m)),datasets},
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{x:{stacked:true}, y:{stacked:true, ticks:{callback:(v)=>v+' CHF'}}},
      plugins:{legend:{position:'bottom'}},
      onClick:(e,els)=>{ if(els.length){ const xIndex=els[0].index; const ym=months[xIndex]; metaSet('lastImport',{ym,ts:Date.now(),count:0}).then(()=>showMonth(true)); } }
    }
  });
  document.getElementById('mode').onchange=(e)=>{
    stacked = e.target.value==='stacked';
    chart.options.scales.x.stacked=stacked;
    chart.options.scales.y.stacked=stacked;
    chart.update();
  };
}

// --- Import (CSV quick demo, wie 2.7.1) ---
function showImport(){
  document.getElementById('screen').innerHTML=`
    <h2>Datei importieren</h2>
    <input type="file" id="file" accept=".csv,text/csv" />
    <button id="go">Import starten</button>
    <table class="table" style="margin-top:10px"><thead><tr><th>Datum</th><th>Beschreibung</th><th class="right">Betrag</th></tr></thead><tbody id="preview"></tbody></table>
  `;
  document.getElementById('go').onclick=async()=>{
    const f=document.getElementById('file').files[0]; if(!f) return alert('Bitte Datei wählen.');
    const txt=await f.text();
    const rows=parseCSV(txt).map(r=>({...r,category: categorize(r)}));
    document.getElementById('preview').innerHTML=rows.map(r=>`<tr><td>${r.date}</td><td><strong>${r.category}</strong> – ${r.description}</td><td class="right">${(r.amount||0).toFixed(2)} CHF</td></tr>`).join('');
    let imported=0; for(const r of rows){const h=await hashRec(r); if(await dupHas(h)) continue; await txAdd(await encJSON(aesKey,r)); await dupAdd(h); imported++;}
    if(imported){const ym=rows.find(r=>r.date)?.date?.slice(0,7)||curYM(); await metaSet('lastImport',{ym,ts:Date.now(),count:rows.length}); await showMonth(true);}
  };
}

// bootstrap
window.addEventListener('load', async ()=>{
  await autoLogin();
  document.getElementById('btn-import').onclick=showImport;
  document.getElementById('btn-month').onclick=()=>showMonth(true);
  document.getElementById('btn-year').onclick=showYear;
  document.getElementById('btn-review').onclick=showYear;
  showYear();
});
