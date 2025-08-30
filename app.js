
// v2.5 Navigation + Pie Charts + Import + OCR + Auto-login
const FIXED_PASSWORD = "test1234";

// ---------- Crypto + DB ----------
const textEncoder=new TextEncoder(), textDecoder=new TextDecoder();
function b64(b){return btoa(String.fromCharCode(...new Uint8Array(b)))}
function ub64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function deriveKey(pwd,salt){
  const km=await crypto.subtle.importKey("raw",textEncoder.encode(pwd),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:200000,hash:"SHA-256"},km,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function encryptJSON(key,obj){const iv=crypto.getRandomValues(new Uint8Array(12));const pt=textEncoder.encode(JSON.stringify(obj));const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,pt);return{iv:b64(iv),ct:b64(ct)}}
async function decryptJSON(key,blob){const iv=ub64(blob.iv);const ct=ub64(blob.ct);const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,ct);return JSON.parse(textDecoder.decode(pt))}

function idb(){return new Promise((res,rej)=>{const r=indexedDB.open("vault-db",9);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains("meta"))db.createObjectStore("meta");if(!db.objectStoreNames.contains("tx"))db.createObjectStore("tx",{keyPath:"id",autoIncrement:true});};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function metaSet(k,v){const db=await idb();const t=db.transaction("meta","readwrite");t.objectStore("meta").put(v,k);return t.complete;}
async function metaGet(k){const db=await idb();const t=db.transaction("meta","readonly");return new Promise(r=>{const q=t.objectStore("meta").get(k);q.onsuccess=()=>r(q.result);q.onerror=()=>r(undefined);});}
async function txAdd(enc){const db=await idb();const t=db.transaction("tx","readwrite");t.objectStore("tx").add(enc);return t.complete;}
async function txPut(id,enc){const db=await idb();const t=db.transaction("tx","readwrite");t.objectStore("tx").put(Object.assign({id},enc));return t.complete;}
async function txAllRaw(){const db=await idb();const t=db.transaction("tx","readonly");return new Promise(r=>{const q=t.objectStore("tx").getAll();q.onsuccess=()=>r(q.result||[]);q.onerror=()=>r([]);});}

let aesKey=null;
async function ensureSalt(){let s=await metaGet("salt"); if(!s){const raw=crypto.getRandomValues(new Uint8Array(16)); s=b64(raw); await metaSet("salt",s);} return ub64(s);}
async function autoLogin(){const salt=await ensureSalt(); aesKey=await deriveKey(FIXED_PASSWORD,salt); const marker=await metaGet("marker"); if(!marker){await metaSet("marker", await encryptJSON(aesKey,{ok:true, createdAt:Date.now()}));}}

// ---------- Helpers ----------
function parseAmount(x){ if(typeof x!=="string") return Number(x||0); const n=x.replace(/\s/g,'').replace(/\./g,'').replace(',', '.'); const v=parseFloat(n); return isNaN(v)?0:v; }
function formatCHF(v){ return (v||0).toFixed(2)+' CHF'; }
function toYMD(date){ const d=new Date(date); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; }
function normalizeDate(s, mode){
  if(mode==="ymd") return s;
  if(mode==="dmy"){const [d,m,y]=s.split(/[.\/-]/); return `20${y.length===2?y:y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;}
  if(/\d{4}-\d{2}-\d{2}/.test(s)) return s;
  if(/\d{2}[.\/-]\d{2}[.\/-]\d{2,4}/.test(s)){
    const [d,m,y]=s.split(/[.\/-]/); const Y = y.length===2?`20${y}`:y; return `${Y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return s;
}
function monthKey(d){ const dt=new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`; }
function currentMonthKey(){ const dt=new Date(); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`; }
function monthLabel(ym){ const [y,m]=ym.split('-'); const names=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']; return `${names[parseInt(m,10)-1]} ${y}`; }

// ---------- Import ----------
function parseCSV(text, delim){
  const lines=text.split(/\r?\n/).filter(l=>l.trim().length);
  if(!lines.length) return [];
  const headers=lines[0].split(delim).map(h=>h.trim());
  return lines.slice(1).map(line=>{
    const cols=line.split(delim); const obj={};
    headers.forEach((h,i)=>obj[h]=cols[i]);
    return obj;
  });
}

function extractFromOCR(raw, mode){
  const lines = raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const out=[];
  for(const line of lines){
    let date=null;
    if(/\d{4}-\d{2}-\d{2}/.test(line)) date=line.match(/\d{4}-\d{2}-\d{2}/)[0];
    else if(/\b\d{2}[.\/-]\d{2}[.\/-]\d{2,4}\b/.test(line)) date=line.match(/\b\d{2}[.\/-]\d{2}[.\/-]\d{2,4}\b/)[0];
    const amt=(line.match(/[-+]?\d{1,3}(?:[\.\s]\d{3})*(?:[\.,]\d{2})/)||[null])[0];
    if(date && amt){
      const desc=line.replace(date,'').replace(amt,'').trim();
      out.push({ date: normalizeDate(date, mode), description: desc, amount: parseAmount(amt) });
    }
  }
  return out;
}

// ---------- Rendering ----------
function showPage(id){
  document.querySelectorAll('main.card').forEach(el=>el.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function aggregateByCategory(rows){
  const map=new Map();
  for(const r of rows){
    const cat=(r.category||'—').trim()||'—';
    map.set(cat, (map.get(cat)||0) + (r.amount||0));
  }
  const items=[...map.entries()].sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
  const total=items.reduce((a,[,v])=>a+v,0);
  return {items,total};
}

function filterByMonth(rows, ym){
  return rows.filter(r=>r.date && monthKey(r.date)===ym);
}

function buildPie(canvasId, legendId, items, onClick){
  const ctx=document.getElementById(canvasId);
  const labels=items.map(([k])=>k);
  const data=items.map(([,v])=>v);
  const colors=labels.map((_,i)=>`hsl(${(i*63)%360} 80% 60%)`);
  if(window._charts && window._charts[canvasId]){ window._charts[canvasId].destroy(); }
  if(!window._charts) window._charts={};
  const chart=new Chart(ctx,{
    type:'pie',
    data:{ labels, datasets:[{ data, backgroundColor:colors }]},
    options:{
      onClick:(e,els)=>{
        if(els.length){ const idx=els[0].index; onClick && onClick(labels[idx]); }
      },
      plugins:{ legend:{ display:false } }
    }
  });
  window._charts[canvasId]=chart;
  // legend
  const total=data.reduce((a,b)=>a+b,0);
  const ul=document.getElementById(legendId); ul.innerHTML='';
  labels.forEach((lab,i)=>{
    const val=data[i]; const pct= total? Math.round(val/total*100):0;
    const li=document.createElement('li');
    li.innerHTML = `<span class="swatch" style="background:${colors[i]}"></span>${lab} – ${formatCHF(val)} (${pct}%)`;
    ul.appendChild(li);
  });
}

function renderTable(tbodyId, rows){
  const tb=document.getElementById(tbodyId);
  tb.innerHTML = rows.map(r=>`<tr><td>${r.date}</td><td>${r.description||''}</td><td class="right">${formatCHF(r.amount)}</td></tr>`).join('') || `<tr><td colspan="3" class="muted">Keine Daten</td></tr>`;
}

// ---------- Data access (decrypt) ----------
async function listTx(){
  const raws=await txAllRaw(); const out=[];
  for(const e of raws){ try{ out.push({ id:e.id, ...(await decryptJSON(aesKey,e)) }); }catch{} }
  return out;
}

// ---------- App flow ----------
async function goMonthOverview(){
  const ym=currentMonthKey();
  const all=await listTx();
  const month=filterByMonth(all, ym);
  const agg=aggregateByCategory(month);
  document.getElementById('month-label').textContent = monthLabel(ym);
  buildPie('month-pie','month-legend',agg.items, (cat)=>{
    document.getElementById('month-cat-name').textContent=cat;
    renderTable('month-details', month.filter(r=>(r.category||'—')===cat));
  });
  document.getElementById('month-cat-name').textContent='—';
  renderTable('month-details', []);
  showPage('page-month');
}

async function goYearOverview(){
  const all=await listTx();
  const dt=new Date(); const y=dt.getFullYear();
  document.getElementById('year-label').textContent = String(y);
  const list=document.getElementById('year-months'); list.innerHTML='';
  for(let m=1;m<=12;m++){
    const ym=`${y}-${String(m).padStart(2,'0')}`;
    const month=filterByMonth(all, ym);
    const sum=month.reduce((a,b)=>a+(b.amount||0),0);
    const a=document.createElement('a'); a.href="#"; a.textContent = `${monthLabel(ym)} – ${formatCHF(sum)}`;
    a.addEventListener('click', e=>{ e.preventDefault(); goMonthDetail(ym); });
    list.appendChild(a);
  }
  showPage('page-year');
}

async function goMonthDetail(ym){
  const all=await listTx();
  const month=filterByMonth(all, ym);
  const agg=aggregateByCategory(month);
  document.getElementById('detail-month-label').textContent = `Monatsdetail – ${monthLabel(ym)}`;
  buildPie('detail-pie','detail-legend',agg.items, (cat)=>{
    document.getElementById('detail-cat-name').textContent=cat;
    renderTable('detail-table', month.filter(r=>(r.category||'—')===cat));
  });
  document.getElementById('detail-cat-name').textContent='—';
  renderTable('detail-table', []);
  showPage('page-month-detail');
}

// ---------- Setup ----------
window.addEventListener('load', async () => {
  if ('serviceWorker' in navigator) { try { await navigator.serviceWorker.register('./sw.js'); } catch {} }
  await autoLogin();
  showPage('page-home');

  // Home menu
  document.getElementById('go-scan').onclick = ()=>showPage('page-scan');
  document.getElementById('go-month').onclick = ()=>goMonthOverview();
  document.getElementById('go-year').onclick = ()=>goYearOverview();
  // back buttons
  document.querySelectorAll('[data-back]').forEach(btn=>btn.onclick=()=>showPage('page-home'));

  // CSV import
  document.getElementById('btn-import').onclick = async () => {
    const f=document.getElementById('csv-file').files[0];
    if(!f) return alert('Bitte CSV wählen.');
    const delim=document.getElementById('csv-delim').value||',';
    const dc=document.getElementById('csv-date').value||'date';
    const xc=document.getElementById('csv-desc').value||'description';
    const ac=document.getElementById('csv-amount').value||'amount';
    const kc=document.getElementById('csv-cat').value||'';
    const text=await f.text();
    const rows=parseCSV(text,delim);
    for(const r of rows){
      const enc=await encryptJSON(aesKey,{ date:r[dc]||'', description:r[xc]||'', amount:parseAmount(r[ac]||'0'), category: kc? (r[kc]||'') : '' });
      await txAdd(enc);
    }
    // After import -> go to month overview
    await goMonthOverview();
  };

  // OCR import
  function log(msg){ const el=document.getElementById('ocr-log'); el.style.display='block'; el.textContent += (el.textContent?'\n':'') + msg; el.scrollTop=el.scrollHeight; }
  document.getElementById('btn-ocr').onclick = async () => {
    const f=document.getElementById('img-file').files[0];
    const lang=document.getElementById('ocr-lang').value||'deu+eng';
    const mode=document.getElementById('ocr-datefmt').value||'auto';
    if(!f) return alert('Bitte Bild wählen.');
    if(!window.Tesseract){ log('❌ OCR nicht verfügbar (Internet erforderlich beim ersten Mal).'); return; }
    try{
      log('⏳ OCR startet…');
      const worker=await Tesseract.createWorker(lang, 1, { logger:m=>m.status && log('Tesseract: '+m.status) });
      const res=await worker.recognize(await f.arrayBuffer());
      await worker.terminate();
      log('✅ OCR beendet.');
      const raw=(res && res.data && res.data.text) ? res.data.text : '';
      const rows=extractFromOCR(raw, mode);
      const tb=document.getElementById('ocr-body');
      tb.innerHTML = rows.map(r=>`<tr><td>${r.date}</td><td>${r.description}</td><td class="right">${formatCHF(r.amount)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Keine Daten erkannt</td></tr>';
      if(rows.length){
        document.getElementById('btn-ocr-import').classList.remove('hidden');
        document.getElementById('btn-ocr-import').onclick = async () => {
          for(const r of rows){ const enc=await encryptJSON(aesKey,{date:r.date, description:r.description, amount:r.amount, category:''}); await txAdd(enc); }
          // After import -> go to month overview
          await goMonthOverview();
        };
      }
    }catch(err){ log('❌ Fehler: '+(err?.message||err)); }
  };
});
