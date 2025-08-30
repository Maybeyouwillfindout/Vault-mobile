
// v2.6.2 – end-to-end OCR -> categorize -> dedupe -> encrypt store -> month view
const FIXED_PASSWORD="test1234";

// ---- Crypto & DB ----
const textEncoder=new TextEncoder(),textDecoder=new TextDecoder();
function b64(b){return btoa(String.fromCharCode(...new Uint8Array(b)))}
function ub64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function deriveKey(pwd,salt){const km=await crypto.subtle.importKey("raw",textEncoder.encode(pwd),"PBKDF2",false,["deriveKey"]);return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:200000,hash:"SHA-256"},km,{name:"AES-GCM",length:256},false,["encrypt","decrypt"])}
async function encryptJSON(key,obj){const iv=crypto.getRandomValues(new Uint8Array(12));const pt=textEncoder.encode(JSON.stringify(obj));const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,pt);return{iv:b64(iv),ct:b64(ct)}}
async function decryptJSON(key,blob){const iv=ub64(blob.iv);const ct=ub64(blob.ct);const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,ct);return JSON.parse(textDecoder.decode(pt))}
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open("vault-db",13);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains("meta"))db.createObjectStore("meta");if(!db.objectStoreNames.contains("tx"))db.createObjectStore("tx",{keyPath:"id",autoIncrement:true});if(!db.objectStoreNames.contains("dups"))db.createObjectStore("dups",{keyPath:"hash"});};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function metaSet(k,v){const db=await idb();const t=db.transaction("meta","readwrite");t.objectStore("meta").put(v,k);return new Promise(r=>t.oncomplete=r)}
async function metaGet(k){const db=await idb();const t=db.transaction("meta","readonly");return new Promise(r=>{const q=t.objectStore("meta").get(k);q.onsuccess=()=>r(q.result);q.onerror=()=>r(undefined)})}
async function dupsHas(hash){const db=await idb();const t=db.transaction("dups","readonly");return new Promise(r=>{const q=t.objectStore("dups").get(hash);q.onsuccess=()=>r(!!q.result);q.onerror=()=>r(false)})}
async function dupsAdd(hash){const db=await idb();const t=db.transaction("dups","readwrite");t.objectStore("dups").put({hash});return new Promise(r=>t.oncomplete=r)}
async function txAdd(enc){const db=await idb();const t=db.transaction("tx","readwrite");t.objectStore("tx").add(enc);return new Promise(r=>t.oncomplete=r)}
async function txAllRaw(){const db=await idb();const t=db.transaction("tx","readonly");return new Promise(r=>{const q=t.objectStore("tx").getAll();q.onsuccess=()=>r(q.result||[]);q.onerror=()=>r([])})}

let aesKey=null;
async function ensureSalt(){let s=await metaGet("salt");if(!s){const raw=crypto.getRandomValues(new Uint8Array(16));s=b64(raw);await metaSet("salt",s)}return ub64(s)}
async function autoLogin(){const salt=await ensureSalt();aesKey=await deriveKey(FIXED_PASSWORD,salt);const marker=await metaGet("marker");if(!marker){await metaSet("marker",await encryptJSON(aesKey,{ok:true,createdAt:Date.now()}))}}

// ---- Helpers ----
function parseAmount(x){
  if(x==null) return 0;
  let s=String(x).trim().replace(/\u00A0/g,'').replace(/'/g,'');
  const hasComma=s.includes(','), hasDot=s.includes('.');
  if(hasComma && hasDot){ s=s.replace(/\./g,'').replace(',', '.'); }
  else if(hasComma){ s=s.replace(',', '.'); }
  else if(!hasComma && hasDot){
    const parts=s.split('.');
    if(parts.length>2){ const last=parts.pop(); s=parts.join('')+'.'+last; }
  }
  const v=parseFloat(s); return isNaN(v)?0:v;
}
function monthKey(d){const dt=new Date(d);return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`}
function currentMonthKey(){const dt=new Date();return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`}
function monthLabel(ym){const [y,m]=ym.split('-');const names=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];return `${names[parseInt(m,10)-1]} ${y}`}
function normalizeDesc(s){return String(s||'').toLowerCase().replace(/\s+/g,' ').trim()}
async function hashRecord(rec){const base=`${rec.date}|${(rec.amount||0).toFixed(2)}|${normalizeDesc(rec.description)}`;const buf=textEncoder.encode(base);const dig=await crypto.subtle.digest('SHA-256',buf);return b64(dig)}

// ---- Categories (heuristics) ----
function categorize(rec){
  const d=normalizeDesc(rec.description);
  const amt=rec.amount||0;
  const has=(...k)=>k.some(x=>d.includes(x));
  if(has('coop','migros','denner','aldi','lidl')) return 'Lebensmittel';
  if(has('sbb','vbz','zvv','postauto','tl ')) return 'ÖV';
  if(has('kfc','mcdonald','burger king','subway','cafe','café','restaurant','take away','kebab')) return 'Gastronomie';
  if(has('galaxus','digitec','amazon','aliexpress','microspot','brack')) return 'Elektronik/Online';
  if(has('apotheke','pharma','drogerie')) return 'Gesundheit';
  if(has('rent','miete')) return 'Miete';
  if(has('versicherung','axa','mobiliar','generali')) return 'Versicherung';
  if(has('shell','avia','bp','esso','agrola','tamoil','eni','tank')) return amt>25 ? 'Transport' : 'Lebensmittel';
  return 'Sonstiges';
}

// ---- Swiss OCR Parser ----
function ddmmWithY(ddmm,yy){const[d,m]=ddmm.split('.');const Y=yy.length===2?`20${yy}`:yy;return `${Y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;}
function extractSwissTable(line){
  // DD.MM  DESC  AMOUNT  DD.MM.YY  BALANCE
  const re=/(\d{2}\.\d{2})\s+(.+?)\s+([-+]?\d{1,3}(?:[\.\s]\d{3})*(?:[\.,]\d{2}))\s+(\d{2}\.\d{2}\.\d{2})\s+([-+]?\d{1,3}(?:[\.\s]\d{3})*(?:[\.,]\d{2}))/;
  const m=line.match(re);
  if(!m) return null;
  const [_, ddmm, desc, amt, dmy, _saldo]=m;
  const yy = dmy.split('.')[2];
  return { date: ddmmWithY(ddmm, yy), description: desc.trim(), amount: parseAmount(amt) };
}
function extractGeneric(raw){
  const lines=raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const out=[];
  for(const line of lines){
    const date=(line.match(/\d{2}\.\d{2}\.\d{2,4}|\d{4}-\d{2}-\d{2}/)||[])[0];
    const amt=(line.match(/[-+]?\d{1,3}(?:[\.\s]\d{3})*(?:[\.,]\d{2})/)||[])[0];
    if(date && amt){
      let ymd=date;
      if(/\d{2}\.\d{2}\.\d{2}/.test(date)){const[d,m,y]=date.split('.');ymd=`20${y}-${m}-${d}`;}
      const desc=line.replace(date,'').replace(amt,'').trim();
      out.push({date:ymd,description:desc,amount:parseAmount(amt)});
    }
  }
  return out;
}
function extractFromOCR(raw){
  const lines=raw.split(/\r?\n/).map(l=>l.replace(/\s{2,}/g,' ').trim()).filter(Boolean);
  const out=[];
  for(const line of lines){ const s=extractSwissTable(line); if(s) out.push(s); }
  if(!out.length) return extractGeneric(raw);
  return out;
}

// ---- Charts & UI ----
function showPage(id){document.querySelectorAll('main.card').forEach(el=>el.classList.add('hidden'));document.getElementById(id).classList.remove('hidden')}
function aggregateByCategory(rows){const map=new Map();for(const r of rows){const cat=(r.category||'—').trim()||'—';map.set(cat,(map.get(cat)||0)+(r.amount||0))}const items=[...map.entries()].sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));return{items}}
function filterByMonth(rows,ym){return rows.filter(r=>r.date && monthKey(r.date)===ym)}
function buildPie(canvasId,legendId,items,onClick){
  const ctx=document.getElementById(canvasId);
  const labels=items.map(([k])=>k);
  const data=items.map(([,v])=>v);
  const colors=labels.map((_,i)=>`hsl(${(i*63)%360} 80% 60%)`);
  if(window._charts&&window._charts[canvasId])window._charts[canvasId].destroy();
  window._charts||(window._charts={});
  const chart=new Chart(ctx,{type:'pie',data:{labels,datasets:[{data,backgroundColor:colors}]},
    options:{onClick:(e,els)=>{if(els.length){const idx=els[0].index;onClick&&onClick(labels[idx]);}},plugins:{legend:{display:false}}}});
  window._charts[canvasId]=chart;
  const total=data.reduce((a,b)=>a+b,0);
  const ul=document.getElementById(legendId); ul.innerHTML='';
  labels.forEach((lab,i)=>{
    const val=data[i]; const pct= total? Math.round(val/total*100):0;
    const li=document.createElement('li');
    li.innerHTML=`<span class="swatch" style="background:${colors[i]}"></span>${lab} – ${(val||0).toFixed(2)} CHF (${pct}%)`;
    ul.appendChild(li);
  });
}
function renderTable(tbodyId,rows){
  const tb=document.getElementById(tbodyId);
  tb.innerHTML=rows.map(r=>`<tr><td>${r.date}</td><td>${r.description||''}</td><td class="right">${(r.amount||0).toFixed(2)} CHF</td></tr>`).join('')||`<tr><td colspan="3" class="muted">Keine Daten</td></tr>`;
}

// ---- Data access ----
async function txAllDecrypted(){const raws=await txAllRaw();const out=[];for(const e of raws){try{out.push({id:e.id,...(await decryptJSON(aesKey,e))})}catch{}}return out}

// ---- Last-Import meta ----
async function setLastImport(ym, rows){
  try{
    await metaSet('lastImport', { ym, ts: Date.now(), count: rows.length });
    await metaSet('lastImportRows', rows.slice(-50));
  }catch{}
}
async function getLastImport(){
  const meta=await metaGet('lastImport');
  const rows=await metaGet('lastImportRows')||[];
  return { meta, rows };
}

// ---- Navigation ----
async function goMonthOverview(preferLastImport=true){
  const all=await txAllDecrypted();

  let ym=currentMonthKey();
  if(preferLastImport){
    const {meta}=await getLastImport();
    if(meta?.ym) ym=meta.ym;
  }
  let month=filterByMonth(all,ym);
  if(month.length===0 && all.length>0){
    const months=[...new Set(all.filter(r=>r.date).map(r=>r.date.slice(0,7)))].sort();
    ym=months[months.length-1];
    month=filterByMonth(all,ym);
  }

  // Banner
  const banner=document.getElementById('import-banner');
  const bannerText=document.getElementById('import-banner-text');
  const previewBody=document.getElementById('import-preview');
  const {meta,rows}=await getLastImport();
  if(meta?.ym===ym && rows.length){
    banner.classList.remove('hidden');
    const mins=Math.max(1,Math.round((Date.now()-meta.ts)/60000));
    bannerText.textContent=`${meta.count} Buchung(en) in ${monthLabel(ym)} (vor ${mins} Min)`;
    previewBody.innerHTML=rows.filter(r=>r.date?.startsWith(ym))
      .map(r=>`<tr><td>${r.date}</td><td>${r.description||''}</td><td class="right">${(r.amount||0).toFixed(2)} CHF</td></tr>`).join('')
      || `<tr><td colspan="3" class="muted">Keine Zeilen für diesen Monat</td></tr>`;
  }else{
    banner.classList.add('hidden');
    previewBody.innerHTML='';
  }

  const agg=aggregateByCategory(month);
  document.getElementById('month-label').textContent=monthLabel(ym);
  buildPie('month-pie','month-legend',agg.items,(cat)=>{
    document.getElementById('month-cat-name').textContent=cat;
    renderTable('month-details',month.filter(r=>(r.category||'—')===cat));
  });
  if(agg.items.length){
    const firstCat=agg.items[0][0];
    document.getElementById('month-cat-name').textContent=firstCat;
    renderTable('month-details',month.filter(r=>(r.category||'—')===firstCat));
  }else{
    document.getElementById('month-cat-name').textContent='—';
    renderTable('month-details',[]);
  }

  showPage('page-month');
}

async function goYearOverview(){
  const all=await txAllDecrypted();
  const y=(new Date()).getFullYear();
  document.getElementById('year-label').textContent=String(y);
  const list=document.getElementById('year-months'); list.innerHTML='';
  for(let m=1;m<=12;m++){
    const ym=`${y}-${String(m).padStart(2,'0')}`;
    const month=filterByMonth(all,ym);
    const sum=month.reduce((a,b)=>a+(b.amount||0),0);
    const a=document.createElement('a'); a.href='#'; a.textContent=`${monthLabel(ym)} – ${(sum||0).toFixed(2)} CHF`;
    a.addEventListener('click', e=>{e.preventDefault(); goMonthDetail(ym);});
    list.appendChild(a);
  }
  showPage('page-year');
}

async function goMonthDetail(ym){
  const all=await txAllDecrypted();
  const month=filterByMonth(all,ym);
  const agg=aggregateByCategory(month);
  document.getElementById('detail-month-label').textContent=`Monatsdetail – ${monthLabel(ym)}`;
  buildPie('detail-pie','detail-legend',agg.items,(cat)=>{
    document.getElementById('detail-cat-name').textContent=cat;
    renderTable('detail-table',month.filter(r=>(r.category||'—')===cat));
  });
  if(agg.items.length){
    const firstCat=agg.items[0][0];
    document.getElementById('detail-cat-name').textContent=firstCat;
    renderTable('detail-table',month.filter(r=>(r.category||'—')===firstCat));
  }else{
    document.getElementById('detail-cat-name').textContent='—';
    renderTable('detail-table',[]);
  }
  showPage('page-month-detail');
}

// ---- Setup & OCR import ----
window.addEventListener('load',async()=>{
  if('serviceWorker' in navigator){try{await navigator.serviceWorker.register('./sw.js?v=2620')}catch{}}
  await autoLogin();
  showPage('page-home');

  document.getElementById('go-scan').onclick=()=>showPage('page-scan');
  document.getElementById('go-month').onclick=()=>goMonthOverview(true);
  document.getElementById('go-year').onclick=()=>goYearOverview();
  document.querySelectorAll('[data-back]').forEach(btn=>btn.onclick=()=>showPage('page-home'));

  function log(msg){const el=document.getElementById('ocr-log');el.style.display='block';el.textContent+=(el.textContent?'\n':'')+msg;el.scrollTop=el.scrollHeight;}
  document.getElementById('btn-ocr-import').onclick=async()=>{
    const f=document.getElementById('img-file').files[0]; if(!f) return alert('Bitte Bild wählen.');
    if(!window.Tesseract){return alert('OCR-Engine nicht verfügbar. Internet beim ersten Mal nötig.');}
    try{
      log('⏳ OCR startet…');
      const worker=await Tesseract.createWorker('deu+eng',1,{logger:m=>m.status&&log('Tesseract: '+m.status)});
      const res=await worker.recognize(await f.arrayBuffer()); await worker.terminate();
      log('✅ OCR beendet.');
      const raw=res?.data?.text || '';
      const rows=[];
      for(const line of raw.split(/\r?\n/).map(l=>l.replace(/\s{2,}/g,' ').trim()).filter(Boolean)){
        const s=extractSwissTable(line); if(s) rows.push(s);
      }
      if(!rows.length) rows.push(...extractGeneric(raw));

      // Kategorisieren & Vorschau
      rows.forEach(r=>r.category=categorize(r));
      const pv=document.getElementById('ocr-preview');
      pv.innerHTML=rows.map(r=>`<tr><td>${r.date}</td><td>${r.description}</td><td>${r.category}</td><td class="right">${(r.amount||0).toFixed(2)} CHF</td></tr>`).join('') || '<tr><td colspan="4">Keine Daten erkannt</td></tr>';

      // Speichern: Dedupe + Verschlüsselung
      let imported=0;
      for(const r of rows){
        const h=await hashRecord(r);
        if(await dupsHas(h)) continue;
        const enc=await encryptJSON(aesKey,{date:r.date,description:r.description,amount:r.amount,category:r.category});
        await txAdd(enc); await dupsAdd(h);
        imported++;
      }
      log('💾 Import abgeschlossen: '+imported+' neue Buchung(en).');
      if(imported){
        const ym=rows.find(r=>r.date)?.date?.slice(0,7) || currentMonthKey();
        await setLastImport(ym, rows);
        await goMonthOverview(true);
      }
    }catch(err){log('❌ Fehler: '+(err?.message||err));}
  };
});
