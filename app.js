
// v2.7.3 — robust imports + OCR + expenses-only toggle + yearly bars
const FIXED_PASSWORD="test1234";

// --- crypto + idb ---
const enc=new TextEncoder(),dec=new TextDecoder();
function b64(b){return btoa(String.fromCharCode(...new Uint8Array(b)))}
function ub64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function keyFrom(pwd,salt){const km=await crypto.subtle.importKey("raw",enc.encode(pwd),"PBKDF2",false,["deriveKey"]);return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:200000,hash:"SHA-256"},km,{name:"AES-GCM",length:256},false,["encrypt","decrypt"])}
async function encJSON(k,o){const iv=crypto.getRandomValues(new Uint8Array(12));const pt=enc.encode(JSON.stringify(o));const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},k,pt);return{iv:b64(iv),ct:b64(ct)}}
async function decJSON(k,b){const iv=ub64(b.iv),ct=ub64(b.ct);const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv},k,ct);return JSON.parse(dec.decode(pt))}
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open("vault-db",23);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains("meta"))db.createObjectStore("meta");if(!db.objectStoreNames.contains("tx"))db.createObjectStore("tx",{keyPath:"id",autoIncrement:true});if(!db.objectStoreNames.contains("dups"))db.createObjectStore("dups",{keyPath:"hash"});};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
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
function parseAmtRaw(s){
  if(s==null) return 0;
  s=String(s).trim();
  // handle trailing minus (e.g., 7.35-)
  const trailingMinus=/^-?\s*[A-Za-z]{0,3}\s*[\d'\.,]+-\s*$/.test(s);
  s=s.replace(/[A-Za-z\sCHF€$£]/g,''); // drop currency letters/symbols/spaces
  s=s.replace(/\u00A0/g,'').replace(/'/g,'');
  // replace german decimal
  const hasC=s.includes(','), hasD=s.includes('.');
  if(hasC&&hasD){ s=s.replace(/\./g,'').replace(',', '.'); }
  else if(hasC){ s=s.replace(',', '.'); }
  else if(!hasC&&hasD){ const parts=s.split('.'); if(parts.length>2){ const last=parts.pop(); s=parts.join('')+'.'+last; } }
  let v=parseFloat(s); if(trailingMinus) v=-Math.abs(v);
  return isNaN(v)?0:v;
}
function parseAmt(x){ return parseAmtRaw(x); }
function norm(s){return String(s||'').toLowerCase().replace(/\s+/g,' ').trim()}
async function hashRec(r){const base=`${r.date}|${(r.amount||0).toFixed(2)}|${norm(r.description)}`;const dig=await crypto.subtle.digest('SHA-256',enc.encode(base));return b64(dig)}
function monthLabel(ym){const [y,m]=ym.split('-');const n=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];return `${n[parseInt(m)-1]} ${y}`}
function filterMonth(rows,ym){return rows.filter(r=>r.date && r.date.startsWith(ym))}
function curYM(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
function toYearFromYY(yy){const y=parseInt(yy,10);return y>=70?`19${yy}`:`20${yy}`}
function toISODate(s){s=String(s).trim();let m=s.match(/^(\d{2})\.(\d{2})\.(\d{2,4})$/);if(m){const d=m[1],mo=m[2],y=m[3].length===2?toYearFromYY(m[3]):m[3];return `${y}-${mo}-${d}`;} if(/\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10); return s;}

// colors & categories
const CATEGORY_COLORS={
  'Lebensmittel':'#34c759','Gastronomie':'#ff9500','Transport':'#5856d6','ÖV':'#5ac8fa',
  'Elektronik/Online':'#ff2d55','Gesundheit':'#ffcc00','Versicherung':'#8e8e93','Gutschrift':'#00c7be','Sonstiges':'#ff3b30'
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

// --- Parsers ---
// CSV: detect columns; support debit/credit columns; avoid 'value date' confusion
function parseCSV(text){
  const res = Papa.parse(text, {header:true, skipEmptyLines:true, dynamicTyping:false});
  const rows=[]; const headers=(res.meta.fields||[]).map(h=>h.toLowerCase());
  const get = (row, name)=> {
    const idx=headers.indexOf(name); return idx>=0 ? row[res.meta.fields[idx]] : undefined;
  };
  const findCol = (cands)=> headers.find(h=>cands.some(n=>h.includes(n)));
  const dateCol=findCol(['datum','buchung','buchungsdatum','date','valuta','wertstellung']);
  const descCol=findCol(['beschreibung','verwendung','text','empfänger','auftraggeber','recipient','purpose']);
  let amtCol=findCol(['betrag','amount','umsatz','chf','eur','soll/haben']);
  const debitCol=findCol(['soll','debit','lastschrift','belastung']);
  const creditCol=findCol(['haben','credit','gutschrift','einzahlung']);
  for(const r of res.data){
    const dateVal=(r[res.meta.fields[headers.indexOf(dateCol)]]||'').toString();
    const desc=(r[res.meta.fields[headers.indexOf(descCol)]]||r[res.meta.fields[0]]||'').toString();
    let amt=0;
    if(debitCol || creditCol){
      const dval=get(r,debitCol||'')||''; const cval=get(r,creditCol||'')||'';
      const d=parseAmtRaw(dval); const c=parseAmtRaw(cval);
      amt = d ? -Math.abs(d) : Math.abs(c);
    }else{
      const aval=(r[res.meta.fields[headers.indexOf(amtCol)]]||'').toString();
      amt = parseAmtRaw(aval);
      // some CSV put negatives in parentheses
      if(/\(.*\)/.test(aval)) amt = -Math.abs(amt);
    }
    if(!dateVal || !desc || !amt) continue;
    rows.push({date:toISODate(dateVal), description:desc.trim(), amount:amt});
  }
  return rows;
}
// MT940
function parseMT940(text){
  const lines=text.split(/\r?\n/); const rows=[]; let cur=null;
  for(const ln of lines){
    if(ln.startsWith(':61:')){
      const m=ln.match(/^:61:(\d{6})([CD])\d*([\d,\.]+).*$/);
      if(m){ const d=m[1]; const sign=(m[2]==='D'?-1:1); const amt=parseAmtRaw(m[3]); const yyyy=toYearFromYY(d.slice(0,2));
        const date=`${yyyy}-${d.slice(2,4)}-${d.slice(4,6)}`; cur={date, amount:sign*amt, description:''}; rows.push(cur);
      }
    }else if(ln.startsWith(':86:') && cur){ cur.description += ' '+ln.replace(':86:','').trim(); }
  }
  return rows;
}
// CAMT.053 XML
function parseCAMT(xmlText){
  const doc=new DOMParser().parseFromString(xmlText,'application/xml'); const entries=[...doc.getElementsByTagName('Ntry')];
  const rows=[]; for(const n of entries){
    const amtEl=n.getElementsByTagName('Amt')[0]; if(!amtEl) continue;
    const amt=parseAmtRaw(amtEl.textContent); const isC=n.getElementsByTagName('CdtDbtInd')[0]?.textContent==='CRDT';
    const bdt=n.getElementsByTagName('BookgDt')[0]?.getElementsByTagName('Dt')[0]?.textContent;
    let desc=''; const ustrd=n.getElementsByTagName('Ustrd')[0]?.textContent; const rmtInf=n.getElementsByTagName('RmtInf')[0]?.textContent;
    desc=(ustrd||rmtInf||'').replace(/\s+/g,' ').trim();
    rows.push({date:bdt||'', description:desc, amount:(isC?1:-1)*amt});
  } return rows;
}
// PDF (embedded text via pdf.js)
async function parsePDF(file){
  const { getDocument } = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.mjs');
  const data=await file.arrayBuffer(); const pdf=await getDocument({data}).promise;
  let text=''; for(let i=1;i<=pdf.numPages;i++){ const page=await pdf.getPage(i); const c=await page.getTextContent(); text += c.items.map(it=>it.str).join(' ') + '\n'; }
  return extractSwissFromText(text);
}
// Swiss text extraction (for PDF-text + OCR output)
function extractSwissFromText(raw){
  const lines=raw.split(/\r?\n/).map(l=>l.replace(/[•··]/g,' ').replace(/\s{2,}/g,' ').trim());
  const stitched=[]; let cur=null; const dateRe=/^\d{2}\.\d{2}(?!\.)/;
  for(const ln of lines){ if(!ln) continue; if(dateRe.test(ln)){ if(cur) stitched.push(cur); cur=ln;} else if(cur){cur+=' '+ln;} }
  if(cur) stitched.push(cur);
  const numRe=/[-+]?\d{1,3}(?:[\'\s\.]\d{3})*(?:[\.,]\d{2})/g, timeRe=/\b\d{2}[:\.]\d{2}\b/g, dateYYRe=/(\d{2}\.\d{2}\.\d{2})(?!\d)/g;
  const rows=[];
  for(const s of stitched){
    const firstDM=(s.match(/\b\d{2}\.\d{2}\b/)||[])[0]; if(!firstDM) continue;
    const yyMatch=Array.from(s.matchAll(dateYYRe)).pop(); const yy=yyMatch ? yyMatch[1].split('.')[2] : String(new Date().getFullYear()).slice(-2);
    const tokens=(s.match(numRe)||[]).filter(t=>{ if(firstDM&&t.replace(',','.')===firstDM.replace(',','.')) return false; if(timeRe.test(t)) return false; return true; });
    if(!tokens.length) continue; const amountToken=tokens.length>=2?tokens[tokens.length-2]:tokens[tokens.length-1];
    const [d,m]=firstDM.split('.'); const Y=toYearFromYY(yy); const date=`${Y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    const desc=s.replace(/^\d{2}\.\d{2}\s*/,'').replace(/\s\d{2}\.\d{2}\.\d{2}\b.*$/,'').trim();
    rows.push({date, description:desc, amount:parseAmtRaw(amountToken)});
  }
  return rows;
}

// --- UI flows ---
function showImport(){
  document.getElementById('screen').innerHTML=`
    <h2>Datei importieren</h2>
    <div class="row">
      <label>Typ:</label>
      <select id="fmt">
        <option value="csv">CSV (Bank-Export)</option>
        <option value="mt940">MT940 (.sta)</option>
        <option value="camt">CAMT.053 XML</option>
        <option value="pdf">PDF (Text extrahieren)</option>
      </select>
      <input type="file" id="file" />
      <button id="go">Import starten</button>
    </div>
    <pre id="log" class="log" style="display:none"></pre>
    <table class="table" style="margin-top:10px"><thead><tr><th>Datum</th><th>Beschreibung</th><th class="right">Betrag</th></tr></thead><tbody id="preview"></tbody></table>
  `;
  const log=(t)=>{const el=document.getElementById('log'); el.style.display='block'; el.textContent+=(el.textContent?'\n':'')+t; el.scrollTop=el.scrollHeight;}
  document.getElementById('go').onclick=async()=>{
    const f=document.getElementById('file').files[0]; if(!f) return alert('Bitte Datei wählen.');
    const fmt=document.getElementById('fmt').value;
    try{
      let rows=[];
      if(fmt==='csv'){rows=parseCSV(await f.text());}
      else if(fmt==='mt940'){rows=parseMT940(await f.text());}
      else if(fmt==='camt'){rows=parseCAMT(await f.text());}
      else if(fmt==='pdf'){rows=await parsePDF(f);}
      rows.forEach(r=>r.category=categorize(r));
      document.getElementById('preview').innerHTML=rows.map(r=>`<tr><td>${r.date}</td><td><strong style="color:${colorFor(r.category)}">${r.category}</strong> – ${r.description}</td><td class="right">${(r.amount||0).toFixed(2)} CHF</td></tr>`).join('')||'<tr><td colspan="3" class="muted">Keine Daten erkannt</td></tr>';
      let imported=0; for(const r of rows){const h=await hashRec(r); if(await dupHas(h)) continue; await txAdd(await encJSON(aesKey,r)); await dupAdd(h); imported++;}
      if(imported){const ym=rows.find(r=>r.date)?.date?.slice(0,7)||curYM(); await metaSet('lastImport',{ym,ts:Date.now(),count:rows.length}); await showMonth(true);}
    }catch(e){log('❌ '+(e?.message||e));}
  };
}

function scanScreen(){
  document.getElementById('screen').innerHTML=`
    <h2>Screenshot-OCR</h2>
    <input type="file" id="file" accept="image/*" />
    <button id="go">Screenshot lesen & importieren</button>
    <pre id="log" class="log" style="display:none"></pre>
    <table class="table" style="margin-top:10px"><thead><tr><th>Datum</th><th>Beschreibung</th><th class="right">Betrag</th></tr></thead><tbody id="preview"></tbody></table>
  `;
  const log=(t)=>{const el=document.getElementById('log'); el.style.display='block'; el.textContent+=(el.textContent?'\n':'')+t; el.scrollTop=el.scrollHeight;}
  document.getElementById('go').onclick=async()=>{
    const f=document.getElementById('file').files[0]; if(!f) return alert('Bitte Bild wählen.');
    if(!window.Tesseract) return alert('OCR-Engine benötigt Internet beim ersten Mal.');
    try{
      log('⏳ OCR startet…'); const w=await Tesseract.createWorker('deu+eng',1,{logger:m=>m.status&&log('Tesseract: '+m.status)});
      const res=await w.recognize(await f.arrayBuffer()); await w.terminate(); log('✅ OCR beendet.');
      const rows=extractSwissFromText(res?.data?.text||''); rows.forEach(r=>r.category=categorize(r));
      document.getElementById('preview').innerHTML=rows.map(r=>`<tr><td>${r.date}</td><td><strong style="color:${colorFor(r.category)}">${r.category}</strong> – ${r.description}</td><td class="right">${(r.amount||0).toFixed(2)} CHF</td></tr>`).join('')||'<tr><td colspan="3" class="muted">Keine Daten erkannt</td></tr>';
      let imported=0; for(const r of rows){const h=await hashRec(r); if(await dupHas(h)) continue; await txAdd(await encJSON(aesKey,r)); await dupAdd(h); imported++;}
      if(imported){const ym=rows.find(r=>r.date)?.date?.slice(0,7)||curYM(); await metaSet('lastImport',{ym,ts:Date.now(),count:rows.length}); await showMonth(true);}
    }catch(e){log('❌ '+(e?.message||e));}
  };
}

// chart helpers
function aggregate(rows){
  const m=new Map(); for(const r of rows){const k=(r.category||'—')||'—'; m.set(k,(m.get(k)||0)+(r.amount||0));}
  const items=[...m.entries()].sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
  const total=[...m.values()].reduce((a,b)=>a+b,0);
  return {items,total};
}
function buildPie(canvasId,legendId,items,onClick,total){
  const ctx=document.getElementById(canvasId);
  const labels=items.map(i=>i[0]), data=items.map(i=>i[1]);
  const colors=labels.map(l=>colorFor(l));
  if(window._c&&window._c[canvasId]) window._c[canvasId].destroy();
  window._c||(window._c={});
  window._c[canvasId]=new Chart(ctx,{type:'pie',data:{labels,datasets:[{data,backgroundColor:colors,borderColor:'#fff',borderWidth:1}]},
    options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{display:false}},onClick:(e,els)=>{if(els.length)onClick(labels[els[0].index]);}}});
  const ul=document.getElementById(legendId); ul.innerHTML='';
  labels.forEach((l,i)=>{const v=data[i],p=total?Math.round(v/total*100):0;
    const chip=document.createElement('li'); chip.className='chip'; chip.innerHTML=`<span class="swatch" style="background:${colors[i]}"></span>${l} • ${v.toFixed(2)} CHF (${p}%)`; chip.onclick=()=>onClick(l); ul.appendChild(chip);
  });
}
function renderTable(id,rows){document.getElementById(id).innerHTML=rows.map(r=>`<tr><td>${r.date}</td><td><strong style="color:${colorFor(r.category||'Sonstiges')}">${r.category||'—'}</strong> – ${r.description}</td><td class="right">${(r.amount||0).toFixed(2)} CHF</td></tr>`).join('')||`<tr><td colspan="3" class="muted">Keine Daten</td></tr>`}

// fetch & decrypt
async function getAllDecrypted(){
  const raws=await txAll(); const out=[]; for(const e of raws){try{out.push(await decJSON(aesKey,e))}catch{}}
  out.forEach(r=>{ if(!r.category) r.category=categorize(r); });
  return out;
}

// Month
async function showMonth(preferLast=true){
  const decd=await getAllDecrypted();
  let ym=curYM(); const li=await metaGet('lastImport'); if(preferLast&&li?.ym) ym=li.ym;
  let rows=filterMonth(decd,ym); if(!rows.length&&decd.length){const months=[...new Set(decd.map(r=>r.date.slice(0,7)))].sort(); ym=months.pop(); rows=filterMonth(decd,ym);}
  document.getElementById('screen').innerHTML=`
    <div class="row">
      <h2 style="margin-right:auto">Monatsübersicht ${monthLabel(ym)}</h2>
      <label class="toggle"><input type="checkbox" id="expOnly" checked>Nur Ausgaben</label>
    </div>
    <div class="pie-wrap"><canvas id="pie" class="pie"></canvas></div>
    <ul id="legend" class="legend"></ul>
    <h3>Details: <span id="catName">—</span></h3>
    <table class="table"><thead><tr><th>Datum</th><th>Beschreibung</th><th class="right">Betrag</th></tr></thead><tbody id="details"></tbody></table>`;
  const apply=()=>{
    const exp=document.getElementById('expOnly').checked;
    const view=rows.filter(r=>!exp || r.amount<0); // expenses negative or decide sign
    const agg=aggregate(view);
    const selectCat=(cat)=>{document.getElementById('catName').textContent=cat; renderTable('details',view.filter(r=>(r.category||'—')===cat));};
    buildPie('pie','legend',agg.items,selectCat,agg.total);
    if(agg.items.length) selectCat(agg.items[0][0]); else document.getElementById('details').innerHTML='<tr><td colspan="3" class="muted">Keine Daten</td></tr>';
  };
  document.getElementById('expOnly').onchange=apply; apply();
}

// Year
async function showYear(){
  const decd=await getAllDecrypted();
  const y=(new Date()).getFullYear();
  document.getElementById('screen').innerHTML=`
    <div class="row">
      <h2 style="margin-right:auto">Jahresrückblick ${y}</h2>
      <label class="toggle"><input type="checkbox" id="expOnlyY" checked>Nur Ausgaben</label>
      <select id="mode">
        <option value="stacked" selected>Gestapelt (Summe)</option>
        <option value="grouped">Gruppiert</option>
      </select>
    </div>
    <canvas id="bar" style="max-width:980px;width:100%;height:380px"></canvas>
    <p class="muted">Tipp: Monat antippen für Drilldown.</p>
  `;
  const months=Array.from({length:12},(_,i)=>`${y}-${String(i+1).padStart(2,'0')}`);
  const cats=[...new Set(decd.map(r=>r.category||'Sonstiges'))].sort();
  let stacked=true; let expOnly=true;
  const buildData=()=>{
    const sums={}; cats.forEach(c=>sums[c]=months.map(()=>0));
    decd.forEach(r=>{
      if(!r.date.startsWith(String(y))) return;
      if(expOnly && r.amount>=0) return;
      const m=parseInt(r.date.slice(5,7),10)-1;
      sums[r.category||'Sonstiges'][m] += (r.amount||0);
    });
    return cats.map(c=>({label:c,data:sums[c],backgroundColor:colorFor(c),stack:'sum'}));
  };
  const ctx=document.getElementById('bar').getContext('2d');
  let chart=new Chart(ctx,{type:'bar',data:{labels:months.map(m=>monthLabel(m)),datasets:buildData()},options:{
    responsive:true, maintainAspectRatio:false,
    scales:{x:{stacked:true}, y:{stacked:true, ticks:{callback:(v)=>v+' CHF'}}},
    plugins:{legend:{position:'bottom'}},
    onClick:(e,els)=>{ if(els.length){ const xIndex=els[0].index; const ym=months[xIndex]; metaSet('lastImport',{ym,ts:Date.now(),count:0}).then(()=>showMonth(true)); } }
  }});
  document.getElementById('mode').onchange=(e)=>{
    stacked = e.target.value==='stacked';
    chart.options.scales.x.stacked=stacked; chart.options.scales.y.stacked=stacked; chart.update();
  };
  document.getElementById('expOnlyY').onchange=(e)=>{
    expOnly=e.target.checked; chart.data.datasets=buildData(); chart.update();
  };
}

// bootstrap
window.addEventListener('load', async ()=>{
  if('serviceWorker' in navigator){try{await navigator.serviceWorker.register('./sw.js?v=2730')}catch{}}
  await autoLogin();
  document.getElementById('btn-import').onclick=showImport;
  document.getElementById('btn-scan').onclick=scanScreen;
  document.getElementById('btn-month').onclick=()=>showMonth(true);
  document.getElementById('btn-year').onclick=showYear;
  document.getElementById('btn-review').onclick=showYear;
  showMonth(true);
});
