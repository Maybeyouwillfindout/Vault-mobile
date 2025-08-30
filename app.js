
// Swiss parser demo
const FIXED_PASSWORD = "test1234";
function parseAmount(x){ if(!x) return 0; return parseFloat(x.replace(/\./g,'').replace(',','.'))||0; }
function ddmmWithY(ddmm,yy){const[d,m]=ddmm.split('.');const Y = yy.length===2?`20${yy}`:yy;return `${Y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;}
function extractSwissTable(line){
  const re=/^(\d{2}\.\d{2})\s+(.+?)\s+([-+]?\d+[\.,]\d{2})\s+(\d{2}\.\d{2}\.\d{2})\s+([-+]?\d+[\.,]\d{2})$/;
  const m=line.match(re);
  if(!m) return null;
  const [_,ddmm,desc,amt,dmy,saldo]=m;
  const yy=dmy.split('.')[2];
  return {date:ddmmWithY(ddmm,yy),description:desc,amount:parseAmount(amt)};
}
function extractFromOCR(raw){
  const lines=raw.split(/\n/).map(l=>l.trim()).filter(Boolean);
  const out=[];
  for(const line of lines){ const sw=extractSwissTable(line); if(sw) out.push(sw); }
  return out;
}
// Demo OCR button
document.getElementById('btn-ocr').onclick=()=>{
  const rows=[extractSwissTable("07.07   Coop TS Frauenfeld   7.35   03.07.25   592.20")].filter(Boolean);
  const tb=document.getElementById('ocr-body');
  tb.innerHTML=rows.map(r=>`<tr><td>${r.date}</td><td>${r.description}</td><td>${r.amount}</td></tr>`).join('');
  if(rows.length) document.getElementById('btn-ocr-import').classList.remove('hidden');
};
