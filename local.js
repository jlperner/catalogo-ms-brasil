// ---- Arquivos importados no próprio tablet ----
// O catálogo e as promoções podem ser importados direto no tablet (ex.: PDF recebido pelo WhatsApp).
// O PDF é processado aqui mesmo (imagens das páginas, texto para a busca, nome dos produtos) e fica
// guardado no IndexedDB do aparelho, funcionando offline. Vale só para este tablet.

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
const TELA_W = 1240; // largura das imagens das páginas (equivale a ~150 dpi em A4)
const MINI_W = 300;

const scripts = {};
function loadScript(src) {
  scripts[src] ||= new Promise((ok, fail) => {
    const s = Object.assign(document.createElement('script'), { src, onload: ok, onerror: () => fail(new Error('sem internet para carregar ' + src)) });
    document.head.append(s);
  });
  return scripts[src];
}

// IndexedDB simples (chave → valor)
let dbPromise;
function idb() {
  dbPromise ||= new Promise((ok, fail) => {
    const r = indexedDB.open('catalogo-local', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
  return dbPromise;
}
async function idbGet(k) {
  const db = await idb();
  return new Promise((ok, fail) => {
    const r = db.transaction('kv').objectStore('kv').get(k);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}
async function idbSet(k, v) {
  const db = await idb();
  return new Promise((ok, fail) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').put(v, k);
    t.oncomplete = () => ok();
    t.onerror = () => fail(t.error);
  });
}
async function idbDelPrefix(prefix) {
  const db = await idb();
  return new Promise((ok, fail) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').delete(IDBKeyRange.bound(prefix, prefix + '￿'));
    t.oncomplete = () => ok();
    t.onerror = () => fail(t.error);
  });
}

// ---- Catálogos importados neste tablet ----
// Cada PDF importado vira mais um catálogo (somado aos publicados). Guardado no IndexedDB:
//   books                lista [{ id, nome, paginas }]
//   book/<id>/indice     [{ pn, titulo, texto }]
//   book/<id>/tela/<pn>, book/<id>/mini/<pn>   imagens JPEG
const localAssets = {}; // id → { telas: [Blob], telaUrls: [url], minis: [url] }

async function loadLocalBooks() {
  try {
    idbDelPrefix('cat/').catch(() => {}); // restos da versão antiga (um catálogo importado só)
    const list = (await idbGet('books')) || [];
    return await Promise.all(list.map(async (b) => {
      const indice = await idbGet(`book/${b.id}/indice`);
      const telas = await Promise.all(indice.map((p) => idbGet(`book/${b.id}/tela/${p.pn}`)));
      const minis = await Promise.all(indice.map((p) => idbGet(`book/${b.id}/mini/${p.pn}`)));
      localAssets[b.id] = {
        telas,
        telaUrls: telas.map((x) => URL.createObjectURL(x)),
        minis: minis.map((x) => URL.createObjectURL(x)),
      };
      return { book: { ...b, local: true }, indice };
    }));
  } catch {
    return [];
  }
}

function miniUrl(n) {
  const p = pages[n - 1];
  return localAssets[p.book] ? localAssets[p.book].minis[p.pn - 1] : `catalogos/${p.book}/miniaturas/${p.pn}.jpg`;
}
function telaUrl(n) {
  const p = pages[n - 1];
  return localAssets[p.book] ? localAssets[p.book].telaUrls[p.pn - 1] : `catalogos/${p.book}/telas/${p.pn}.jpg`;
}

async function pageBlob(n) {
  const p = pages[n - 1];
  if (localAssets[p.book]) return pdfFromJpgs([localAssets[p.book].telas[p.pn - 1]]);
  return (await fetch(`catalogos/${p.book}/paginas/${p.pn}.pdf`)).blob();
}
async function catalogBlob(id) {
  if (localAssets[id]) return pdfFromJpgs(localAssets[id].telas);
  return (await fetch(`catalogos/${id}/catalogo.pdf`)).blob();
}

// Monta um PDF a partir das imagens das páginas (para enviar/baixar)
async function pdfFromJpgs(blobs) {
  await loadScript(PDFLIB);
  const doc = await PDFLib.PDFDocument.create();
  for (const b of blobs) {
    const img = await doc.embedJpg(await b.arrayBuffer());
    const k = 595 / img.width; // largura de uma folha A4 em pontos
    const page = doc.addPage([img.width * k, img.height * k]);
    page.drawImage(img, { x: 0, y: 0, width: img.width * k, height: img.height * k });
  }
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

async function openPdf(file) {
  await loadScript(PDFJS);
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return pdfjsLib.getDocument({ url: URL.createObjectURL(file) }).promise;
}

// Renderiza a página em JPEG na largura pedida (e uma miniatura, se pedida)
const canvas = document.createElement('canvas');
async function renderPage(page, width, miniWidth) {
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: width / base.width });
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const tela = await toJpg(canvas, 0.8);
  if (!miniWidth) return { tela };
  const small = document.createElement('canvas');
  small.width = miniWidth;
  small.height = Math.round(canvas.height * (miniWidth / canvas.width));
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
  return { tela, mini: await toJpg(small, 0.7) };
}
const toJpg = (c, q) => new Promise((ok) => c.toBlob(ok, 'image/jpeg', q));

// Linhas de texto da página com o tamanho da letra (para descobrir o nome do produto)
async function pageLines(page) {
  const tc = await page.getTextContent();
  // Junta pedaços vizinhos que estão na mesma altura e com a mesma letra (formam uma linha)
  const lines = [];
  let cur = null;
  for (const it of tc.items) {
    if (!it.str.trim()) continue;
    const s = Math.hypot(it.transform[2], it.transform[3]);
    const y = it.transform[5];
    if (cur && Math.abs(y - cur.y) < s * 0.5 && Math.abs(s - cur.s) < 0.5) cur.t += ' ' + it.str;
    else lines.push((cur = { t: it.str, s, y }));
  }
  const texto = tc.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
  const clean = lines
    .map((l) => ({ t: l.t.replace(/\s+/g, ' ').trim(), s: l.s }))
    .filter((l) => l.t.length > 2 && !/^[\d ]+$/.test(l.t));
  return { texto, lines: clean };
}

// Mesmo critério do preparar.py: textos grandes que não se repetem em muitas páginas
function titulosDe(todas) {
  const freq = {};
  for (const ls of todas) for (const t of new Set(ls.map((l) => l.t))) freq[t] = (freq[t] || 0) + 1;
  const limite = Math.max(3, Math.floor(todas.length / 15));
  return todas.map((ls) => {
    const cand = ls.filter((l) => freq[l.t] <= limite);
    if (!cand.length) return '';
    let grandes = cand.filter((l) => l.s >= 14);
    if (!grandes.length) {
      const maior = Math.max(...cand.map((l) => l.s));
      grandes = cand.filter((l) => l.s >= maior - 0.5);
    }
    return grandes.map((l) => l.t).join(' ').slice(0, 120);
  });
}

async function importCatalog(file) {
  progress(`Abrindo ${file.name}…`, 0);
  const pdf = await openPdf(file);
  const total = pdf.numPages;
  const id = 'local-' + Date.now().toString(36);
  const linhas = [], textos = [];
  try {
    for (let n = 1; n <= total; n++) {
      progress(`Processando página ${n} de ${total}…`, (n - 1) / total);
      const page = await pdf.getPage(n);
      const { texto, lines } = await pageLines(page);
      textos.push(texto);
      linhas.push(lines);
      const { tela, mini } = await renderPage(page, TELA_W, MINI_W);
      await idbSet(`book/${id}/tela/${n}`, tela);
      await idbSet(`book/${id}/mini/${n}`, mini);
      page.cleanup();
    }
  } catch (e) {
    await idbDelPrefix(`book/${id}/`); // não deixa catálogo pela metade
    throw e;
  }
  const nomes = titulosDe(linhas);
  await idbSet(`book/${id}/indice`, textos.map((texto, i) => ({ pn: i + 1, titulo: nomes[i], texto })));
  const nome = file.name.replace(/\.pdf$/i, '').replace(/_/g, ' ').trim();
  await idbSet('books', [...((await idbGet('books')) || []), { id, nome, paginas: total }]);
  try { localStorage.setItem('book', id); } catch {} // abre já no catálogo importado
  pdf.destroy();
}

async function removeLocalBook(id) {
  await idbSet('books', ((await idbGet('books')) || []).filter((b) => b.id !== id));
  await idbDelPrefix(`book/${id}/`);
}

// ---- Promoções locais ----
async function localPromos() {
  const list = (await idbGet('promo/list').catch(() => null)) || [];
  return Promise.all(list.map(async (p) => {
    const imgs = await Promise.all(Array.from({ length: p.paginas }, (_, j) => idbGet(`promo/${p.id}/img/${j + 1}`)));
    return {
      nome: p.nome,
      local: p.id,
      imgs: imgs.map((b) => URL.createObjectURL(b)),
      file: async () => new File([await idbGet(`promo/${p.id}/file`)], p.baixar, { type: p.tipo }),
    };
  }));
}

async function importPromo(file) {
  const id = Date.now().toString(36);
  const nome = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  let paginas = 0;
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdf = await openPdf(file);
    for (let j = 1; j <= pdf.numPages; j++) {
      progress(`Processando ${nome}: página ${j} de ${pdf.numPages}…`, (j - 1) / pdf.numPages);
      const page = await pdf.getPage(j);
      const { tela } = await renderPage(page, TELA_W);
      await idbSet(`promo/${id}/img/${j}`, tela);
      page.cleanup();
    }
    paginas = pdf.numPages;
    pdf.destroy();
  } else {
    progress(`Salvando ${nome}…`, 0.5);
    await idbSet(`promo/${id}/img/1`, file);
    paginas = 1;
  }
  await idbSet(`promo/${id}/file`, file);
  const list = (await idbGet('promo/list')) || [];
  list.push({ id, nome, baixar: file.name, tipo: file.type || 'application/pdf', paginas });
  await idbSet('promo/list', list);
}

async function removePromo(id) {
  const list = ((await idbGet('promo/list')) || []).filter((p) => p.id !== id);
  await idbSet('promo/list', list);
  await idbDelPrefix(`promo/${id}/`);
}

// ---- Baixar tudo para usar offline ----
// Guarda no aparelho todas as páginas, miniaturas, PDFs e promoções publicadas.
// O service worker (sw.js) procura em todos os caches, então depois disso tudo abre sem internet.
async function cacheAll() {
  const urls = ['./', 'index.html', 'app.js', 'local.js', 'styles.css', 'manifest.json', 'icon.svg', 'catalogos.json'];
  for (const b of books) {
    if (b.local) continue; // importados já estão no aparelho
    urls.push(`catalogos/${b.id}/indice.json`, `catalogos/${b.id}/catalogo.pdf`);
  }
  for (const p of pages) {
    if (localAssets[p.book]) continue;
    const base = `catalogos/${p.book}/`;
    urls.push(`${base}miniaturas/${p.pn}.jpg`, `${base}telas/${p.pn}.jpg`, `${base}paginas/${p.pn}.pdf`);
  }
  try {
    const res = await fetch('promocoes/promocoes.json', { cache: 'no-cache' });
    if (res.ok) {
      urls.push('promocoes/promocoes.json');
      for (const p of await res.json()) urls.push('promocoes/' + p.arquivo, ...p.imagens.map((i) => 'promocoes/' + i));
    }
  } catch {}
  const cache = await caches.open('catalogo-offline');
  let feitos = 0, falhas = 0;
  const fila = [...new Set(urls)];
  async function worker() {
    while (fila.length) {
      const url = fila.shift();
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) await cache.put(url, res); else falhas++;
      } catch { falhas++; }
      feitos++;
      progress(`Baixando ${feitos} de ${urls.length} arquivos…`, feitos / urls.length);
    }
  }
  progress('Preparando…', 0);
  await Promise.all([worker(), worker(), worker(), worker()]);
  progressDone();
  try { localStorage.setItem('offline-em', new Date().toLocaleDateString('pt-BR')); } catch {}
  toast(falhas ? `Baixado, mas ${falhas} arquivo(s) falharam. Tente de novo com internet.` : 'Pronto! O catálogo inteiro funciona sem internet.');
}

document.getElementById('off-btn').onclick = () => {
  document.getElementById('imp-dlg').close();
  if (!('caches' in window)) return toast('Este navegador não permite guardar para uso offline (precisa do site em https).');
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  cacheAll();
};

// ---- Tela de importar ----
function progress(text, frac) {
  document.getElementById('prog').hidden = false;
  document.getElementById('prog-text').textContent = text;
  document.getElementById('prog-bar').style.width = Math.round(frac * 100) + '%';
}
const progressDone = () => (document.getElementById('prog').hidden = true);

async function runImport(kind, file) {
  if (!file) return;
  document.getElementById('imp-dlg').close();
  try {
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    if (kind === 'cat') {
      await importCatalog(file);
      progress('Pronto! Abrindo o catálogo importado…', 1);
      location.reload();
    } else {
      await importPromo(file);
      progressDone();
      toast(`Promoção "${file.name}" importada.`);
      openPromos();
    }
  } catch (e) {
    progressDone();
    toast('Não foi possível importar: ' + e.message);
  }
}

function openImportDialog() {
  // Catálogos importados neste tablet, cada um com "Remover" (segundo toque confirma)
  const box = document.getElementById('imp-books');
  const locais = books.filter((b) => b.local);
  box.replaceChildren();
  if (locais.length) {
    const h = Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Catálogos importados neste tablet:' });
    box.append(h);
  }
  for (const b of locais) {
    const row = Object.assign(document.createElement('div'), { className: 'cat-row' });
    const name = Object.assign(document.createElement('b'), { textContent: `${b.nome} (${b.paginas} pág.)` });
    const del = button('Remover', 'danger', async () => {
      if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Confirmar?'; return; }
      await removeLocalBook(b.id);
      location.reload();
    });
    row.append(name, del);
    box.append(row);
  }
  let quando = null;
  try { quando = localStorage.getItem('offline-em'); } catch {}
  const mb = Math.round(pages.filter((p) => !localAssets[p.book]).length * 0.6);
  document.getElementById('off-info').textContent = quando
    ? `Último download completo: ${quando}. Repita quando os catálogos forem atualizados.`
    : `Baixa cerca de ${mb} MB. Use no Wi-Fi.`;
  document.getElementById('imp-dlg').showModal();
}

document.getElementById('imp-btn').onclick = openImportDialog;
document.getElementById('imp-close').onclick = () => document.getElementById('imp-dlg').close();
document.getElementById('imp-cat-btn').onclick = () => document.getElementById('imp-cat').click();
document.getElementById('imp-promo-btn').onclick = () => document.getElementById('imp-promo').click();
document.getElementById('imp-cat').onchange = (e) => { runImport('cat', e.target.files[0]); e.target.value = ''; };
document.getElementById('imp-promo').onchange = (e) => { runImport('promo', e.target.files[0]); e.target.value = ''; };
