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
  // Mesmo arquivo (nome e tamanho) já importado: não importa de novo.
  // Mesmo nome com tamanho diferente: é uma versão nova, que substitui a anterior ao terminar.
  const nome = file.name.replace(/\.pdf$/i, '').replace(/_/g, ' ').trim();
  const antes = (await idbGet('books')) || [];
  const igual = antes.find((b) => b.nome === nome && b.tamanho === file.size);
  if (igual) {
    try { localStorage.setItem('book', igual.id); } catch {}
    return 'igual';
  }
  const anterior = antes.find((b) => b.nome === nome);
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
  await idbSet('books', [...((await idbGet('books')) || []), { id, nome, paginas: total, tamanho: file.size }]);
  if (anterior) await removeLocalBook(anterior.id);
  try { localStorage.setItem('book', id); } catch {} // abre já no catálogo importado
  pdf.destroy();
  return anterior ? 'atualizado' : 'novo';
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

// ---- Escolher o que fica disponível offline ----
// Cada catálogo publicado vai para um cache próprio (off-<id>), as promoções para off-promocoes e o app
// para off-app. Assim dá para baixar só os catálogos que a pessoa usa e apagar um sem mexer nos outros.
// O service worker (sw.js) procura em todos os caches, então o que foi baixado abre sem internet.
const OFF_KEY = 'offline2'; // { id: 'dd/mm/aaaa' } do que já foi baixado
function offState() { try { return JSON.parse(localStorage.getItem(OFF_KEY) || '{}'); } catch { return {}; } }
function setOffState(s) { try { localStorage.setItem(OFF_KEY, JSON.stringify(s)); } catch {} }

async function promoUrls() {
  try {
    const res = await fetch('promocoes/promocoes.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const urls = ['promocoes/promocoes.json'];
    for (const p of await res.json()) urls.push('promocoes/' + p.arquivo, ...p.imagens.map((i) => 'promocoes/' + i));
    return urls;
  } catch { return []; }
}
function bookUrls(b) {
  const base = `catalogos/${b.id}/`;
  const urls = [base + 'indice.json', base + 'catalogo.pdf'];
  for (let pn = 1; pn <= b.paginas; pn++) urls.push(`${base}miniaturas/${pn}.jpg`, `${base}telas/${pn}.jpg`, `${base}paginas/${pn}.pdf`);
  return urls;
}

// Baixa a lista de arquivos para o cache indicado (4 de cada vez), mostrando o progresso
async function fillCache(name, urls, label, done, total) {
  const cache = await caches.open(name);
  const fila = [...new Set(urls)];
  let falhas = 0;
  async function worker() {
    while (fila.length) {
      const url = fila.shift();
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) await cache.put(url, res); else falhas++;
      } catch { falhas++; }
      done.n++;
      progress(`${label}: ${done.n} de ${total} arquivos…`, done.n / total);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return falhas;
}

// Versão de cada item, para saber se o que está no aparelho ainda é o atual.
// Catálogo: a assinatura do PDF (preparar.py). Promoções: um resumo do promocoes.json.
let promoVersion = '';
async function itemVersion(id) {
  if (id !== 'promocoes') return bookById(id)?.assinatura || '';
  try {
    const t = await (await fetch('promocoes/promocoes.json', { cache: 'no-cache' })).text();
    let h = 0;
    for (const c of t) h = (h * 31 + c.charCodeAt(0)) | 0;
    return `${t.length}-${h}`;
  } catch { return promoVersion; }
}
// state[id] = { data, v }  (versões antigas do app guardavam só a data)
const offData = (x) => (typeof x === 'string' ? x : x?.data);
const offAtual = (x, v) => !!x && typeof x === 'object' && !!v && x.v === v;

async function openOfflineDialog() {
  const state = offState();
  promoVersion = await itemVersion('promocoes');
  const box = document.getElementById('off-list');
  box.replaceChildren();
  const itens = books.filter((b) => !b.local).map((b) => ({ id: b.id, nome: b.nome, mb: b.mb || Math.round(b.paginas * 0.6) }));
  itens.push({ id: 'promocoes', nome: '🔥 Promoções', mb: 7 });
  for (const it of itens) {
    const row = document.createElement('label');
    row.className = 'off-row';
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!state[it.id] });
    cb.dataset.id = it.id;
    cb.dataset.mb = it.mb;
    const txt = document.createElement('span');
    const nome = Object.assign(document.createElement('b'), { textContent: it.nome });
    const v = it.id === 'promocoes' ? promoVersion : bookById(it.id).assinatura;
    const info = Object.assign(document.createElement('small'), {
      textContent: !state[it.id] ? `${Math.round(it.mb)} MB`
        : offAtual(state[it.id], v) ? `${Math.round(it.mb)} MB · baixado em ${offData(state[it.id])} · em dia`
        : `${Math.round(it.mb)} MB · baixado em ${offData(state[it.id])} · ⚠ atualização disponível`,
    });
    if (state[it.id] && !offAtual(state[it.id], v)) info.classList.add('off-old');
    txt.append(nome, info);
    row.append(cb, txt);
    box.append(row);
  }
  const total = () => [...box.querySelectorAll('input:checked')].reduce((t, c) => t + +c.dataset.mb, 0);
  const upd = () => (document.getElementById('off-total').textContent = `Selecionado: ${Math.round(total())} MB no aparelho`);
  box.onchange = upd;
  upd();
  document.getElementById('imp-dlg').close();
  document.getElementById('off-dlg').showModal();
}

async function saveOffline() {
  document.getElementById('off-dlg').close();
  if (!('caches' in window)) return toast('Este navegador não permite guardar para uso offline (precisa do site em https).');
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  const state = offState();
  const marcados = [...document.querySelectorAll('#off-list input')].map((c) => [c.dataset.id, c.checked]);
  const hoje = new Date().toLocaleDateString('pt-BR');
  let falhas = 0, emDia = 0, baixados = 0;
  try {
    // Desmarcados: apaga do aparelho
    for (const [id, on] of marcados) {
      if (!on && state[id]) { await caches.delete('off-' + id); delete state[id]; }
    }
    // Marcados: baixa só o que ainda não está no aparelho ou mudou desde o último download
    const versoes = {};
    for (const [id, on] of marcados) if (on) versoes[id] = await itemVersion(id);
    const baixar = marcados.filter(([id, on]) => on && !offAtual(state[id], versoes[id])).map(([id]) => id);
    emDia = marcados.filter(([, on]) => on).length - baixar.length;
    baixados = baixar.length;
    if (baixar.length) {
      const listas ={ app: ['./', 'index.html', 'app.js', 'local.js', 'styles.css', 'manifest.json', 'icon.svg', 'catalogos.json'] };
      for (const id of baixar) listas[id] = id === 'promocoes' ? await promoUrls() : bookUrls(bookById(id));
      const total = Object.values(listas).reduce((t, l) => t + l.length, 0);
      const done = { n: 0 };
      progress('Preparando…', 0);
      for (const [id, urls] of Object.entries(listas)) {
        const nome = id === 'app' ? 'App' : id === 'promocoes' ? 'Promoções' : bookById(id).nome;
        await caches.delete('off-' + id); // começa limpo: tira páginas que saíram do catálogo
        falhas += await fillCache('off-' + id, urls, nome, done, total);
        if (id !== 'app') state[id] = { data: hoje, v: versoes[id] };
        setOffState(state);
      }
    }
  } finally {
    setOffState(state);
    progressDone();
  }
  toast(falhas ? `Concluído, mas ${falhas} arquivo(s) falharam. Tente de novo com internet.`
    : baixados ? `Pronto! ${baixados} item(ns) baixado(s)${emDia ? `, ${emDia} já estava(m) em dia` : ''}. Funciona sem internet.`
    : emDia ? 'Tudo já estava baixado e em dia. Nada para baixar.'
    : 'Cópias offline removidas.');
}

document.getElementById('off-btn').onclick = openOfflineDialog;
document.getElementById('off-save').onclick = saveOffline;
document.getElementById('off-close').onclick = () => document.getElementById('off-dlg').close();
if ('caches' in window) caches.delete('catalogo-offline').catch(() => {}); // cache da versão anterior (tudo junto)

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
      const r = await importCatalog(file);
      if (r === 'igual') {
        // já existe: só mostra o catálogo, sem processar de novo
        toast(`"${file.name}" já foi importado neste tablet. Mostrando o catálogo.`);
        pickBook(localStorage.getItem('book') || '');
        return;
      }
      progress(r === 'atualizado' ? 'Pronto! Versão anterior substituída. Abrindo…' : 'Pronto! Abrindo o catálogo importado…', 1);
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
  const st = offState(), n = Object.keys(st).length;
  document.getElementById('off-info').textContent = n
    ? `${n} item(ns) baixado(s). Toque para mudar ou atualizar.`
    : 'Escolha quais catálogos baixar para usar sem internet.';
  document.getElementById('imp-dlg').showModal();
}

document.getElementById('imp-btn').onclick = openImportDialog;
document.getElementById('imp-close').onclick = () => document.getElementById('imp-dlg').close();
document.getElementById('imp-cat-btn').onclick = () => document.getElementById('imp-cat').click();
document.getElementById('imp-promo-btn').onclick = () => document.getElementById('imp-promo').click();
document.getElementById('imp-cat').onchange = (e) => { runImport('cat', e.target.files[0]); e.target.value = ''; };
document.getElementById('imp-promo').onchange = (e) => { runImport('promo', e.target.files[0]); e.target.value = ''; };
