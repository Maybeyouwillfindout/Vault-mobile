
// Vault Mobile v2.6.1

let transactions = [];
let lastImport = [];

// Betrag parser robust
function parseAmount(x){
  if(!x) return 0;
  let s = String(x).trim().replace(/\u00A0/g,'').replace(/'/g,'');
  const hasComma = s.includes(','), hasDot = s.includes('.');
  if(hasComma && hasDot) s = s.replace(/\./g,'').replace(',', '.');
  else if(hasComma) s = s.replace(',', '.');
  else if(!hasComma && hasDot){
    const parts = s.split('.');
    if(parts.length > 2){ const last = parts.pop(); s = parts.join('')+'.'+last; }
  }
  const v = parseFloat(s);
  return isNaN(v)?0:v;
}

// OCR Parser (schweizer Kontoauszug)
function ddmmWithY(ddmm,yy){const[d,m]=ddmm.split('.');const Y=yy.length===2?`20${yy}`:yy;return `${Y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;}
function extractSwissTable(line){
  const re=/(\d{2}\.\d{2})\s+(.+?)\s+([-+]?\d+[\.,]\d{2})\s+(\d{2}\.\d{2}\.\d{2})\s+([-+]?\d+[\.,]\d{2})/;
  const m=line.match(re);
  if(!m) return null;
  const [_,ddmm,desc,amt,dmy]=m;
  const yy=dmy.split('.')[2];
  return {date:ddmmWithY(ddmm,yy),description:desc,amount:parseAmount(amt)};
}

// Navigation
function show(content){document.getElementById('screen').innerHTML=content;}

// Scan Screen
function goScan(){
  show(`<h2>OCR Import</h2>
    <input type=file id=file accept=image/*><br>
    <button onclick="doOCR()">Screenshot lesen</button>
    <pre id=log></pre>
    <table border=1><tbody id=ocr-body></tbody></table>
    <button id=btn-import class=hidden onclick="importOCR()">Importieren</button>`);
}

async function doOCR(){
  const f=document.getElementById('file').files[0];
  if(!f){alert('Bitte Datei wählen');return;}
  const log=document.getElementById('log');
  log.textContent='OCR läuft...';
  const { createWorker } = Tesseract;
  const worker = await createWorker('deu+eng');
  const { data:{ text } } = await worker.recognize(await f.arrayBuffer());
  await worker.terminate();
  log.textContent='OCR fertig';
  const lines=text.split(/\n/).map(l=>l.trim()).filter(Boolean);
  const rows=[];
  for(const line of lines){const s=extractSwissTable(line);if(s) rows.push(s);}
  lastImport = rows;
  const tb=document.getElementById('ocr-body');
  tb.innerHTML=rows.map(r=>`<tr><td>${r.date}</td><td>${r.description}</td><td>${r.amount}</td></tr>`).join('');
  if(rows.length) document.getElementById('btn-import').classList.remove('hidden');
}

function importOCR(){
  transactions.push(...lastImport);
  goMonthOverview();
}

// Monatsübersicht
function aggregateByCategory(rows){
  const map={};
  for(const r of rows){const cat=r.description.includes('Coop')?'Lebensmittel':'Sonstiges';map[cat]=(map[cat]||0)+r.amount;}
  return map;
}
function goMonthOverview(){
  const data=aggregateByCategory(transactions);
  let html=`<h2>Monatsübersicht</h2>`;
  if(lastImport.length){
    html+=`<div class=info>Zuletzt importiert: ${lastImport.length} Buchungen</div>`;
  }
  html+=`<canvas id=chart width=300 height=300></canvas>`;
  html+=`<table border=1><tr><th>Kategorie</th><th>Betrag</th></tr>`;
  for(const k in data){html+=`<tr><td>${k}</td><td>${data[k].toFixed(2)}</td></tr>`;}
  html+=`</table>`;
  show(html);
  const ctx=document.getElementById('chart').getContext('2d');
  new Chart(ctx,{type:'pie',data:{labels:Object.keys(data),datasets:[{data:Object.values(data)}]}});
}
function goYearOverview(){show('<h2>Jahresübersicht (Demo)</h2>');}
