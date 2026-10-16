// Arquivos gerados pelo preparar.py. Para atualizar o catálogo, rode o script e publique a pasta site/.
const PDF_NAME = 'Catalogo-MS-Brasil.pdf';

const $ = (id) => document.getElementById(id);
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let pages = []; // { n, titulo, texto, ntexto }
let favs = loadFavs();
let mode = 'all', current = 1;

function loadFavs() { try { return new Set(JSON.parse(localStorage.getItem('favs') || '[]')); } catch { return new Set(); } }
function saveFavs() { try { localStorage.setItem('favs', JSON.stringify([...favs])); } catch {} }

async function init() {
  try {
    // Catálogo importado neste tablet tem prioridade sobre o publicado (ver local.js)
    let indice = await loadLocalCatalog();
    if (!indice) {
      const res = await fetch('indice.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      indice = await res.json();
    }
    pages = indice.map((p) => ({ ...p, ntitulo: norm(p.titulo).replace(/[^a-z0-9]+/g, ' '), ntexto: norm(p.texto) }));
  } catch (e) {
    $('status').textContent = 'Não foi possível carregar o catálogo (' + e.message + ').';
    return;
  }
  loadCats();
  render();
}

function render() {
  const q = norm($('search').value.trim());
  let list = mode === 'fav' ? pages.filter((p) => favs.has(p.n)) : pages;
  if (catFilter && !editing) { const set = catPages(catFilter); list = list.filter((p) => set.has(p.n)); }
  const conteudo = $('search-mode').value === 'conteudo';
  // Modo "Nome": palavras com número são códigos (procurados na página toda); o resto busca só no nome do produto.
  // Modo "Conteúdo": procura em toda a ficha.
  if (q) list = list.filter((p) => q.split(/\s+/).every((w) =>
    conteudo ? (p.ntitulo + ' ' + p.ntexto).includes(w)
             : (/\d/.test(w) ? ' ' + p.ntexto : ' ' + p.ntitulo).includes(' ' + w)));
  $('status').textContent = q || mode === 'fav' || catFilter ? `${list.length} página(s) encontrada(s)` : `${pages.length} páginas`;

  const grid = $('grid');
  grid.innerHTML = '';
  if (!list.length) {
    $('status').textContent = '';
    grid.innerHTML = `<div class="empty">${mode === 'fav' && !q
      ? 'Nenhum favorito ainda. Toque na ☆ de uma página para guardar aqui.'
      : catFilter && !q ? 'Esta categoria ainda não tem páginas. Use ⚙ Gerenciar categorias → Escolher páginas.'
      : 'Nada encontrado. Tente outra palavra ou mude para "Conteúdo da ficha".'}</div>`;
  }
  for (const p of list) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<img loading="lazy" src="${miniUrl(p.n)}" alt="">
      <div class="info"><b>Pág. ${p.n}</b> ${esc(p.titulo)}${q ? `<div class="snip">${snippet(p, q)}</div>` : ''}</div>`;
    const star = document.createElement('button');
    star.className = 'star';
    star.textContent = favs.has(p.n) ? '★' : '☆';
    star.onclick = (e) => {
      e.stopPropagation();
      toggleFav(p.n);
      star.textContent = favs.has(p.n) ? '★' : '☆';
      if (mode === 'fav') render();
    };
    card.append(star);
    if (editing) {
      card.classList.toggle('sel', catPages(editing).has(p.n));
      card.onclick = () => { toggleCatPage(editing, p); card.classList.toggle('sel', catPages(editing).has(p.n)); updateEditBar(); };
    } else card.onclick = () => openViewer(p.n);
    grid.append(card);
  }
}

function snippet(p, q) {
  const ws = q.split(/\s+/);
  const w = $('search-mode').value === 'conteudo' ? ws[0] : ws.find((w) => /\d/.test(w));
  if (!w) return '';
  const i = norm(p.texto).indexOf(w);
  if (i < 0) return '';
  const a = Math.max(0, i - 40), b = Math.min(p.texto.length, i + w.length + 60);
  return '…' + esc(p.texto.slice(a, i)) + '<mark>' + esc(p.texto.slice(i, i + w.length)) + '</mark>' + esc(p.texto.slice(i + w.length, b)) + '…';
}

function toggleFav(n) { favs.has(n) ? favs.delete(n) : favs.add(n); saveFavs(); }

// ---- Visualizador ----
// Modo de leitura: 'uma' (uma página por vez) ou 'continuo' (páginas uma embaixo da outra, rolando)
let leitura = 'uma';
try { leitura = localStorage.getItem('leitura') || 'uma'; } catch {}

function setCurrent(n) {
  current = n;
  $('v-title').textContent = `Página ${n} de ${pages.length} — ${pages[n - 1].titulo}`;
  $('v-fav').textContent = favs.has(n) ? '★' : '☆';
  $('side-prev').disabled = n <= 1;
  $('side-next').disabled = n >= pages.length;
}

function openViewer(n) {
  $('viewer').hidden = false;
  $('viewer').dataset.leitura = leitura;
  marcarLeitura();
  setCurrent(n);
  if (leitura === 'uma') {
    // Só troca quando a imagem nova estiver pronta (sem piscar) e já deixa as vizinhas carregando
    const src = telaUrl(n);
    preload(src).then(() => { if (current === n) $('v-img').src = src; });
    for (const k of [n + 1, n - 1, n + 2]) if (k >= 1 && k <= pages.length) preload(telaUrl(k));
    $('v-wrap').scrollTo(0, 0);
  } else {
    buildList();
    $('v-list').children[n - 1].scrollIntoView();
  }
}

// Imagens já pedidas ficam guardadas aqui para a troca de página ser instantânea
const preloaded = new Map();
function preload(src) {
  if (!preloaded.has(src)) {
    const img = new Image();
    img.src = src;
    preloaded.set(src, img.decode().catch(() => {}));
    if (preloaded.size > 12) preloaded.delete(preloaded.keys().next().value);
  }
  return preloaded.get(src);
}

// Rolagem contínua: todas as páginas empilhadas; carrega as imagens conforme aparecem
const pageSeen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) setCurrent(+e.target.dataset.n);
  }
}, { root: $('v-wrap'), threshold: 0.5 });

function buildList() {
  const list = $('v-list');
  if (list.children.length) return;
  for (const p of pages) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = telaUrl(p.n);
    img.dataset.n = p.n;
    img.onload = () => img.setAttribute('data-loaded', '');
    list.append(img);
    pageSeen.observe(img);
  }
}

function goTo(n) {
  if (n < 1 || n > pages.length) return;
  if (leitura === 'uma') openViewer(n);
  else $('v-list').children[n - 1].scrollIntoView({ behavior: 'smooth' });
}

function marcarLeitura() {
  for (const [id, m] of [['m-uma', 'uma'], ['m-cont', 'continuo']])
    $(id).classList.toggle('on', leitura === m);
}
function setLeitura(m) {
  leitura = m;
  try { localStorage.setItem('leitura', leitura); } catch {}
  marcarLeitura();
  if (!$('viewer').hidden) openViewer(current);
}
// Pelos botões do topo, o catálogo sempre abre do começo
$('h-uma').onclick = () => { setLeitura('uma'); openViewer(1); };
$('h-cont').onclick = () => { setLeitura('continuo'); openViewer(1); };
marcarLeitura();
$('m-uma').onclick = () => setLeitura('uma');
$('m-cont').onclick = () => setLeitura('continuo');
$('v-close').onclick = () => { $('viewer').hidden = true; render(); };
$('v-prev').onclick = () => goTo(current - 1);
$('v-next').onclick = () => goTo(current + 1);
$('side-prev').onclick = () => $('v-prev').onclick();
$('side-next').onclick = () => $('v-next').onclick();
$('v-fav').onclick = () => { toggleFav(current); $('v-fav').textContent = favs.has(current) ? '★' : '☆'; };

// Deslizar para trocar de página (só sem zoom)
let sx = null;
$('v-wrap').addEventListener('touchstart', (e) => { sx = e.touches.length === 1 && visualViewport.scale <= 1 ? e.touches[0].clientX : null; });
$('v-wrap').addEventListener('touchend', (e) => {
  if (sx === null || leitura !== 'uma') return;
  const dx = e.changedTouches[0].clientX - sx;
  if (dx > 80) $('v-prev').onclick();
  if (dx < -80) $('v-next').onclick();
});

const label = () => `${pages[current - 1].titulo} — página ${current} do catálogo MS Brasil`;
const pageFile = async () => asPdf(await pageBlob(current), `${pages[current - 1].titulo || 'Pagina ' + current}.pdf`);
const catalogFile = async () => asPdf(await catalogBlob(), PDF_NAME);

$('v-zap').onclick = async () => {
  // Envia o PDF da página pelo menu do sistema (onde aparece o WhatsApp); sem suporte, manda só o texto.
  if (!(await shareFile(await pageFile(), label())))
    window.open('https://wa.me/?text=' + encodeURIComponent(label()), '_blank');
};
$('v-mail').onclick = () => {
  location.href = 'mailto:?subject=' + encodeURIComponent('Catálogo MS Brasil — ' + pages[current - 1].titulo) +
    '&body=' + encodeURIComponent(label());
};
$('v-share').onclick = async () => {
  if (!(await shareFile(await pageFile(), label()))) toast('Este aparelho não permite compartilhar arquivos. Use "Baixar página".');
};
$('v-down').onclick = async () => download(await pageFile());

$('share-all').onclick = async () => {
  $('status').textContent = 'Preparando catálogo…';
  const f = await catalogFile();
  render();
  if (!(await shareFile(f, 'Catálogo MS Brasil'))) toast('Este aparelho não permite compartilhar arquivos. Use "Baixar".');
};
$('download-all').onclick = async () => {
  $('status').textContent = 'Baixando catálogo…';
  download(await catalogFile());
  render();
};

const asPdf = (blob, name) => new File([blob], name.replace(/[\\/:*?"<>|]/g, '-'), { type: 'application/pdf' });

async function shareFile(file, text) {
  if (!navigator.canShare || !navigator.canShare({ files: [file] })) return false;
  try { await navigator.share({ files: [file], text }); } catch {}
  return true;
}

function download(file) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---- Categorias ----
// Cada pessoa cria as suas categorias, guardadas no próprio tablet.
// Para compartilhar, o app gera um link (com a categoria dentro dele) que pode ir pelo WhatsApp;
// quem abre o link escolhe se quer salvar a categoria no tablet dele.
// As páginas são guardadas pelo nome do produto (e o número, como reserva), para continuarem
// certas quando o PDF for atualizado e as páginas mudarem de lugar.
let cats = {};        // { nome: [{ n, t }] }
let catFilter = '';
let editing = null;   // categoria cujas páginas estão sendo escolhidas

function loadCats() {
  try { cats = JSON.parse(localStorage.getItem('cats') || '{}') || {}; } catch { cats = {}; }
  fillCatSelect();
  receiveSharedCat();
}
function saveCats() { try { localStorage.setItem('cats', JSON.stringify(cats)); } catch {} }

function catPages(name) {
  const set = new Set();
  for (const { n, t } of cats[name] || []) {
    const byTitle = t && pages.find((p) => p.titulo === t);
    if (byTitle) set.add(byTitle.n);
    else if (pages[n - 1]) set.add(n);
  }
  return set;
}
function toggleCatPage(name, p) {
  const list = cats[name];
  const i = list.findIndex((x) => (x.t ? x.t === p.titulo : x.n === p.n));
  if (i >= 0) list.splice(i, 1); else list.push({ n: p.n, t: p.titulo });
  saveCats();
}

const catNames = () => Object.keys(cats).sort((a, b) => a.localeCompare(b, 'pt-BR'));

// 🏷 escolhe o filtro (lista simples); ⚙ abre a tela de gerenciar
function fillCatSelect() {
  if (!cats[catFilter]) catFilter = '';
  $('cat-btn').textContent = `🏷 ${catFilter || 'Categoria'} ▾`;
  $('cat-btn').classList.toggle('active-cat', !!catFilter);
}
function pickCat(name) {
  catFilter = name;
  fillCatSelect();
  $('cat-menu').hidden = true;
  render();
}
function openCatMenu() {
  const menu = $('cat-menu');
  menu.replaceChildren(button('Todas as páginas', catFilter ? '' : 'on', () => pickCat('')));
  for (const c of catNames()) menu.append(button(`${c}  (${catPages(c).size})`, c === catFilter ? 'on' : '', () => pickCat(c)));
  if (!catNames().length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Nenhuma categoria. Toque em ⚙ para criar.';
    menu.append(p);
  }
  menu.hidden = false;
}
$('cat-btn').onclick = (e) => { e.stopPropagation(); $('cat-menu').hidden ? openCatMenu() : ($('cat-menu').hidden = true); };
document.addEventListener('click', (e) => { if (!$('cat-menu').contains(e.target)) $('cat-menu').hidden = true; });
$('cat-gear').onclick = () => openCatsDialog();

// Aviso curto no rodapé (no lugar das caixas de mensagem do navegador)
let toastTimer;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3500);
}

function button(text, cls, onclick) {
  const b = document.createElement('button');
  b.textContent = text;
  if (cls) b.className = cls;
  b.onclick = onclick;
  return b;
}

function openCatsDialog() {
  const box = $('cats-list');
  const names = catNames();
  box.innerHTML = names.length ? '' : '<p class="muted">Você ainda não tem categorias. Crie a primeira abaixo.</p>';
  for (const c of names) {
    const row = document.createElement('div');
    row.className = 'cat-row';
    const name = document.createElement('b');
    name.textContent = c;
    const count = document.createElement('span');
    count.className = 'muted';
    count.textContent = `${catPages(c).size} pág.`;

    const del = button('Excluir', 'danger', () => {
      // Segundo toque confirma
      if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Confirmar?'; return; }
      delete cats[c];
      saveCats(); fillCatSelect(); openCatsDialog(); render();
      toast(`Categoria "${c}" excluída.`);
    });
    const ren = button('Renomear', '', () => {
      const input = Object.assign(document.createElement('input'), { value: c, className: 'cat-rename' });
      const ok = button('OK', 'pri', () => {
        const novo = input.value.trim();
        if (!novo || novo === c) return openCatsDialog();
        if (cats[novo]) return toast('Já existe uma categoria com esse nome.');
        cats[novo] = cats[c];
        delete cats[c];
        if (catFilter === c) catFilter = novo;
        saveCats(); fillCatSelect(); openCatsDialog();
      });
      input.onkeydown = (e) => { if (e.key === 'Enter') ok.onclick(); };
      row.replaceChildren(input, ok, button('Cancelar', '', openCatsDialog));
      input.focus();
    });
    row.append(name, count,
      button('Escolher páginas', 'pri', () => startEditing(c)),
      button('Compartilhar', 'share', () => shareCat(c)),
      ren, del);
    box.append(row);
  }
  if (!$('cats-dlg').open) $('cats-dlg').showModal();
}
$('cat-new-btn').onclick = () => {
  const nome = $('cat-new').value.trim();
  if (!nome) return;
  if (cats[nome]) return toast('Já existe uma categoria com esse nome.');
  cats[nome] = [];
  $('cat-new').value = '';
  saveCats(); fillCatSelect(); openCatsDialog();
};
$('cat-new').onkeydown = (e) => { if (e.key === 'Enter') $('cat-new-btn').onclick(); };
$('cats-close').onclick = () => $('cats-dlg').close();

// ---- Compartilhar categoria por link ----
const toB64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

async function shareCat(name) {
  const data = { nome: name, p: cats[name].map(({ n, t }) => [n, t]) };
  const url = location.origin + location.pathname + '#categoria=' + toB64(JSON.stringify(data));
  const text = `Categoria "${name}" do catálogo MS Brasil (${cats[name].length} páginas). Abra o link no tablet para salvar:`;
  if (navigator.share) {
    try { await navigator.share({ title: name, text, url }); } catch {}
    return;
  }
  window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank');
}

let incoming = null;
function receiveSharedCat() {
  const m = location.hash.match(/categoria=([\w-]+)/);
  if (!m) return;
  history.replaceState(null, '', location.pathname);
  try {
    const d = JSON.parse(fromB64(m[1]));
    incoming = { nome: String(d.nome).slice(0, 60), itens: d.p.map(([n, t]) => ({ n: +n, t: String(t) })) };
  } catch { return toast('Link de categoria inválido.'); }
  $('recv-text').textContent = `Você recebeu a categoria "${incoming.nome}" com ${incoming.itens.length} página(s). Quer salvar no seu tablet?`;
  $('recv-name').value = incoming.nome;
  $('recv-dlg').showModal();
}
$('recv-save').onclick = () => {
  const nome = $('recv-name').value.trim();
  if (!nome) return;
  if (cats[nome] && !$('recv-save').dataset.armed) {
    $('recv-save').dataset.armed = '1';
    $('recv-save').textContent = 'Substituir a minha?';
    return toast(`Você já tem uma categoria "${nome}". Toque de novo para substituir, ou mude o nome.`);
  }
  cats[nome] = incoming.itens;
  saveCats(); fillCatSelect();
  $('recv-dlg').close();
  pickCat(nome);
  render();
  toast(`Categoria "${nome}" salva.`);
};
$('recv-name').oninput = () => { delete $('recv-save').dataset.armed; $('recv-save').textContent = 'Salvar'; };
$('recv-cancel').onclick = () => $('recv-dlg').close();

function startEditing(name) {
  editing = name;
  $('cats-dlg').close();
  document.body.classList.add('editing');
  updateEditBar();
  render();
  window.scrollTo(0, 0);
}
function updateEditBar() {
  $('edit-text').textContent = `Escolhendo páginas para "${editing}" — ${catPages(editing).size} selecionada(s). Toque nas páginas para marcar ou desmarcar; use a busca para achar os produtos.`;
}
$('edit-done').onclick = () => {
  const name = editing;
  editing = null;
  document.body.classList.remove('editing');
  fillCatSelect();
  render();
  openCatsDialog();
  toast(`Categoria "${name}" salva no seu tablet.`);
};

// ---- Promoções ----
// Junta os panfletos publicados (pasta promocoes/, gerados pelo preparar.py) com os importados
// neste tablet (local.js). Ao abrir um, aparecem as imagens e os botões para enviar ou baixar.
let promos = [], promo = null;

async function loadPromos() {
  let publicadas = [];
  try {
    const res = await fetch('promocoes/promocoes.json', { cache: 'no-cache' });
    if (res.ok) publicadas = (await res.json()).map((p) => ({
      nome: p.nome,
      imgs: p.imagens.map((i) => 'promocoes/' + i),
      file: async () => {
        const blob = await (await fetch('promocoes/' + p.arquivo)).blob();
        return new File([blob], p.baixar, { type: blob.type });
      },
    }));
  } catch {}
  return [...(await localPromos()), ...publicadas];
}

async function openPromos() {
  promo = null;
  $('promo-view').hidden = false;
  showPromoButtons(false);
  $('promo-title').textContent = '🔥 Promoções';
  const body = $('promo-body');
  body.className = 'promo-grid';
  body.innerHTML = '<p class="promo-empty">Carregando…</p>';
  promos = await loadPromos();
  body.innerHTML = promos.length ? '' : '<p class="promo-empty">Nenhuma promoção no momento. Use ⬆ Importar para adicionar.</p>';
  for (const p of promos) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<img loading="lazy" src="${p.imgs[0]}" alt=""><div class="info"><b>${esc(p.nome)}</b>${p.local ? '<div class="snip">Importada neste tablet</div>' : ''}</div>`;
    card.onclick = () => openPromo(p);
    body.append(card);
  }
}

function openPromo(p) {
  promo = p;
  showPromoButtons(true);
  $('promo-del').hidden = !p.local;
  $('promo-del').textContent = 'Remover';
  delete $('promo-del').dataset.armed;
  $('promo-title').textContent = '🔥 ' + p.nome;
  const body = $('promo-body');
  body.className = 'promo-pages';
  body.replaceChildren(...p.imgs.map((src) => Object.assign(document.createElement('img'), { src, loading: 'lazy' })));
  body.scrollTo(0, 0);
}

function showPromoButtons(on) {
  for (const id of ['promo-zap', 'promo-mail', 'promo-share', 'promo-down', 'promo-del']) $(id).hidden = !on;
}

const promoFile = () => promo.file();
const promoText = () => `Promoção MS Brasil: ${promo.nome}`;

$('promo-del').onclick = async () => {
  const b = $('promo-del');
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Confirmar?'; return; }
  await removePromo(promo.local);
  toast(`Promoção "${promo.nome}" removida.`);
  openPromos();
};
$('promo-btn').onclick = openPromos;
$('promo-back').onclick = () => (promo ? openPromos() : ($('promo-view').hidden = true));
$('promo-zap').onclick = async () => {
  if (!(await shareFile(await promoFile(), promoText())))
    window.open('https://wa.me/?text=' + encodeURIComponent(promoText()), '_blank');
};
$('promo-mail').onclick = () => {
  location.href = 'mailto:?subject=' + encodeURIComponent(promoText()) + '&body=' + encodeURIComponent(promoText());
};
$('promo-share').onclick = async () => {
  if (!(await shareFile(await promoFile(), promoText()))) toast('Este aparelho não permite compartilhar arquivos. Use "Baixar".');
};
$('promo-down').onclick = async () => download(await promoFile());

// ---- Busca e abas ----
let t;
$('search').oninput = () => { clearTimeout(t); t = setTimeout(render, 200); };
$('search-mode').onchange = render;
$('clear').onclick = () => { $('search').value = ''; render(); $('search').focus(); };
$('tab-all').onclick = () => { mode = 'all'; $('tab-all').classList.add('on'); $('tab-fav').classList.remove('on'); render(); };
$('tab-fav').onclick = () => { mode = 'fav'; $('tab-fav').classList.add('on'); $('tab-all').classList.remove('on'); render(); };

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
init();
