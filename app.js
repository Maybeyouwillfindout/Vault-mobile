// Vault Mobile v2 - First-run friendly
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

async function deriveKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 200_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt","decrypt"]
  );
}
function b64(b) { return btoa(String.fromCharCode(...new Uint8Array(b))); }
function ub64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = textEncoder.encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, pt);
  return { iv: b64(iv), ct: b64(ct) };
}
async function decryptJSON(key, blob) {
  const iv = ub64(blob.iv);
  const ct = ub64(blob.ct);
  const pt = await crypto.subtle.decrypt({name:"AES-GCM", iv}, key, ct);
  return JSON.parse(textDecoder.decode(pt));
}

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("vault-db", 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("tx")) db.createObjectStore("tx", { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function metaSet(key, val) { const db = await idb(); const t = db.transaction("meta","readwrite"); t.objectStore("meta").put(val, key); return t.complete; }
async function metaGet(key) { const db = await idb(); const t = db.transaction("meta","readonly"); return new Promise(res => { const r = t.objectStore("meta").get(key); r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); }); }
async function txAdd(enc) { const db = await idb(); const t = db.transaction("tx","readwrite"); t.objectStore("tx").add(enc); return t.complete; }
async function txAll() { const db = await idb(); const t = db.transaction("tx","readonly"); return new Promise(res => { const r = t.objectStore("tx").getAll(); r.onsuccess = () => res(r.result); r.onerror = () => res([]); }); }

let aesKey = null;
let salt = null;

async function ensureSalt() {
  let s = await metaGet("salt");
  if (!s) { const raw = crypto.getRandomValues(new Uint8Array(16)); s = b64(raw); await metaSet("salt", s); }
  return ub64(s);
}
async function isFirstRun() {
  const marker = await metaGet("marker");
  return !marker;
}

async function loginOrInitialize(password) {
  salt = await ensureSalt();
  aesKey = await deriveKey(password, salt);
  const marker = await metaGet("marker");
  if (!marker) {
    const enc = await encryptJSON(aesKey, { ok: true, createdAt: Date.now() });
    await metaSet("marker", enc);
    localStorage.setItem("vault-logged", "1");
    return true;
  } else {
    try {
      await decryptJSON(aesKey, marker);
      localStorage.setItem("vault-logged", "1");
      return true;
    } catch (e) {
      return false;
    }
  }
}

async function addTx(date, desc, amount, category) {
  const enc = await encryptJSON(aesKey, { date, description: desc, amount: parseFloat(amount||0), category });
  await txAdd(enc);
}
async function listTx() {
  const encs = await txAll();
  const rows = [];
  for (const e of encs) {
    try { rows.push(await decryptJSON(aesKey, e)); } catch {}
  }
  return rows.reverse();
}
function renderRows(rows) {
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.date||""}</td>
      <td>${r.description||""}</td>
      <td>${r.category||""}</td>
      <td class="right">${(r.amount||0).toFixed(2)} CHF</td>
    </tr>`).join("");
  const sum = rows.reduce((a,b)=>a+(b.amount||0),0);
  document.getElementById("sum").textContent = sum.toFixed(2);
}

window.addEventListener("load", async () => {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); } catch {}
  }
  if (await isFirstRun()) {
    document.getElementById("first-run").classList.remove("hidden");
    document.getElementById("auth-title").textContent = "Master-Passwort festlegen";
  }

  document.getElementById("btn-login").onclick = async () => {
    const pwd = document.getElementById("password").value;
    const ok = await loginOrInitialize(pwd);
    if (!ok) {
      alert("Falsches Passwort.");
      return;
    }
    document.getElementById("screen-auth").classList.add("hidden");
    document.getElementById("screen-app").classList.remove("hidden");
    renderRows(await listTx());
  };

  document.getElementById("btn-logout").onclick = () => {
    aesKey = null;
    localStorage.removeItem("vault-logged");
    document.getElementById("screen-auth").classList.remove("hidden");
    document.getElementById("screen-app").classList.add("hidden");
  };

  if (localStorage.getItem("vault-logged") === "1" && !(await isFirstRun())) {
    document.getElementById("screen-auth").classList.add("hidden");
    document.getElementById("screen-app").classList.remove("hidden");
    renderRows(await listTx());
  }

  document.getElementById("btn-add").onclick = async () => {
    const d = document.getElementById("tx-date").value;
    const desc = document.getElementById("tx-desc").value;
    const amt = document.getElementById("tx-amount").value;
    const cat = document.getElementById("tx-cat").value;
    await addTx(d, desc, amt, cat);
    document.getElementById("tx-desc").value = "";
    document.getElementById("tx-amount").value = "";
    document.getElementById("tx-cat").value = "";
    renderRows(await listTx());
  };
});
