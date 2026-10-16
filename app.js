// Catálogos: os publicados (pasta catalogo/, gerados pelo preparar.py) e os importados neste tablet (local.js).
// Todas as páginas de todos os catálogos ficam numa lista só; cada página sabe de que catálogo é (book)
// e qual é o número dela dentro dele (pn). O número global (n) só vale enquanto o app está aberto.

const $ = (id) => document.getElementById(id);
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let books = [];      // { id, nome, paginas, local? }
let pages = [];      // { n, book, pn, titulo, texto, ntitulo, ntexto }
let bookFilter = ''; // catálogo escolhido em 📚 ('' = todos)
let mode = 'all', current = 1;

const bookById = (id) => books.find((b) => b.id === id);
const bookOf = (p) => bookById(p.book);
const pageKey = (p) => `${p.book}:${p.pn}`;
// Promoções são catálogos do tipo "promo": ficam fora de "Todos os catálogos" e abrem pelo botão 🔥
const PROMO = '__promo';
const isPromo = (p) => p.tipo === 'promo';
const catBooks = () => books.filter((b) => b.tipo !== 'promo');
const promoBooks = () => books.filter((b) => b.tipo === 'promo');
// Páginas do catálogo escolhido (ou de todos), na ordem em que o visualizador passa por elas
const seq = () => (bookFilter === PROMO ? pages.filter(isPromo)
  : bookFilter ? pages.filter((p) => p.book === bookFilter)
  : pages.filter((p) => !isPromo(p)));

// Favoritos guardados por catálogo + página, para não mudarem quando entrar um catálogo novo
let favs = new Set();
try { favs = new Set(JSON.parse(localStorage.getItem('favs2') || '[]')); } catch {}
const saveFavs = () => { try { localStorage.setItem('favs2', JSON.stringify([...favs])); } catch {} };
const isFav = (n) => favs.has(pageKey(pages[n - 1]));
function toggleFav(n) {
  const k = pageKey(pages[n - 1]);
  favs.has(k) ? favs.delete(k) : favs.add(k);
  saveFavs();
}

async function init() {
  try {
    let publicados = [];
    try {
      const res = await fetch('catalogos.json', { cache: 'no-cache' });
      if (res.ok) publicados = await res.json();
    } catch {}
    const lista = (await Promise.all(publicados.map(async (b) => {
      try {
        const r = await fetch(`catalogos/${b.id}/indice.json`, { cache: 'no-cache' });
        return r.ok ? { book: b, indice: await r.json() } : null;
      } catch { return null; }
    }))).filter(Boolean);
    lista.push(...(await loadLocalBooks()));
    books = lista.map((l) => l.book);
    pages = [];
    for (const { book, indice } of lista) {
      for (const p of indice) {
        pages.push({
          n: pages.length + 1, book: book.id, tipo: book.tipo || '', arquivo: p.arquivo,
          pn: p.pn, titulo: p.titulo, texto: p.texto,
          ntitulo: norm(p.titulo).replace(/[^a-z0-9]+/g, ' '), ntexto: norm(p.texto),
        });
      }
    }
    if (!pages.length) throw new Error('nenhum catálogo encontrado. Use ⬆ Importar para adicionar um PDF');
  } catch (e) {
    $('status').textContent = 'Não foi possível carregar o catálogo (' + e.message + ').';
    return;
  }
  try { bookFilter = localStorage.getItem('book') || ''; } catch {}
  if (bookFilter === PROMO ? !promoBooks().length : !bookById(bookFilter)) bookFilter = '';
  fillBookBtn();
  loadCats();
  render();
}

// ---- 📚 Escolher catálogo ----
function fillBookBtn() {
  const b = bookById(bookFilter), cb = catBooks();
  $('book-btn').textContent = `📚 ${b && !b.tipo ? b.nome : cb.length > 1 ? 'Todos os catálogos' : (cb[0]?.nome || 'Catálogo')} ▾`;
  $('book-btn').classList.toggle('active-cat', !!b && !b.tipo && cb.length > 1);
  $('promo-btn').classList.toggle('promo-on', bookFilter === PROMO);
}
function pickBook(id) {
  bookFilter = id;
  try { localStorage.setItem('book', id); } catch {}
  $('book-menu').hidden = true;
  $('v-list').replaceChildren();  // a rolagem contínua é montada de novo para o catálogo escolhido
  fillBookBtn();
  render();
}
function openBookMenu() {
  const menu = $('book-menu');
  const total = pages.filter((p) => !isPromo(p)).length;
  menu.replaceChildren(button(`Todos os catálogos  (${total} pág.)`, bookFilter ? '' : 'on', () => pickBook('')));
  for (const b of catBooks()) {
    menu.append(button(`${b.nome}  (${b.paginas} pág.)${b.local ? '  · importado' : ''}`, b.id === bookFilter ? 'on' : '', () => pickBook(b.id)));
  }
  menu.hidden = false;
}
$('book-btn').onclick = (e) => { e.stopPropagation(); $('book-menu').hidden ? openBookMenu() : ($('book-menu').hidden = true); };
document.addEventListener('click', (e) => { if (!$('book-menu').contains(e.target)) $('book-menu').hidden = true; });

function render() {
  const q = norm($('search').value.trim());
  let list = seq();
  if (mode === 'fav') list = list.filter((p) => favs.has(pageKey(p)));
  if (catFilter && !editing) { const set = catPages(catFilter); list = list.filter((p) => set.has(p.n)); }
  const conteudo = $('search-mode').value === 'conteudo';
  // Modo "Nome": palavras com número são códigos (procurados na página toda); o resto busca só no nome do produto.
  // Modo "Conteúdo": procura em toda a ficha.
  if (q) list = list.filter((p) => q.split(/\s+/).every((w) =>
    conteudo ? (p.ntitulo + ' ' + p.ntexto).includes(w)
             : (/\d/.test(w) ? ' ' + p.ntexto : ' ' + p.ntitulo).includes(' ' + w)));
  const un = bookFilter === PROMO ? ['promoção(ões)', 'promoções'] : ['página(s)', 'páginas'];
  $('status').textContent = q || mode === 'fav' || catFilter ? `${list.length} ${un[0]} encontrada(s)` : `${list.length} ${un[1]}`;

  const showBook = catBooks().length > 1 && !bookFilter;
  const grid = $('grid');
  grid.innerHTML = '';
  if (!list.length) {
    $('status').textContent = '';
    grid.innerHTML = `<div class="empty">${mode === 'fav' && !q
      ? 'Nenhum favorito ainda. Toque na ☆ de uma página para guardar aqui.'
      : bookFilter === PROMO && !q ? 'Nenhuma promoção no momento. Use ⬆ Importar para adicionar.'
      : catFilter && !q ? 'Esta categoria ainda não tem páginas. Use ⚙ → Escolher páginas.'
      : 'Nada encontrado. Tente outra palavra, mude para "Conteúdo da ficha" ou escolha "Todos os catálogos" em 📚.'}</div>`;
  }
  for (const p of list) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<img loading="lazy" src="${miniUrl(p.n)}" alt="">
      <div class="info">${isPromo(p) ? `<b>${esc(p.titulo)}</b>` : `<b>Pág. ${p.pn}</b> ${esc(p.titulo)}`}${showBook ? `<div class="book">${esc(bookOf(p).nome)}</div>` : ''}${q ? `<div class="snip">${snippet(p, q)}</div>` : ''}</div>`;
    const star = document.createElement('button');
    star.className = 'star';
    star.textContent = isFav(p.n) ? '★' : '☆';
    star.onclick = (e) => {
      e.stopPropagation();
      toggleFav(p.n);
      star.textContent = isFav(p.n) ? '★' : '☆';
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

// ---- Visualizador ----
// Modo de leitura: 'uma' (uma página por vez) ou 'continuo' (páginas uma embaixo da outra, rolando)
let leitura = 'uma';
try { leitura = localStorage.getItem('leitura') || 'uma'; } catch {}

function setCurrent(n) {
  current = n;
  const p = pages[n - 1], b = bookOf(p), s = seq(), i = s.indexOf(p);
  $('v-title').textContent = isPromo(p)
    ? `🔥 ${p.titulo} (${i + 1} de ${s.length})`
    : `${catBooks().length > 1 ? b.nome + ' · ' : ''}Página ${p.pn} de ${b.paginas} — ${p.titulo}`;
  $('v-fav').textContent = isFav(n) ? '★' : '☆';
  $('side-prev').disabled = i <= 0;
  $('side-next').disabled = i < 0 || i >= s.length - 1;
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
    const s = seq(), i = s.indexOf(pages[n - 1]);
    for (const k of [i + 1, i - 1, i + 2]) if (s[k]) preload(telaUrl(s[k].n));
    $('v-wrap').scrollTo(0, 0);
  } else {
    buildList();
    $('v-list').querySelector(`[data-n="${n}"]`)?.scrollIntoView();
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

// Rolagem contínua: todas as páginas do catálogo empilhadas; carrega as imagens conforme aparecem
const pageSeen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) setCurrent(+e.target.dataset.n);
  }
}, { root: $('v-wrap'), threshold: 0.5 });

function buildList() {
  const list = $('v-list');
  if (list.children.length) return;
  pageSeen.disconnect();
  for (const p of seq()) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = telaUrl(p.n);
    img.dataset.n = p.n;
    img.onload = () => img.setAttribute('data-loaded', '');
    list.append(img);
    pageSeen.observe(img);
  }
}

function goTo(delta) {
  const s = seq(), i = s.indexOf(pages[current - 1]) + delta;
  if (!s[i]) return;
  if (leitura === 'uma') openViewer(s[i].n);
  else $('v-list').querySelector(`[data-n="${s[i].n}"]`)?.scrollIntoView({ behavior: 'smooth' });
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
$('h-uma').onclick = () => { setLeitura('uma'); openViewer(seq()[0].n); };
$('h-cont').onclick = () => { setLeitura('continuo'); openViewer(seq()[0].n); };
marcarLeitura();
$('m-uma').onclick = () => setLeitura('uma');
$('m-cont').onclick = () => setLeitura('continuo');
$('v-close').onclick = () => { $('viewer').hidden = true; render(); };
$('v-prev').onclick = () => goTo(-1);
$('v-next').onclick = () => goTo(1);
$('side-prev').onclick = () => goTo(-1);
$('side-next').onclick = () => goTo(1);
$('v-fav').onclick = () => { toggleFav(current); $('v-fav').textContent = isFav(current) ? '★' : '☆'; };

// Deslizar para trocar de página (só sem zoom)
let sx = null;
$('v-wrap').addEventListener('touchstart', (e) => { sx = e.touches.length === 1 && visualViewport.scale <= 1 ? e.touches[0].clientX : null; });
$('v-wrap').addEventListener('touchend', (e) => {
  if (sx === null || leitura !== 'uma') return;
  const dx = e.changedTouches[0].clientX - sx;
  if (dx > 80) goTo(-1);
  if (dx < -80) goTo(1);
});

const label = () => {
  const p = pages[current - 1];
  return isPromo(p) ? `Promoção MS Brasil: ${p.titulo}` : `${p.titulo} — página ${p.pn} do catálogo ${bookOf(p).nome}`;
};
// Arquivo da página para enviar/baixar. Promoção em imagem vai como imagem; o resto como PDF.
const pageFile = async () => {
  const p = pages[current - 1];
  const blob = await pageBlob(current);
  const nome = (p.titulo || bookOf(p).nome + ' - pagina ' + p.pn).replace(/[\\/:*?"<>|]/g, '-');
  if (blob.type.startsWith('image/')) return new File([blob], `${nome}.${blob.type === 'image/png' ? 'png' : 'jpg'}`, { type: blob.type });
  return asPdf(blob, nome + '.pdf');
};

$('v-zap').onclick = async () => {
  // Envia o PDF da página pelo menu do sistema (onde aparece o WhatsApp); sem suporte, manda só o texto.
  if (!(await shareFile(await pageFile(), label())))
    window.open('https://wa.me/?text=' + encodeURIComponent(label()), '_blank');
};
$('v-mail').onclick = () => {
  location.href = 'mailto:?subject=' + encodeURIComponent(bookOf(pages[current - 1]).nome + ' — ' + pages[current - 1].titulo) +
    '&body=' + encodeURIComponent(label());
};
$('v-share').onclick = async () => {
  if (!(await shareFile(await pageFile(), label()))) toast('Este aparelho não permite compartilhar arquivos. Use "Baixar página".');
};
$('v-down').onclick = async () => download(await pageFile());

// Enviar/Baixar do topo: o catálogo escolhido em 📚 (ou o único que existir)
function chosenBook() {
  const cb = catBooks();
  const b = bookFilter === PROMO ? (promoBooks().find((x) => !x.local) || promoBooks()[0])
    : bookById(bookFilter) || (cb.length === 1 ? cb[0] : null);
  if (!b) { toast('Escolha um catálogo em 📚 para enviar ou baixar.'); openBookMenu(); }
  return b;
}
$('share-all').onclick = async (e) => {
  e.stopPropagation();
  const b = chosenBook();
  if (!b) return;
  $('status').textContent = 'Preparando catálogo…';
  const f = asPdf(await catalogBlob(b.id), b.nome + '.pdf');
  render();
  if (!(await shareFile(f, b.nome))) toast('Este aparelho não permite compartilhar arquivos. Use "Baixar".');
};
$('download-all').onclick = async (e) => {
  e.stopPropagation();
  const b = chosenBook();
  if (!b) return;
  $('status').textContent = 'Baixando catálogo…';
  download(asPdf(await catalogBlob(b.id), b.nome + '.pdf'));
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

// Cada item guarda o nome do produto (t), o catálogo (b) e a página nele (p).
// Procura primeiro a mesma página com o mesmo nome; se o catálogo mudou, procura o nome no mesmo catálogo
// e depois em qualquer catálogo. (Itens antigos só têm n e t.)
function findCatItem(x) {
  const same = x.b && pages.find((p) => p.book === x.b && p.pn === x.p);
  if (same && (!x.t || same.titulo === x.t)) return same;
  if (x.t) return pages.find((p) => p.titulo === x.t && (!x.b || p.book === x.b)) || pages.find((p) => p.titulo === x.t);
  return same || null;
}
function catPages(name) {
  const set = new Set();
  for (const x of cats[name] || []) {
    const p = findCatItem(x);
    if (p) set.add(p.n);
  }
  return set;
}
function toggleCatPage(name, p) {
  const list = cats[name];
  const i = list.findIndex((x) => findCatItem(x) === p);
  if (i >= 0) list.splice(i, 1); else list.push({ t: p.titulo, b: p.book, p: p.pn });
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
  const data = { nome: name, i: cats[name].map((x) => [x.t || '', x.b || '', x.p || 0]) };
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
    const itens = d.i
      ? d.i.map(([t, b, p]) => ({ t: String(t), b: String(b), p: +p }))
      : d.p.map(([n, t]) => ({ n: +n, t: String(t) })); // links do formato antigo
    incoming = { nome: String(d.nome).slice(0, 60), itens };
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
// As promoções são um catálogo do tipo "promo" (ver preparar.py e local.js), com as mesmas opções dos outros.
// O botão 🔥 liga e desliga a visão das promoções.
$('promo-btn').onclick = () => pickBook(bookFilter === PROMO ? '' : PROMO);

// ---- Busca e abas ----
let t;
$('search').oninput = () => { clearTimeout(t); t = setTimeout(render, 200); };
$('search-mode').onchange = render;
$('clear').onclick = () => { $('search').value = ''; render(); $('search').focus(); };
$('tab-all').onclick = () => { mode = 'all'; $('tab-all').classList.add('on'); $('tab-fav').classList.remove('on'); render(); };
$('tab-fav').onclick = () => { mode = 'fav'; $('tab-fav').classList.add('on'); $('tab-all').classList.remove('on'); render(); };

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
init();
