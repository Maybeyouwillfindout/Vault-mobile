
// v2.6.3 – improved Swiss OCR parser (stitching + robust amount detection)
const FIXED_PASSWORD="test1234";

// --- crypto + idb (same as 2.6.2) ---
const enc=new TextEncoder(),dec=new TextDecoder();
function b64(b){return btoa(String.fromCharCode(...new Uint8Array(b)))}
function ub64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function keyFrom(pwd,salt){const km=await crypto.subtle.importKey("raw",enc.encode(pwd),"PBKDF2",false,["deriveKey"]);return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:200000,hash:"SHA-256"},km,{name:"AES-GCM",length:256},false,["encrypt","decrypt"])}
async function encJSON(k,o){const iv=crypto.getRandomValues(new Uint8Array(12));const pt=enc.encode(JSON.stringify(o));const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},k,pt);return{iv:b64(iv),ct:b64(ct)}}
async function decJSON(k,b){const iv=ub64(b.iv),ct=ub64(b.ct);const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv},k,ct);return JSON.parse(dec.decode(pt))}
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open("vault-db",14);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains("meta"))db.createObjectStore("meta");if(!db.objectStoreNames.contains("tx"))db.createObjectStore("tx",{keyPath:"id",autoIncrement:true});if(!db.objectStoreNames.contains("dups"))db.createObjectStore("dups",{keyPath:"hash"});};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
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
async function hashRec(r){const base=`${r.date}|${(r.amount||0).toFixed(2)}|${norm(r.description)}`;const dig=await crypto.subtle.digest('SHA-256',enc.encode(base));return b64(dig)}

// --- categories ---
function categorize(r){
  const d=norm(r.description); const amt=r.amount||0;
  const has=(...k)=>k.some(x=>d.includes(x));
  if(has('coop','migros','denner','aldi','lidl')) return 'Lebensmittel';
  if(has('sbb','vbz','zvv','postauto','tl ')) return 'ÖV';
  if(has('kfc','mcdonald','burger king','subway','cafe','café','restaurant','take away','kebab')) return 'Gastronomie';
  if(has('shell','avia','bp','esso','agrola','tamoil','eni','tank')) return amt>25 ? 'Transport' : 'Lebensmittel';
  if(has('galaxus','digitec','amazon','aliexpress','microspot','brack')) return 'Elektronik/Online';
  if(has('apotheke','pharma','drogerie')) return 'Gesundheit';
  if(has('versicherung','axa','mobiliar','generali')) return 'Versicherung';
  return 'Sonstiges';
}

// --- Swiss OCR parsing (improved) ---
function joinLines(raw){
  const lines=raw.split(/\r?\n/).map(l=>l.replace(/[•··]/g,' ').replace(/\s{2,}/g,' ').trim());
  const out=[]; let cur=null;
  const dateRe=/^\d{2}\.\d{2}(?!\.)/; // beginnt mit DD.MM (ohne Jahr)
  for(const ln of lines){
    if(!ln) continue;
    if(dateRe.test(ln)){ if(cur) out.push(cur); cur=ln; }
    else if(cur){ cur += ' ' + ln; }
  }
  if(cur) out.push(cur);
  return out;
}

// amount detection: choose penultimate numeric token (exclude dates/times)
function pickAmountAndYear(stitched){
  const numRe=/[-+]?\d{1,3}(?:[\'\s\.]\d{3})*(?:[\.,]\d{2})/g;
  const dateYYRe=/(\d{2}\.\d{2}\.\d{2})(?!\d)/g;
  const timeRe=/\b\d{2}[:\.]\d{2}\b/g;
  const firstDM=(stitched.match(/\b\d{2}\.\d{2}\b/)||[])[0];
  const yyMatch=Array.from(stitched.matchAll(dateYYRe)).pop(); // last dd.mm.yy
  const yy = yyMatch ? yyMatch[1].split('.')[2] : String(new Date().getFullYear()).slice(-2);
  // collect numeric tokens excluding time and the dd.mm itself
  const tokens = (stitched.match(numRe)||[]).filter(t=>{
    if(firstDM && t.replace(',','.')===firstDM.replace(',','.')) return False;
    if(timeRe.test(t)) return False;
    return True;
  });
  if(tokens.length<1) return null;
  const amountToken = tokens.length>=2 ? tokens[tokens.length-2] : tokens[tokens.length-1];
  return { amount: parseAmt(amountToken), year2: yy };
}

function parseStitched(line){
  const firstDM=(line.match(/\b\d{2}\.\d{2}\b/)||[])[0];
  if(!firstDM) return null;
  const pick=pickAmountAndYear(line);
  if(!pick) return null;
  const [d,m]=firstDM.split('.'); const Y = pick.year2.length===2?`20${pick.year2}`:pick.year2;
  const date=`${Y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  // description: everything between first date and before the right-side numbers & valuta date
  const desc=line.replace(/^\d{2}\.\d{2}\s*/,'')
                 .replace(/\s\d{2}\.\d{2}\.\d{2}\b.*$/,'')  // drop valuta+saldo tail if present
                 .trim();
  return {date, description: desc, amount: pick.amount};
}

function extractFromOCR(raw){
  const stitched=joinLines(raw);
  const out=[];
  for(const ln of stitched){
    const rec=parseStitched(ln);
    if(rec) out.push(rec);
  }
  if(!out.length){
    // fallback: previous simple strategy
    const lines=raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    for(const l of lines){
      const m=parseStitched(l); if(m) out.push(m);
    }
  }
  return out;
}

// --- chart + ui (minimal) ---
function aggregate(rows){const m=new Map();for(const r of rows){const k=(r.category||'—')||'—';m.set(k,(m.get(k)||0)+(r.amount||0))}return[...m.entries()].sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))}
function buildPie(canvasId,legendId,items,onClick){
  const ctx=document.getElementById(canvasId);
  const labels=items.map(i=>i[0]), data=items.map(i=>i[1]);
  const colors=labels.map((_,i)=>`hsl(${(i*63)%360} 80% 60%)`);
  if(window._c&&window._c[canvasId]) window._c[canvasId].destroy();
  window._c||(window._c={});
  window._c[canvasId]=new Chart(ctx,{type:'pie',data:{labels,datasets:[{data,backgroundColor:colors}]},
    options:{plugins:{legend:{display:false}},onClick:(e,els)=>{if(els.length)onClick(labels[els[0].index]);}}});
  const total=data.reduce((a,b)=>a+b,0); const ul=document.getElementById(legendId); ul.innerHTML='';
  labels.forEach((l,i)=>{const v=data[i],p=total?Math.round(v/total*100):0;const li=document.createElement('li');li.innerHTML=`<span class="swatch" style="background:${colors[i]}"></span>${l} – ${v.toFixed(2)} CHF (${p}%)`;ul.appendChild(li)});
}
function renderTable(id,rows){document.getElementById(id).innerHTML=rows.map(r=>`<tr><td>${r.date}</td><td>${r.description}</td><td class="right">${(r.amount||0).toFixed(2)} CHF</td></tr>`).join('')||`<tr><td colspan="3" class="muted">Keine Daten</td></tr>`}

function filterMonth(rows,ym){return rows.filter(r=>r.date && r.date.startsWith(ym))}
function curYM(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}

// --- renderers ---
async function showMonth(preferLast=true){
  const raws=await txAll(); const decd=[]; for(const e of raws){try{decd.push(await decJSON(aesKey,e))}catch{}}
  let ym=curYM();
  if(preferLast){const li=await metaGet('lastImport'); if(li?.ym) ym=li.ym;}
  let rows=filterMonth(decd,ym);
  if(!rows.length && decd.length){const months=[...new Set(decd.map(r=>r.date.slice(0,7)))].sort(); ym=months.pop(); rows=filterMonth(decd,ym);}
  let html=`<div id="importBanner" class="info hidden"></div>
  <canvas id="pie" width="380" height="380"></canvas><ul id="legend" class="legend"></ul>
  <h3>Details: <span id="catName">—</span></h3>
  <table class="table"><thead><tr><th>Datum</th><th>Beschreibung</th><th class="right">Betrag</th></tr></thead><tbody id="details"></tbody></table>`;
  document.getElementById('screen').innerHTML=`<h2>Monatsübersicht ${monthLabel(ym)}</h2>`+html;

  // banner
  const meta=await metaGet('lastImport'); const rowsPrev=await metaGet('lastImportRows')||[];
  const banner=document.getElementById('importBanner');
  if(meta?.ym===ym && rowsPrev.length){ banner.classList.remove('hidden'); banner.innerHTML=`<strong>Zuletzt importiert:</strong> ${meta.count} Buchung(en) in ${monthLabel(ym)} (vor ${Math.max(1,Math.round((Date.now()-meta.ts)/60000))} Min)
  <details style="margin-top:6px"><summary>Zeige importierte Zeilen</summary>
  <table class="table" style="margin-top:6px"><thead><tr><th>Datum</th><th>Beschreibung</th><th class="right">Betrag</th></tr></thead><tbody>${
    rowsPrev.filter(r=>r.date?.startsWith(ym)).map(r=>`<tr><td>${r.date}</td><td>${r.description}</td><td class="right">${(r.amount||0).toFixed(2)} CHF</td></tr>`).join('')||'<tr><td colspan="3" class="muted">Keine Zeilen</td></tr>'
  }</tbody></table></details>`; }

  const items=aggregate(rows);
  buildPie('pie','legend',items,(cat)=>{
    document.getElementById('catName').textContent=cat; renderTable('details',rows.filter(r=>(r.category||'—')===cat));
  });
  if(items.length){const first=items[0][0]; document.getElementById('catName').textContent=first; renderTable('details',rows.filter(r=>(r.category||'—')===first));}
}

async function showYear(){
  const raws=await txAll(); const decd=[]; for(const e of raws){try{decd.push(await decJSON(aesKey,e))}catch{}}
  const y=(new Date()).getFullYear();
  const list=[...new Set(decd.filter(r=>r.date.startsWith(String(y))).map(r=>r.date.slice(0,7)))].sort();
  document.getElementById('screen').innerHTML=`<h2>Jahresübersicht ${y}</h2><div id="months"></div>`;
  const c=document.getElementById('months');
  list.forEach(ym=>{const sum=filterMonth(decd,ym).reduce((a,b)=>a+(b.amount||0),0);
    const a=document.createElement('a'); a.href='#'; a.textContent=`${monthLabel(ym)} – ${sum.toFixed(2)} CHF`; a.onclick=(e)=>{e.preventDefault(); showMonth(false)}; c.appendChild(a);
  })
}

function scanScreen(){
  document.getElementById('screen').innerHTML=`<h2>OCR Import</h2>
  <input type="file" id="file" accept="image/*"><button id="go">Screenshot lesen & importieren</button>
  <pre id="log" class="log" style="display:none"></pre>
  <table class="table"><thead><tr><th>Datum</th><th>Beschreibung</th><th class="right">Betrag</th></tr></thead><tbody id="prev"></tbody></table>`;
  const log=(m)=>{const el=document.getElementById('log'); el.style.display='block'; el.textContent+=(el.textContent?'\n':'')+m; el.scrollTop=el.scrollHeight;}
  document.getElementById('go').onclick=async()=>{
    const f=document.getElementById('file').files[0]; if(!f) return alert('Bitte Bild wählen.');
    if(!window.Tesseract) return alert('OCR Engine benötigt Internet beim ersten Mal.');
    try{
      log('⏳ OCR startet…'); const w=await Tesseract.createWorker('deu+eng',1,{logger:m=>m.status&&log('Tesseract: '+m.status)});
      const res=await w.recognize(await f.arrayBuffer()); await w.terminate(); log('✅ OCR beendet.');
      const rows=extractFromOCR(res?.data?.text||''); rows.forEach(r=>r.category=categorize(r));
      document.getElementById('prev').innerHTML=rows.map(r=>`<tr><td>${r.date}</td><td>${r.description}</td><td class="right">${r.amount.toFixed(2)} CHF</td></tr>`).join('')||'<tr><td colspan="3" class="muted">Keine Daten</td></tr>';
      // save with dedupe
      let imported=0; for(const r of rows){const h=await hashRec(r); if(await dupHas(h)) continue; await txAdd(await encJSON(aesKey,r)); await dupAdd(h); imported++;}
      if(imported){const ym=rows.find(r=>r.date)?.date?.slice(0,7)||curYM(); await metaSet('lastImport',{ym,ts:Date.now(),count:rows.length}); await metaSet('lastImportRows',rows.slice(-50)); await showMonth(true);}
    }catch(e){log('❌ Fehler: '+(e?.message||e));}
  };
}

// bootstrap
window.addEventListener('load', async ()=>{
  if('serviceWorker' in navigator){try{await navigator.serviceWorker.register('./sw.js?v=2630')}catch{}}
  await autoLogin();
  document.getElementById('btn-scan').onclick=scanScreen;
  document.getElementById('btn-month').onclick=()=>showMonth(true);
  document.getElementById('btn-year').onclick=showYear;
  // Start direkt mit Scan
  scanScreen();
});
