/* ==========================================================
   Editor de blocos (comportamento do Notion)

   Princípio central: cada bloco tem um nó de DOM próprio e persistente.
   Digitar NUNCA recria o DOM, então o cursor nunca pula. O DOM só é
   reconciliado quando a estrutura muda (criar, remover, reordenar).
   ========================================================== */
const Editor = (() => {
  let blocks = [];        // [{id, type, text, done, src, file, el, textEl, markerEl}]
  let root = null, fileInput = null, onChange = () => {};

  const uid = () => 'b' + Math.random().toString(36).slice(2, 9);

  const TYPES = {
    p:      { label:'Texto',                hint:'parágrafo simples',   kw:'texto paragrafo' },
    todo:   { label:'Lista de tarefas',     hint:'caixa de seleção',    kw:'tarefa todo multitask checkbox caixa' },
    num:    { label:'Lista numerada',       hint:'1. 2. 3.',            kw:'numerada numero lista ordenada' },
    bullet: { label:'Lista com marcadores', hint:'tópicos',             kw:'topico marcador bullet lista' },
    img:    { label:'Imagem',               hint:'câmera ou galeria',   kw:'imagem foto anexo galeria camera' },
  };
  const MENU_ORDER = ['p','todo','num','bullet','img'];

  /* ---------- cursor ---------- */
  function caretOffset(el){
    const sel = window.getSelection();
    if(!sel.rangeCount) return 0;
    const r = sel.getRangeAt(0).cloneRange();
    r.selectNodeContents(el);
    r.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
    return r.toString().length;
  }
  function setCaret(el, offset){
    el.focus();
    const node = el.firstChild;
    const r = document.createRange(), sel = window.getSelection();
    if(!node){ r.selectNodeContents(el); r.collapse(true); }
    else{
      const max = node.textContent.length;
      r.setStart(node, Math.max(0, Math.min(offset, max)));
      r.collapse(true);
    }
    sel.removeAllRanges(); sel.addRange(r);
  }
  function atStart(el){ return caretOffset(el) === 0; }

  /* ---------- ciclo de vida ---------- */
  function init(rootEl, inputEl, changeCb){
    root = rootEl; fileInput = inputEl; onChange = changeCb || (()=>{});
    fileInput.addEventListener('change', onFilesPicked);
    root.addEventListener('click', e => {
      // clicar na área vazia abaixo cria/foca o último bloco de texto
      if(e.target !== root) return;
      const last = blocks[blocks.length-1];
      if(last && last.type !== 'img') focus(last, last.text.length);
      else insertAfter(last, 'p');
    });
  }

  function load(content){
    blocks = (content && content.length ? content : [{ type:'p', text:'' }])
      .map(b => make({ ...b, id: b.id || uid() }));
    mount();
  }

  function make(data){
    const b = {
      id: data.id || uid(),
      type: data.type || 'p',
      text: data.text || '',
      done: !!data.done,
      src: data.src || null,
      file: data.file || null,
    };
    buildEl(b);
    return b;
  }

  /* ---------- construção do nó ---------- */
  function buildEl(b){
    const el = document.createElement('div');
    el.className = 'ed-block' + (b.type === 'img' ? ' ed-block-img' : '');
    el.dataset.id = b.id;

    const handle = document.createElement('span');
    handle.className = 'ed-handle';
    handle.draggable = true;
    handle.textContent = '⠿';
    handle.title = 'Arraste para reordenar';
    el.appendChild(handle);
    wireDrag(b, handle, el);

    const marker = document.createElement('span');
    marker.className = 'ed-marker';
    el.appendChild(marker);

    const main = document.createElement('div');
    main.className = 'ed-main';
    el.appendChild(main);

    b.el = el; b.markerEl = marker; b.mainEl = main;

    if(b.type === 'img') buildImage(b);
    else buildText(b);

    paintMarker(b);
    return el;
  }

  function buildText(b){
    const t = document.createElement('div');
    t.className = 'ed-text';
    t.contentEditable = 'true';
    t.textContent = b.text;
    t.addEventListener('input', () => onInput(b));
    t.addEventListener('keydown', e => onKeydown(e, b));
    t.addEventListener('paste', e => onPaste(e, b));
    t.addEventListener('focus', () => updatePlaceholders());
    t.addEventListener('blur', () => { updatePlaceholders(); onChange(); });
    b.textEl = t;
    b.mainEl.appendChild(t);
    applyDone(b);
  }

  function buildImage(b){
    const wrap = document.createElement('div');
    wrap.className = 'ed-img';
    const img = document.createElement('img');
    img.src = b.file ? URL.createObjectURL(b.file) : b.src;
    img.addEventListener('click', () => {
      const lb = document.createElement('div');
      lb.className = 'lightbox';
      lb.innerHTML = `<img src="${img.src}">`;
      lb.addEventListener('click', () => lb.remove());
      document.body.appendChild(lb);
    });
    const x = document.createElement('button');
    x.className = 'ed-img-x'; x.textContent = '✕'; x.title = 'Remover';
    x.addEventListener('click', () => remove(b));
    wrap.append(img, x);
    b.mainEl.appendChild(wrap);
  }

  /* ---------- marcador (checkbox, número, bullet) ---------- */
  function paintMarker(b){
    const m = b.markerEl;
    m.innerHTML = '';
    m.className = 'ed-marker';
    if(b.type === 'todo'){
      const c = document.createElement('button');
      c.className = 'ed-check' + (b.done ? ' on' : '');
      c.textContent = b.done ? '✓' : '';
      c.addEventListener('click', () => {
        b.done = !b.done;
        c.classList.toggle('on', b.done);
        c.textContent = b.done ? '✓' : '';
        applyDone(b); onChange();
      });
      m.appendChild(c);
    } else if(b.type === 'num'){
      m.className = 'ed-marker ed-num';
    } else if(b.type === 'bullet'){
      m.className = 'ed-marker ed-bullet';
      m.textContent = '•';
    }
  }
  function applyDone(b){
    if(b.textEl) b.textEl.classList.toggle('done', b.type === 'todo' && b.done);
  }

  /* troca de tipo sem destruir o campo de texto (cursor preservado) */
  function setType(b, type){
    if(b.type === type) return;
    b.type = type;
    if(type !== 'todo') b.done = false;
    b.el.classList.toggle('ed-block-img', type === 'img');
    paintMarker(b); applyDone(b); renumber(); updatePlaceholders();
    onChange();
  }

  /* ---------- reconciliação do DOM ---------- */
  function mount(){
    const frag = document.createDocumentFragment();
    blocks.forEach(b => frag.appendChild(b.el));   // appendChild move, não recria
    root.innerHTML = '';
    root.appendChild(frag);

    const add = document.createElement('button');
    add.className = 'ed-add';
    add.textContent = '+ Adicionar bloco';
    add.addEventListener('click', () => {
      const nb = make({ type:'p', text:'' });
      blocks.push(nb); mount(); focus(nb, 0);
    });
    root.appendChild(add);

    renumber(); updatePlaceholders();
  }

  function renumber(){
    let n = 0;
    for(const b of blocks){
      if(b.type === 'num'){ n++; b.markerEl.textContent = n + '.'; }
      else n = 0;
    }
  }

  /* placeholder só no bloco focado, ou no primeiro se o editor está vazio */
  function updatePlaceholders(){
    const only = blocks.length === 1 && blocks[0].type === 'p' && !blocks[0].text;
    for(const b of blocks){
      if(!b.textEl) continue;
      const focused = document.activeElement === b.textEl;
      let ph = '';
      if(only) ph = 'Escreva algo, ou digite / para comandos';
      else if(focused && !b.text){
        ph = b.type === 'todo' ? 'A fazer' :
             b.type === 'num' ? 'Item da lista' :
             b.type === 'bullet' ? 'Item' : 'Digite / para comandos';
      }
      b.textEl.dataset.ph = ph;
    }
  }

  function focus(b, offset){
    if(!b || !b.textEl) return;
    setCaret(b.textEl, offset == null ? b.text.length : offset);
    updatePlaceholders();
  }

  function indexOf(b){ return blocks.indexOf(b); }

  function insertAfter(b, type, text){
    const nb = make({ type: type || 'p', text: text || '' });
    const i = b ? indexOf(b) + 1 : blocks.length;
    blocks.splice(i, 0, nb);
    mount(); focus(nb, 0); onChange();
    return nb;
  }

  function remove(b){
    const i = indexOf(b);
    blocks.splice(i, 1);
    if(!blocks.length) blocks = [make({ type:'p', text:'' })];
    mount();
    const prev = blocks[Math.max(0, i-1)];
    if(prev && prev.textEl) focus(prev, prev.text.length);
    onChange();
  }

  /* ---------- digitação ---------- */
  function onInput(b){
    b.text = b.textEl.textContent;

    // menu aberto: filtra conforme se digita depois da barra
    if(menu.open && menu.block === b){
      const after = b.text.slice(menu.slashAt + 1);
      if(after.includes(' ') || menu.slashAt >= b.text.length){ closeMenu(); }
      else { filterMenu(after); return; }
    }

    // atalhos no começo da linha
    const rules = [
      [/^\[\]\s$/,   'todo', false],
      [/^\[x\]\s$/i, 'todo', true],
      [/^1\.\s$/,    'num',  false],
      [/^[-*]\s$/,   'bullet', false],
      [/^\[\s?\]\s$/,'todo', false],
    ];
    for(const [re, type, done] of rules){
      if(re.test(b.text)){
        b.text = ''; b.textEl.textContent = '';
        b.done = done;
        setType(b, type);
        focus(b, 0);
        return;
      }
    }
    updatePlaceholders();
    onChange();
  }

  function onKeydown(e, b){
    if(menu.open && menu.block === b){
      if(handleMenuKeys(e)) return;
    }

    // "/" abre o menu de blocos
    if(e.key === '/'){
      const off = caretOffset(b.textEl);
      setTimeout(() => openMenu(b, off), 0);
      return;
    }

    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      const off = caretOffset(b.textEl);
      const before = b.text.slice(0, off), after = b.text.slice(off);

      // Enter em item de lista vazio: sai da lista
      if(b.type !== 'p' && !b.text.trim()){
        setType(b, 'p'); focus(b, 0); return;
      }
      b.text = before; b.textEl.textContent = before;
      const nb = insertAfter(b, b.type === 'img' ? 'p' : b.type, after);
      if(nb.type === 'todo') nb.done = false;
      focus(nb, 0);
      return;
    }

    if(e.key === 'Backspace' && atStart(b.textEl)){
      const i = indexOf(b);
      // primeiro desfaz o tipo de lista
      if(b.type !== 'p'){ e.preventDefault(); setType(b, 'p'); focus(b, 0); return; }
      if(i === 0) return;
      const prev = blocks[i-1];
      e.preventDefault();
      if(prev.type === 'img'){ remove(prev); return; }
      // funde com o bloco anterior, como no Notion
      const at = prev.text.length;
      prev.text = prev.text + b.text;
      prev.textEl.textContent = prev.text;
      blocks.splice(i, 1);
      mount(); focus(prev, at); onChange();
      return;
    }

    if(e.key === 'ArrowUp'){
      const i = indexOf(b);
      if(atStart(b.textEl) && i > 0){
        const prev = blocks[i-1];
        if(prev.textEl){ e.preventDefault(); focus(prev, prev.text.length); }
      }
      return;
    }
    if(e.key === 'ArrowDown'){
      const i = indexOf(b);
      if(caretOffset(b.textEl) === b.text.length && i < blocks.length-1){
        const nx = blocks[i+1];
        if(nx.textEl){ e.preventDefault(); focus(nx, 0); }
      }
      return;
    }

    // Tab não deve sair do editor no meio da escrita
    if(e.key === 'Tab'){ e.preventDefault(); }
  }

  /* colar sempre como texto puro, sem trazer formatação */
  function onPaste(e, b){
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if(!text) return;
    const lines = text.split(/\r?\n/).filter((l,i,a) => l.trim() !== '' || i < a.length-1);
    const off = caretOffset(b.textEl);
    const before = b.text.slice(0, off), after = b.text.slice(off);

    if(lines.length <= 1){
      b.text = before + text + after;
      b.textEl.textContent = b.text;
      focus(b, (before + text).length);
      onChange();
      return;
    }
    // várias linhas viram vários blocos, detectando o tipo de lista em cada uma
    const detect = (raw, fallback) => {
      let m;
      if((m = raw.match(/^\s*\[( |x)\]\s+(.*)$/i))) return { type:'todo', text:m[2], done:/x/i.test(m[1]) };
      if((m = raw.match(/^\s*\d+[.)]\s+(.*)$/)))     return { type:'num',  text:m[1], done:false };
      if((m = raw.match(/^\s*[-*•]\s+(.*)$/)))        return { type:'bullet', text:m[1], done:false };
      return { type: fallback, text: raw, done:false };
    };

    let cur = b;
    // a primeira linha entra no bloco atual; se ele estava vazio, também vale a detecção
    const first = detect(lines[0], b.type === 'img' ? 'p' : b.type);
    if(!before.trim() && first.type !== b.type){
      b.text = first.text; b.done = first.done;
      b.textEl.textContent = b.text;
      setType(b, first.type);
    } else {
      b.text = before + lines[0];
      b.textEl.textContent = b.text;
    }

    for(let i=1;i<lines.length;i++){
      const parsed = detect(lines[i], cur.type === 'img' ? 'p' : cur.type);
      const nb = make({ type: parsed.type, text: parsed.text, done: parsed.done });
      blocks.splice(indexOf(cur)+1, 0, nb);
      cur = nb;
    }
    if(after){ cur.text += after; }
    mount(); focus(cur, cur.text.length - after.length); onChange();
  }

  /* ---------- menu do "/" ---------- */
  const menu = { open:false, el:null, block:null, slashAt:0, items:[], sel:0 };

  function openMenu(b, slashAt){
    closeMenu();
    menu.open = true; menu.block = b; menu.slashAt = slashAt; menu.sel = 0;

    const el = document.createElement('div');
    el.className = 'ed-menu';
    document.body.appendChild(el);
    menu.el = el;
    filterMenu('');

    const r = b.textEl.getBoundingClientRect();
    const h = el.offsetHeight;
    const below = window.innerHeight - r.bottom > h + 12;
    el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 248)) + 'px';
    el.style.top  = (below ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px';
  }

  function filterMenu(q){
    const query = (q||'').toLowerCase().trim();
    menu.items = MENU_ORDER.filter(t => {
      if(!query) return true;
      const d = TYPES[t];
      return (d.label + ' ' + d.kw).toLowerCase().includes(query);
    });
    if(!menu.items.length){ closeMenu(); return; }
    menu.sel = Math.min(menu.sel, menu.items.length - 1);
    paintMenu();
  }

  function paintMenu(){
    if(!menu.el) return;
    menu.el.innerHTML = `<div class="ed-menu-head">BLOCOS</div>` + menu.items.map((t,i)=>{
      const d = TYPES[t];
      return `<button class="ed-menu-item ${i===menu.sel?'sel':''}" data-type="${t}">
        <span class="l">${d.label}</span><span class="h">${d.hint}</span></button>`;
    }).join('');
    menu.el.querySelectorAll('[data-type]').forEach(btn => {
      btn.addEventListener('mousedown', ev => { ev.preventDefault(); pick(btn.dataset.type); });
    });
  }

  function handleMenuKeys(e){
    if(e.key === 'Escape'){ e.preventDefault(); closeMenu(); return true; }
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      menu.sel = (menu.sel + (e.key==='ArrowDown'?1:menu.items.length-1)) % menu.items.length;
      paintMenu(); return true;
    }
    if(e.key === 'Enter'){ e.preventDefault(); pick(menu.items[menu.sel]); return true; }
    if(e.key === 'Backspace'){
      const b = menu.block;
      if(caretOffset(b.textEl) <= menu.slashAt + 1) closeMenu();
      return false;
    }
    return false;
  }

  function closeMenu(){
    if(menu.el){ menu.el.remove(); menu.el = null; }
    menu.open = false; menu.block = null;
  }

  function pick(type){
    const b = menu.block, at = menu.slashAt;
    closeMenu();
    if(!b) return;
    // remove o "/" e o que foi digitado depois dele
    const before = b.text.slice(0, at), after = '';
    b.text = before + after;
    b.textEl.textContent = b.text;

    if(type === 'img'){ pendingAt = indexOf(b); fileInput.click(); return; }
    setType(b, type);
    focus(b, b.text.length);
  }

  /* ---------- imagens ---------- */
  let pendingAt = null;
  function onFilesPicked(e){
    const files = [...e.target.files].filter(f => /^image\//.test(f.type));
    e.target.value = '';
    if(!files.length){ pendingAt = null; return; }

    const target = pendingAt != null ? blocks[pendingAt] : null;
    const newOnes = files.map(f => make({ type:'img', file:f }));

    if(target && target.type === 'p' && !target.text.trim()){
      blocks.splice(pendingAt, 1, ...newOnes);       // substitui o bloco vazio
    } else {
      const at = pendingAt != null ? pendingAt + 1 : blocks.length;
      blocks.splice(at, 0, ...newOnes);
    }
    // sempre deixa um parágrafo depois da última imagem para continuar escrevendo
    const last = blocks[blocks.length-1];
    if(last && last.type === 'img') blocks.push(make({ type:'p', text:'' }));

    pendingAt = null;
    mount();
    const after = blocks[blocks.indexOf(newOnes[newOnes.length-1]) + 1];
    if(after && after.textEl) focus(after, 0);
    onChange();
  }

  function addImage(){ pendingAt = null; fileInput.click(); }

  /* ---------- arrastar ---------- */
  let dragging = null;
  function wireDrag(b, handle, el){
    handle.addEventListener('dragstart', e => {
      dragging = b;
      e.dataTransfer.effectAllowed = 'move';
      try{ e.dataTransfer.setData('text/plain', b.id); }catch{}
      el.classList.add('dragging');
    });
    handle.addEventListener('dragend', () => {
      dragging = null;
      root.querySelectorAll('.ed-block').forEach(x => x.classList.remove('dragging','over-top','over-bottom'));
    });
    el.addEventListener('dragover', e => {
      if(!dragging || dragging === b) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const below = e.clientY > r.top + r.height/2;
      root.querySelectorAll('.ed-block').forEach(x => x.classList.remove('over-top','over-bottom'));
      el.classList.add(below ? 'over-bottom' : 'over-top');
    });
    el.addEventListener('drop', e => {
      if(!dragging || dragging === b) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const below = e.clientY > r.top + r.height/2;
      const moved = dragging;
      blocks.splice(indexOf(moved), 1);
      let to = indexOf(b) + (below ? 1 : 0);
      blocks.splice(to, 0, moved);
      dragging = null;
      mount(); onChange();
    });
  }

  /* ---------- saída ---------- */
  function serialize(){
    const files = [];
    const out = [];
    for(const b of blocks){
      if(b.type === 'img'){
        if(b.file){ files.push(b.file); out.push({ id:b.id, type:'img', ref:'new:'+(files.length-1) }); }
        else if(b.src) out.push({ id:b.id, type:'img', src:b.src });
        continue;
      }
      const text = (b.text || '').trim();
      if(!text) continue;
      out.push({ id:b.id, type:b.type, text, ...(b.type==='todo'?{done:!!b.done}:{}) });
    }
    return { blocks: out, files };
  }

  function getBlocks(){ return blocks.map(b => ({ id:b.id, type:b.type, text:b.text, done:b.done, src:b.src })); }

  return { init, load, serialize, addImage, getBlocks };
})();

window.Editor = Editor;
