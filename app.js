
// v2.6.5 – UI polish: smaller pie, category chips & summary
const FIXED_PASSWORD="test1234";

// --- crypto + idb (same as 2.6.4) ---
const enc=new TextEncoder(),dec=new TextDecoder();
function b64(b){return btoa(String.fromCharCode(...new Uint8Array(b)))}
function ub64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function keyFrom(pwd,salt){const km=await crypto.subtle.importKey("raw",enc.encode(pwd),"PBKDF2",false,["deriveKey"]);return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:200000,hash:"SHA-256"},km,{name:"AES-GCM",length:256},false,["encrypt","decrypt"])}
async function encJSON(k,o){const iv=crypto.getRandomValues(new Uint8Array(12));const pt=enc.encode(JSON.stringify(o));const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},k,pt);return{iv:b64(iv),ct:b64(ct)}}
async function decJSON(k,b){const iv=ub64(b.iv),ct=ub64(b.ct);const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv},k,ct);return JSON.parse(dec.decode(pt))}
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open("vault-db",16);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains("meta"))db.createObjectStore("meta");if(!db.objectStoreNames.contains("tx"))db.createObjectStore("tx",{keyPath:"id",autoIncrement:true});if(!db.objectStoreNames.contains("dups"))db.createObjectStore("dups",{keyPath:"hash"});};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
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
function parseAmt(x){
  if(x==null) return 0;
  let s=String(x).trim().replace(/\u00A0/g,'').replace(/'/g,'');
  const hasC=s.includes(','), hasD=s.includes('.');
  if(hasC&&hasD) s=s.replace(/\./g,'').replace(',', '.');
  else if(hasC) s=s.replace(',', '.');
  else if(!hasC&&hasD){
    const parts=s.split('.'); if(parts.length>2){const last=parts.pop(); s=parts.join('')+'.'+last;}
  }
  const v=parseFloat(s); return isNaN(v)?0:v;
}
function monthKey(d){const dt=new Date(d);return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`}
function monthLabel(ym){const [y,m]=ym.split('-');const n=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];return `${n[parseInt(m)-1]} ${y}`}
function norm(s){return String(s||'').toLowerCase().replace(/\s+/g,' ').trim()}
async function hashRec(r){const base=`${r.date}|${(r.amount||0).toFixed(2)}|${norm(r.description)}`;const dig=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(base));return b64(dig)}

// --- categories ---
function categorize(r){
  const d=norm(r.description); const amt=r.amount||0; const has=(...k)=>k.some(x=>d.includes(x));
  if(has('coop','migros','denner','aldi','lidl')) return 'Lebensmittel';
  if(has('sbb','vbz','zvv','postauto','tl ')) return 'ÖV';
  if(has('kfc','mcdonald','burger king','subway','cafe','café','restaurant','take away','kebab')) return 'Gastronomie';
  if(has('shell','avia','bp','esso','agrola','tamoil','eni','tank')) return amt>25 ? 'Transport' : 'Lebensmittel';
  if(has('galaxus','digitec','amazon','aliexpress','microspot','brack')) return 'Elektronik/Online';
  if(has('apotheke','pharma','drogerie')) return 'Gesundheit';
  if(has('versicherung','axa','mobiliar','generali')) return 'Versicherung';
  return 'Sonstiges';
}

// --- OCR parser (using 2.6.4 logic; kept concise here) ---
function joinLines(raw){
  const lines=raw.split(/\r?\n/).map(l=>l.replace(/[•··]/g,' ').replace(/\s{2,}/g,' ').trim());
  const out=[]; let cur=null; const dateRe=/^\d{2}\.\d{2}(?!\.)/;
  for(const ln of lines){ if(!ln) continue; if(dateRe.test(ln)){ if(cur) out.push(cur); cur=ln; } else if(cur){cur+=' '+ln;} }
  if(cur) out.push(cur); return out;
}
function pickAmountAndYear(st){
  const numRe=/[-+]?\d{1,3}(?:[\'\s\.]\d{3})*(?:[\.,]\d{2})/g, dateYYRe=/(\d{2}\.\d{2}\.\d{2})(?!\d)/g, timeRe=/\b\d{2}[:\.]\d{2}\b/g;
  const firstDM=(st.match(/\b\d{2}\.\d{2}\b/)||[])[0]; const yyMatch=Array.from(st.matchAll(dateYYRe)).pop();
  const yy = yyMatch ? yyMatch[1].split('.')[2] : String(new Date().getFullYear()).slice(-2);
  const tokens=(st.match(numRe)||[]).filter(t=>{ if(firstDM&&t.replace(',','.')===firstDM.replace(',','.')) return false; if(timeRe.test(t)) return false; return true; });
  if(!tokens.length) return null; const amt=tokens.length>=2?tokens[tokens.length-2]:tokens[tokens.length-1];
  return {amount:parseAmt(amt),year2:yy};
}
function parseStitched(line){
  const firstDM=(line.match(/\b\d{2}\.\d{2}\b/)||[])[0]; if(!firstDM) return null;
  const pick=pickAmountAndYear(line); if(!pick) return null;
  const [d,m]=firstDM.split('.'); const Y=pick.year2.length===2?`20${pick.year2}`:pick.year2; const date=`${Y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  const desc=line.replace(/^\d{2}\.\d{2}\s*/,'').replace(/\s\d{2}\.\d{2}\.\d{2}\b.*$/,'').trim();
  return {date,description:desc,amount:pick.amount};
}
function extractFromOCR(raw){ const stitched=joinLines(raw); const out=[]; for(const ln of stitched){const r=parseStitched(ln); if(r) out.push(r);} return out; }

// --- charts + ui ---
function aggregate(rows){
  const m=new Map(); for(const r of rows){const k=(r.category||'—')||'—'; m.set(k,(m.get(k)||0)+(r.amount||0));}
  const items=[...m.entries()].sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
  const total=[...m.values()].reduce((a,b)=>a+b,0);
  return {items,total};
}
function buildPie(canvasId,legendId,items,onClick,total){
  const ctx=document.getElementById(canvasId);
  const labels=items.map(i=>i[0]), data=items.map(i=>i[1]);
  const colors=labels.map((_,i)=>`hsl(${(i*63)%360} 80% 60%)`);
  if(window._c&&window._c[canvasId]) window._c[canvasId].destroy();
  window._c||(window._c={});
  window._c[canvasId]=new Chart(ctx,{type:'pie',data:{labels,datasets:[{data,backgroundColor:colors}]},
    options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{display:false}},onClick:(e,els)=>{if(els.length)onClick(labels[els[0].index]);}}});
  // legend as chips
  const ul=document.getElementById(legendId); ul.innerHTML='';
  labels.forEach((l,i)=>{const v=data[i],p=total?Math.round(v/total*100):0;
    const li=document.createElement('li'); li.className='chip'; li.innerHTML=`<span class="swatch" style="background:${colors[i]}"></span>${l} • ${v.toFixed(2)} CHF (${p}%)`;
    li.onclick=()=>onClick(l); ul.appendChild(li);
  });
}
function renderTable(id,rows,withCat=false){
  document.getElementById(id).innerHTML=rows.map(r=>`<tr><td>${r.date}</td><td>${withCat?('<strong>'+ (r.category||'—') + '</strong> – '):''}${r.description}</td><td class="right">${(r.amount||0).toFixed(2)} CHF</td></tr>`).join('')||`<tr><td colspan="3" class="muted">Keine Daten</td></tr>`;
}
function catSummaryTable(items,total){
  return `<table class="table"><thead><tr><th>Kategorie</th><th class="right">Summe</th><th class="right">Anteil</th></tr></thead><tbody>${
    items.map(([k,v])=>`<tr><td>${k}</td><td class="right">${v.toFixed(2)} CHF</td><td class="right">${total?Math.round(v/total*100):0}%</td></tr>`).join('')
  }</tbody></table>`;
}

// month view
function filterMonth(rows,ym){return rows.filter(r=>r.date && r.date.startsWith(ym))}
function curYM(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}

async function showMonth(preferLast=true){
  const raws=await txAll(); const decd=[]; for(const e of raws){try{decd.push(await decJSON(aesKey,e))}catch{}}
  let ym=curYM(); const li=await metaGet('lastImport'); if(preferLast&&li?.ym) ym=li.ym;
  let rows=filterMonth(decd,ym); if(!rows.length&&decd.length){const months=[...new Set(decd.map(r=>r.date.slice(0,7)))].sort(); ym=months.pop(); rows=filterMonth(decd,ym);}
  const agg=aggregate(rows);
  const banner=li?.ym===ym ? `<div class="info"><strong>Zuletzt importiert:</strong> ${li.count} Buchung(en) in ${monthLabel(ym)} (vor ${Math.max(1,Math.round((Date.now()-li.ts)/60000))} Min)</div>` : '';
  document.getElementById('screen').innerHTML = `
    <h2>Monatsübersicht ${monthLabel(ym)}</h2>
    ${banner}
    <div class="pie-wrap"><canvas id="pie" class="pie"></canvas></div>
    <ul id="legend" class="legend"></ul>
    <h3>Kategorien</h3>
    ${catSummaryTable(agg.items, agg.total)}
    <h3>Details: <span id="catName">—</span></h3>
    <table class="table"><thead><tr><th>Datum</th><th>Beschreibung</th><th class="right">Betrag</th></tr></thead>
      <tbody id="details"></tbody></table>`;
  const selectCat=(cat)=>{document.getElementById('catName').textContent=cat; renderTable('details',rows.filter(r=>(r.category||'—')===cat),false);};
  buildPie('pie','legend',agg.items,selectCat,agg.total);
  if(agg.items.length) selectCat(agg.items[0][0]);
}

// year & scan (reuse 2.6.4 where not critical)
async function showYear(){
  const raws=await txAll(); const decd=[]; for(const e of raws){try{decd.push(await decJSON(aesKey,e))}catch{}}
  const y=(new Date()).getFullYear(); const months=[...new Set(decd.filter(r=>r.date.startsWith(String(y))).map(r=>r.date.slice(0,7)))].sort();
  document.getElementById('screen').innerHTML=`<h2>Jahresübersicht ${y}</h2><div id="months"></div>`;
  const c=document.getElementById('months'); months.forEach(ym=>{const sum=filterMonth(decd,ym).reduce((a,b)=>a+(b.amount||0),0);const a=document.createElement('a');a.href='#';a.textContent=`${monthLabel(ym)} – ${sum.toFixed(2)} CHF`;a.onclick=(e)=>{e.preventDefault();showMonth(false)};c.appendChild(a);});
}

function scanScreen(){
  document.getElementById('screen').innerHTML=`<h2>OCR Import</h2>
  <input type="file" id="file" accept="image/*"><button id="go">Screenshot lesen & importieren</button>
  <pre id="log" class="log" style="display:none"></pre>
  <details><summary>Erkannter Rohtext</summary><pre id="raw" class="log" style="display:none"></pre></details>
  <table class="table"><thead><tr><th>Datum</th><th>Beschreibung</th><th class="right">Betrag</th></tr></thead><tbody id="prev"></tbody></table>`;
  const log=(m)=>{const el=document.getElementById('log'); el.style.display='block'; el.textContent+=(el.textContent?'\n':'')+m; el.scrollTop=el.scrollHeight;}
  const setRaw=(t)=>{const el=document.getElementById('raw'); el.style.display='block'; el.textContent=t || '(leer)';}
  document.getElementById('go').onclick=async()=>{
    const f=document.getElementById('file').files[0]; if(!f) return alert('Bitte Bild wählen.');
    if(!window.Tesseract) return alert('OCR Engine benötigt Internet beim ersten Mal.');
    try{
      log('⏳ OCR startet…'); const w=await Tesseract.createWorker('deu+eng',1,{logger:m=>m.status&&log('Tesseract: '+m.status)});
      const res=await w.recognize(await f.arrayBuffer()); await w.terminate(); log('✅ OCR beendet.');
      const raw=res?.data?.text||''; setRaw(raw);
      const rows=extractFromOCR(raw); rows.forEach(r=>r.category=categorize(r));
      document.getElementById('prev').innerHTML=rows.map(r=>`<tr><td>${r.date}</td><td><strong>${r.category}</strong> – ${r.description}</td><td class="right">${r.amount.toFixed(2)} CHF</td></tr>`).join('')||'<tr><td colspan="3" class="muted">Keine Daten erkannt</td></tr>';
      // save with dedupe
      let imported=0; for(const r of rows){const h=await hashRec(r); if(await dupHas(h)) continue; await txAdd(await encJSON(aesKey,r)); await dupAdd(h); imported++;}
      if(imported){const d=rows.find(r=>r.date)?.date?.slice(0,7)||curYM(); await metaSet('lastImport',{ym:d,ts:Date.now(),count:rows.length}); await metaSet('lastImportRows',rows.slice(-50)); await showMonth(true);}
    }catch(e){log('❌ Fehler: '+(e?.message||e));}
  };
}

// bootstrap
window.addEventListener('load', async ()=>{
  if('serviceWorker' in navigator){try{await navigator.serviceWorker.register('./sw.js?v=2650')}catch{}}
  await autoLogin();
  document.getElementById('btn-scan').onclick=scanScreen;
  document.getElementById('btn-month').onclick=()=>showMonth(true);
  document.getElementById('btn-year').onclick=showYear;
  scanScreen();
});
