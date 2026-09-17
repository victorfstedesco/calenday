/* ==========================================================
   Calenday — front-end
   ========================================================== */

const API = '/api';
const $ = id => document.getElementById(id);

/* ---------- utilitários de data ---------- */
/* precisam vir antes de S, que chama ymd() na inicialização */
const pad = n => String(n).padStart(2,'0');
function ymd(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function parse(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function addDays(d,n){ const c=new Date(d); c.setDate(c.getDate()+n); return c; }
function startOfWeek(d){ return addDays(d, -d.getDay()); }
function sameYmd(a,b){ return ymd(a)===ymd(b); }
const MONTHS=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const MON_SHORT=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const DOW_SHORT=['DOM','SEG','TER','QUA','QUI','SEX','SÁB'];

const S = {
  user: null,
  mode: 'login',
  view: 'week',          // week | month | list
  calView: 'week',        // qual calendário mostrar ao voltar do modo lista
  cursor: new Date(),     // mês/semana em foco
  selected: ymd(new Date()),
  items: [],
  editing: null,          // item sendo editado, ou null
  form: { kind:'event', start:null, end:null, picking:'start', pickCursor:new Date(), repeat:'none', priority:1, nag:false },
};


function fmtShort(s){ const d=parse(s); return `${d.getDate()} ${MON_SHORT[d.getMonth()]}`; }
function fmtLong(s){
  const d=parse(s);
  const w=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'][d.getDay()];
  return `${w}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}
function isMulti(it){ return (it.repeat||'none')==='none' && it.start_date !== it.end_date; }
function isRepeating(it){ return (it.repeat||'none') !== 'none'; }

/* o item acontece neste dia? (considera a regra de repetição) */
function coversDay(it, dstr){ return Recurrence.occursOn(it, dstr); }

/* concluído naquele dia específico */
function isDone(it, dstr){
  return (it.completions||[]).includes(dstr || it.start_date);
}

/* itens de um dia, já ordenados por prioridade e horário */
function itemsOn(dstr){
  return S.items.filter(it=>coversDay(it,dstr)).sort((a,b)=>
    (b.priority??1)-(a.priority??1) ||
    (a.time?0:1)-(b.time?0:1) ||
    (a.time||'').localeCompare(b.time||'')
  );
}

/* quando mostrar o item: horário, intervalo ou dia inteiro */
function whenLabel(it){
  const bits=[];
  if(isRepeating(it)) bits.push(Recurrence.repeatLabel(it.repeat));
  else if(isMulti(it)) bits.push(`${fmtShort(it.start_date)} a ${fmtShort(it.end_date)}`);
  bits.push(it.time ? it.time : 'dia inteiro');
  return bits.join(' · ');
}
/* classe visual: intervalo de dias tem cor própria */


function esc(s){ const d=document.createElement('div'); d.textContent=s==null?'':s; return d.innerHTML; }

let toastTimer;
function toast(msg){
  const t=$('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),2200);
}

/* ---------- API ---------- */
async function api(path, opts={}){
  const res = await fetch(API+path, opts);
  let data={};
  try{ data = await res.json(); }catch{}
  if(!res.ok) throw new Error(data.error || 'Erro na requisição');
  return data;
}

/* ==========================================================
   AUTENTICAÇÃO
   ========================================================== */
async function boot(){
  try{
    const { user } = await api('/auth/me');
    if(user){ S.user=user; showApp(); return; }
  }catch{}
  showAuth();
}

function showAuth(){
  $('auth').classList.remove('hidden');
  $('app').classList.add('hidden');
}
function showApp(){
  $('auth').classList.add('hidden');
  $('app').classList.remove('hidden');
  loadItems();
  setupPush();
}

$('a-switch').addEventListener('click', ()=>{
  S.mode = S.mode==='login' ? 'register' : 'login';
  const reg = S.mode==='register';
  $('auth-sub').textContent = reg ? 'Crie sua conta para começar' : 'Seus compromissos e demandas num lugar só';
  $('a-submit').textContent = reg ? 'Cadastrar' : 'Entrar';
  $('a-email-f').classList.toggle('hidden', !reg);
  $('a-switch-txt').textContent = reg ? 'Já tem conta?' : 'Não tem conta?';
  $('a-switch').textContent = reg ? 'Entrar' : 'Cadastre-se';
  $('a-err').textContent='';
});

async function submitAuth(){
  const username=$('a-user').value.trim();
  const password=$('a-pass').value;
  const email=$('a-email').value.trim();
  const err=$('a-err'); err.textContent='';
  if(!username||!password){ err.textContent='Preencha usuário e senha'; return; }
  if(S.mode==='register' && !email){ err.textContent='O email é onde você recebe os avisos'; return; }
  try{
    const body = S.mode==='login' ? {username,password} : {username,password,email};
    const endpoint = S.mode==='login' ? '/auth/login' : '/auth/register';
    await api(endpoint, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
    });
  }catch(e){ err.textContent=e.message; return; }
  Editor.init($('f-editor'), $('f-photo'), ()=>{});

boot();
}
$('a-submit').addEventListener('click', submitAuth);
$('a-pass').addEventListener('keydown', e=>{ if(e.key==='Enter') submitAuth(); });

async function logout(){
  await fetch(API+'/auth/logout',{method:'POST'});
  location.reload();
}
$('side-logout').addEventListener('click', logout);

/* ==========================================================
   CARREGAR ITENS
   ========================================================== */
async function loadItems(){
  try{
    const { items } = await api('/items');
    S.items = items;
    render();
  }catch(e){ toast(e.message); }
}

/* ==========================================================
   NAVEGAÇÃO DE VIEWS
   ========================================================== */
function setView(v){
  if(v==='week'||v==='month'||v==='day') S.calView=v;
  S.view=v;
  // o botão de calendário fica aceso em semana, mês e dia
  document.querySelectorAll('#view-toggle [data-view], .sidebar [data-view]').forEach(b=>{
    const isCalBtn = b.dataset.view==='week';
    b.classList.toggle('on', isCalBtn ? (v==='week'||v==='month'||v==='day') : b.dataset.view===v);
  });
  render();
}
document.querySelectorAll('#view-toggle [data-view], .sidebar [data-view]').forEach(b=>{
  b.addEventListener('click',()=>setView(b.dataset.view==='week'?S.calView:b.dataset.view));
});
document.querySelectorAll('[data-new]').forEach(b=>{
  b.addEventListener('click', ()=>openSheet());
});

/* ==========================================================
   RENDER
   ========================================================== */
function render(){
  renderControls();
  document.querySelector('.add-btn').classList.toggle('hidden', S.view==='settings');
  const root=$('view-root');
  if(S.view==='week') renderWeek(root);
  else if(S.view==='month') renderMonth(root);
  else if(S.view==='day') renderDay(root);
  else if(S.view==='settings') renderSettings(root);
  else renderList(root);
}

/* barra de controles abaixo do header (só no modo calendário) */
function renderControls(){
  const c=$('controls');
  if(S.view==='list' || S.view==='settings'){ c.innerHTML=''; return; }
  const isWeek=S.view==='week';
  const isDay=S.view==='day';
  let now;
  if(isWeek){
    const ws=startOfWeek(S.cursor), we=addDays(ws,6);
    now = `${ws.getDate()} ${MON_SHORT[ws.getMonth()]} – ${we.getDate()} ${MON_SHORT[we.getMonth()]}`;
  } else if(isDay){
    now = fmtLong(S.selected);
  } else {
    now = `${MONTHS[S.cursor.getMonth()]} ${S.cursor.getFullYear()}`;
  }
  c.innerHTML=`<div class="controls">
    <div class="seg">
      <button data-cal="day" class="${isDay?'on':''}">Dia</button>
      <button data-cal="week" class="${isWeek?'on':''}">Semana</button>
      <button data-cal="month" class="${S.view==='month'?'on':''}">Mês</button>
    </div>
    <div class="stepper">
      <button class="icon-btn" data-step="-1">‹</button>
      <button class="text-btn" data-step="0">Hoje</button>
      <button class="icon-btn" data-step="1">›</button>
      <span class="now">${now}</span>
    </div>
  </div>`;
  c.querySelectorAll('[data-cal]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.cal)));
  c.querySelectorAll('[data-step]').forEach(b=>b.addEventListener('click',()=>{
    const v=Number(b.dataset.step);
    if(v===0){ S.cursor=new Date(); S.selected=ymd(new Date()); }
    else if(isWeek) S.cursor=addDays(S.cursor, v*7);
    else if(isDay) S.selected=ymd(addDays(parse(S.selected), v));
    else S.cursor=new Date(S.cursor.getFullYear(), S.cursor.getMonth()+v, 1);
    render();
  }));
}

/* prévia do conteúdo em blocos dentro do card */
function contentPreview(it){
  const c = it.content || [];
  if(!c.length) return '';
  const lines = c.filter(b=>b.type!=='img').slice(0,3).map(b=>{
    const mk = b.type==='todo' ? (b.done?'☑':'☐') : b.type==='num' ? '•' : b.type==='bullet' ? '•' : '';
    return `<div class="pl ${b.type==='todo'&&b.done?'done':''}">${mk?`<span class="mk">${mk}</span>`:''}<span>${esc(b.text)}</span></div>`;
  }).join('');
  const hidden = c.filter(b=>b.type!=='img').length - 3;
  const imgs = c.filter(b=>b.type==='img').length;
  const extras=[];
  if(hidden>0) extras.push(`mais ${hidden} linha${hidden>1?'s':''}`);
  if(imgs>0) extras.push(`${imgs} imagem${imgs>1?'ns':''}`);
  return `<div class="preview">${lines}${extras.length?`<div class="more">${extras.join(' · ')}</div>`:''}</div>`;
}

/* progresso das caixas de seleção do conteúdo */
function todoProgress(it){
  const todos = (it.content||[]).filter(b=>b.type==='todo');
  if(!todos.length) return '';
  const done = todos.filter(b=>b.done).length;
  return `<span class="progress">${done}/${todos.length}</span>`;
}

function kindOf(it){ return isMulti(it) ? 'span' : (it.kind==='task'?'task':'event'); }
function pillLabel(it){
  if(isMulti(it)) return 'PERÍODO';
  return it.kind==='task' ? 'TAREFA' : 'EVENTO';
}
function repeatBadge(it){
  if(!isRepeating(it)) return '';
  return `<span class="rep" title="${esc(Recurrence.repeatLabel(it.repeat))}">↻</span>`;
}
function prioBadge(it){
  if((it.priority??1)===2) return `<span class="prio-dot" title="Prioridade alta"></span>`;
  return '';
}

function blockHtml(it, compact, ds){
  const k=kindOf(it);
  const done=isDone(it, ds||it.start_date);
  return `<button class="block ${k} ${done?'done':''} ${(it.priority??1)===2?'high':''}" data-edit="${it.id}">
    <span class="bar"></span>
    <span class="body">
      <span class="t">${prioBadge(it)}${esc(it.title)}${repeatBadge(it)}</span>
      <span class="m">${esc(whenLabel(it))}${(()=>{const n=(it.content||[]).filter(b=>b.type==='img').length;return n?` · ${n} imagem${n>1?'ns':''}`:'';})()}</span>
    </span>
    ${compact?'':`<span class="pill ${k}">${pillLabel(it)}</span>`}
    ${compact?'':todoProgress(it)}
  </button>`;
}

/* grupo com cabeçalho, no estilo das referências */
function groupHtml(title, count, right, bodyHtml){
  return `<div class="group">
    <div class="group-head">
      <span class="n">${title}</span>
      ${count!=null?`<span class="c">${count} ${count===1?'item':'itens'}</span>`:''}
      ${right?`<span class="right">${right}</span>`:''}
    </div>
    <div class="group-body">${bodyHtml}</div>
  </div>`;
}

/* ---------- SEMANA ---------- */
function renderWeek(root){
  const ws=startOfWeek(S.cursor);
  const days=[...Array(7)].map((_,i)=>addDays(ws,i));
  const we=days[6];
  $('page-title').textContent='Calendário';

  const inWeek=S.items.filter(it=> it.start_date<=ymd(we) && it.end_date>=ymd(days[0]));
  $('page-sub').textContent=`${inWeek.length} ${inWeek.length===1?'item':'itens'} nesta semana`;

  const allday=inWeek.filter(it=>!it.time);
  const timed=inWeek.filter(it=>it.time);
  let minH=7, maxH=21;
  for(const it of timed){
    const h=Number(it.time.slice(0,2));
    minH=Math.min(minH,h);
    maxH=Math.max(maxH,h);
  }
  const hours=[...Array(maxH-minH+1)].map((_,i)=>minH+i);

  if(window.matchMedia('(min-width:900px)').matches){
    let h=`<div class="card card-pad"><div class="wk-grid">
      <div class="corner"></div>
      ${days.map(d=>`<div class="col-head ${sameYmd(d,new Date())?'today':''}">
        <div class="l">${DOW_SHORT[d.getDay()]}</div><div class="n">${d.getDate()}</div></div>`).join('')}
    </div>`;
    if(allday.length){
      h+=`<div class="allday-row"><div class="l">DIA<br>INTEIRO</div><div class="slot">
        ${allday.map(it=>blockHtml(it,true,ymd(days[0]))).join('')}</div></div>`;
    }
    h+=`<div class="wk-grid wk-grid-hours" data-tlgrid data-basehour="${hours[0]}">`;
    for(const hr of hours){
      h+=`<div class="h-label">${pad(hr)}:00</div>`;
      for(const d of days){
        const ds=ymd(d);
        const here=timed.filter(it=>coversDay(it,ds) && Number(it.time.slice(0,2))===hr);
        h+=`<div class="cell" data-tlday="${ds}" data-hr="${hr}">${here.map(it=>blockHtml(it,true,ds)).join('')}</div>`;
      }
    }
    h+=`</div></div>`;
    root.innerHTML=h;
  } else {
    const sel = days.some(d=>ymd(d)===S.selected) ? S.selected : ymd(days[0]);
    S.selected=sel;
    const dayItems=itemsOn(sel);

    let h=`<div class="wk-strip">
      ${days.map(d=>{
        const ds=ymd(d);
        const cnt=S.items.filter(it=>coversDay(it,ds)).length;
        return `<button class="wk-day ${ds===sel?'on':''}" data-day="${ds}">
          <span class="l">${DOW_SHORT[d.getDay()]}</span>
          <span class="n">${d.getDate()}</span>
          <span class="dots">${[...Array(Math.min(cnt,3))].map(()=>'<span class="dot event"></span>').join('')}</span>
        </button>`;
      }).join('')}
    </div>`;

    h += renderDayTimeline(sel);
    root.innerHTML=h;
  }
  wire(root);
}

/* ---------- DIA ----------
   Régua horizontal do dia selecionado, em qualquer tamanho de tela —
   parecida com um board de agenda: horas correndo da esquerda pra
   direita, marcador do horário atual cruzando os blocos. */
function renderDay(root){
  $('page-title').textContent='Calendário';
  const inDay=S.items.filter(it=>coversDay(it,S.selected));
  $('page-sub').textContent=`${inDay.length} ${inDay.length===1?'item':'itens'} neste dia`;
  root.innerHTML = `<div class="card card-pad day-card">${renderDayTimeline(S.selected, true)}</div>`;
  wire(root);
  // a régua estica pra preencher até o fim da tela, no estilo board de agenda
  requestAnimationFrame(()=>{
    const scrollEl = root.querySelector('.tk-scroll');
    const trackEl = root.querySelector('.tk-track');
    if(!scrollEl || !trackEl) return;
    const avail = scrollEl.clientHeight;
    const cur = trackEl.getBoundingClientRect().height;
    if(avail > cur) trackEl.style.height = avail + 'px';
  });
}

/* ---------- MÊS ---------- */
function renderMonth(root){
  const y=S.cursor.getFullYear(), m=S.cursor.getMonth();
  $('page-title').textContent='Calendário';
  const inMonth=S.items.filter(it=> it.start_date<=`${y}-${pad(m+1)}-31` && it.end_date>=`${y}-${pad(m+1)}-01`);
  $('page-sub').textContent=`${inMonth.length} ${inMonth.length===1?'item':'itens'} em ${MONTHS[m]}`;

  const lead=new Date(y,m,1).getDay();
  const total=new Date(y,m+1,0).getDate();
  const todayStr=ymd(new Date());

  let cells='';
  for(let i=0;i<lead;i++) cells+='<div class="day blank"></div>';
  for(let d=1;d<=total;d++){
    const ds=`${y}-${pad(m+1)}-${pad(d)}`;
    const kinds=[...new Set(S.items.filter(it=>coversDay(it,ds)).map(kindOf))].slice(0,3);
    cells+=`<button class="day ${ds===todayStr?'today':''} ${ds===S.selected?'sel':''}" data-day="${ds}">
      <span>${d}</span><span class="dots">${kinds.map(k=>`<span class="dot ${k}"></span>`).join('')}</span>
    </button>`;
  }

  const sel=S.selected;
  const dayItems=itemsOn(sel);

  const agenda = renderDayTimeline(sel);

  const cal=`<div class="card card-pad">
    <div class="dow"><span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span></div>
    <div class="grid">${cells}</div>
  </div>`;

  root.innerHTML = window.matchMedia('(min-width:900px)').matches
    ? `<div class="month-layout">${cal}<div>${agenda}</div></div>`
    : `${cal}<div style="margin-top:16px">${agenda}</div>`;
  wire(root);
}

/* ==========================================================
   TIMELINE DO DIA
   Desktop: régua horizontal, horas da esquerda para a direita.
   Mobile: régua vertical, de cima para baixo.
   ========================================================== */
const MIN_PX_H = 118;   // largura de 1 hora no desktop
const MIN_PX_V = 66;    // altura de 1 hora no mobile

function toMin(hhmm){ const [h,m]=hhmm.split(':').map(Number); return h*60+m; }
function fromMin(min){ return `${pad(Math.floor(min/60))}:${pad(min%60)}`; }

/* duração padrão de quem não tem hora de fim */
function itemSpan(it){
  const start=toMin(it.time);
  const end= it.end_time ? toMin(it.end_time) : start+60;
  return { start, end: Math.max(end, start+30) };
}

/* distribui blocos sobrepostos em faixas paralelas */
function assignLanes(items){
  const laned=[];
  const laneEnds=[];
  for(const it of items){
    const { start, end } = itemSpan(it);
    let lane = laneEnds.findIndex(e => e <= start);
    if(lane === -1){ lane = laneEnds.length; laneEnds.push(end); }
    else laneEnds[lane] = end;
    laned.push({ it, start, end, lane });
  }
  return { laned, lanes: Math.max(1, laneEnds.length) };
}

function renderDayTimeline(dstr, forceHorizontal){
  const all = itemsOn(dstr);
  const allday = all.filter(it=>!it.time);
  const timed  = all.filter(it=>it.time).sort((a,b)=>toMin(a.time)-toMin(b.time));

  // a régua cobre os itens do dia, com folga, dentro de 6h–23h
  let from=8*60, to=19*60;
  for(const it of timed){
    const { start, end } = itemSpan(it);
    from=Math.min(from, Math.floor(start/60)*60);
    to=Math.max(to, Math.ceil(end/60)*60);
  }
  // se for hoje, a régua precisa alcançar o horário atual, senão o marcador some
  const agoraD=new Date();
  if(dstr===ymd(agoraD)){
    const nm=agoraD.getHours()*60+agoraD.getMinutes();
    from=Math.min(from, Math.floor(nm/60)*60);
    to=Math.max(to, Math.ceil(nm/60)*60);
  }
  from=Math.max(0, from); to=Math.min(24*60, Math.max(to, from+180));
  const hours=[]; for(let m=from;m<=to;m+=60) hours.push(m);
  const total=to-from;

  const isDesktop=forceHorizontal || window.matchMedia('(min-width:900px)').matches;
  const PX=isDesktop?MIN_PX_H:MIN_PX_V;
  const size=(total/60)*PX;

  const { laned, lanes } = assignLanes(timed);

  // marcador de agora, só se for hoje e estiver dentro da régua
  const nowD=new Date();
  const nowMin=nowD.getHours()*60+nowD.getMinutes();
  const showNow = dstr===ymd(nowD) && nowMin>=from && nowMin<=to;
  const nowPos=((nowMin-from)/total)*size;

  const ruler=hours.map(m=>{
    const pos=((m-from)/total)*size;
    return isDesktop
      ? `<div class="tk-h" style="left:${pos}px"><span>${fromMin(m)}</span></div>`
      : `<div class="tk-h" style="top:${pos}px"><span>${fromMin(m)}</span></div>`;
  }).join('');

  // altura fixa de cada faixa no modo horizontal: o card não pode crescer
  // só porque a régua foi esticada até o fim da tela (isso é só espaço vazio)
  const ROW_H=58, ROW_GAP=4;

  const blocks=laned.map(({it,start,end,lane})=>{
    const done=isDone(it,dstr);
    const pos=((start-from)/total)*size;
    const len=Math.max(((end-start)/total)*size, isDesktop?84:46);
    // bloco curto não comporta título em duas linhas nem horário embaixo
    const short = isDesktop ? len < 150 : len < 60;
    let style;
    if(isDesktop){
      const top=lane*(ROW_H+ROW_GAP);
      style=`left:${pos}px;width:${len}px;top:${top}px;height:${ROW_H}px`;
    } else {
      const laneSize=`calc((100% - ${(lanes-1)*4}px) / ${lanes})`;
      const laneOff=`calc((${laneSize} + 4px) * ${lane})`;
      style=`top:${pos}px;height:${len}px;left:${laneOff};width:${laneSize}`;
    }
    const horas = it.end_time ? `${it.time} – ${it.end_time}` : it.time;
    return `<button class="tk-block ${kindOf(it)} ${done?'done':''} ${short?'short':''}" style="${style}" data-edit="${it.id}" title="${esc(it.title)} · ${horas}">
      <span class="tk-bar"></span>
      <span class="tk-body">
        <span class="tk-t">${prioBadge(it)}${esc(it.title)}${repeatBadge(it)}</span>
        <span class="tk-m">${horas}</span>
      </span>
    </button>`;
  }).join('');

  const trackStyle = isDesktop
    ? `width:${size}px;height:${Math.max(74, lanes*(ROW_H+ROW_GAP))}px`
    : `height:${size}px`;

  const alldayHtml = allday.length
    ? `<div class="tk-allday">
        <span class="tk-allday-l">DIA INTEIRO</span>
        <div class="tk-allday-items">${allday.map(it=>blockHtml(it,true,dstr)).join('')}</div>
      </div>`
    : '';

  const body = `${alldayHtml}
    <div class="tk ${isDesktop?'tk-h-mode':'tk-v-mode'}">
      <div class="tk-scroll">
        <div class="tk-track" data-tl data-tlday="${dstr}" data-from="${from}" data-to="${to}" data-size="${size}" data-desktop="${isDesktop?1:0}" style="${trackStyle}">
          ${ruler}
          ${showNow?`<div class="tk-now" style="${isDesktop?`left:${nowPos}px`:`top:${nowPos}px`}"><span class="tk-now-tag">${fromMin(nowMin)}</span></div>`:''}
          <div class="tk-blocks">${blocks}</div>
        </div>
      </div>
    </div>`;

  return groupHtml(fmtLong(dstr), all.length || null, null, body);
}

/* ---------- LISTA (timeline) ---------- */
function renderList(root){
  $('page-title').textContent='Lista';

  const todayStr=ymd(new Date());
  const DAYS_AHEAD=21;

  // expande ocorrências dia a dia, de hoje até 3 semanas à frente
  const byDate={};
  const occByItem={}; // it.id -> datas (ordenadas) em que aparece na janela visível
  for(const it of S.items){
    const occs = Recurrence.occurrencesBetween(it, todayStr, ymd(addDays(new Date(), DAYS_AHEAD)));
    occByItem[it.id]=occs;
    for(const ds of occs){
      (byDate[ds] ||= []).push(it);
    }
  }
  // ocorrência "do meio" de um item repetido ou de período: nem a primeira
  // nem a última dentro dos dias exibidos, some com opacidade pra não
  // poluir a lista com o mesmo item repetido dia após dia
  function isMiddleOcc(it, ds){
    if(!isRepeating(it) && !isMulti(it)) return false;
    const occs=occByItem[it.id];
    return occs && occs.length>2 && ds!==occs[0] && ds!==occs[occs.length-1];
  }
  /* Atrasados. Para um item que se repete, mostrar todas as ocorrências
     perdidas viraria uma lista infinita, então entra só a mais recente. */
  const overdue=[];
  const from=ymd(addDays(new Date(),-14)), until=ymd(addDays(new Date(),-1));
  for(const it of S.items){
    if(it.kind!=='task') continue;
    const missed=Recurrence.occurrencesBetween(it, from, until).filter(ds=>!isDone(it, ds));
    if(!missed.length) continue;
    if(isRepeating(it)) overdue.push({ it, ds: missed[missed.length-1], skipped: missed.length-1 });
    else missed.forEach(ds=>overdue.push({ it, ds, skipped:0 }));
  }
  overdue.sort((a,b)=> (b.it.priority??1)-(a.it.priority??1) || b.ds.localeCompare(a.ds));

  const hojeItens=(byDate[todayStr]||[]).filter(it=>!isDone(it,todayStr));
  const parts=[];
  if(overdue.length) parts.push(`${overdue.length} atrasado${overdue.length===1?'':'s'}`);
  parts.push(`${hojeItens.length} para hoje`);
  $('page-sub').textContent=parts.join(' · ');

  let h='<div class="tl">';

  if(overdue.length){
    h+=`<div class="tl-day late">
      <div class="tl-rail"><span class="tl-dot late"></span></div>
      <div class="tl-body">
        <div class="tl-head"><span class="tl-date">Atrasados</span><span class="tl-count">${overdue.length}</span></div>
        <div class="tl-items">${overdue.slice(0,12).map(o=>itemHtml(o.it, o.ds, true, o.skipped)).join('')}</div>
      </div></div>`;
  }

  const dates=Object.keys(byDate).sort();
  for(const ds of dates){
    const list=byDate[ds].sort((a,b)=>
      (b.priority??1)-(a.priority??1) || (a.time?0:1)-(b.time?0:1) || (a.time||'').localeCompare(b.time||''));
    const isToday=ds===todayStr;
    const isTomorrow=ds===ymd(addDays(new Date(),1));
    const dObj=parse(ds);
    const rotulo = isToday ? 'Hoje' : isTomorrow ? 'Amanhã'
      : `${['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][dObj.getDay()]}, ${dObj.getDate()} ${MON_SHORT[dObj.getMonth()]}`;

    h+=`<div class="tl-day ${isToday?'today':''}">
      <div class="tl-rail"><span class="tl-dot ${isToday?'today':''}"></span></div>
      <div class="tl-body">
        <div class="tl-head">
          <span class="tl-date">${rotulo}</span>
          ${isToday?'<span class="tl-now">agora</span>':''}
          <span class="tl-count">${list.length}</span>
        </div>
        <div class="tl-items">${list.map(it=>itemHtml(it, ds, false, 0, isMiddleOcc(it,ds))).join('')}</div>
      </div></div>`;
  }

  h+='</div>';
  root.innerHTML = (dates.length||overdue.length) ? h
    : `<div class="empty">Nada nas próximas semanas.<br>Toque em Novo para criar seu primeiro item.</div>`;
  wire(root);
}

/* ---------- CONFIGURAÇÕES ---------- */
async function renderSettings(root){
  $('page-title').textContent='Configurações';
  $('page-sub').textContent='Resumo diário por email';

  root.innerHTML = `<div class="card card-pad" style="max-width:420px">
    <div class="field">
      <label class="switch-row" id="cfg-enabled-row">
        <div>
          <div class="sw-title">Resumo diário por email</div>
          <div class="sw-hint">Um email de manhã com o que falta até a tarde, outro na virada da tarde com o resto do dia</div>
        </div>
        <span class="sw" id="cfg-enabled"><span class="sw-knob"></span></span>
      </label>
    </div>
    <div class="field">
      <div class="label">MANHÃ <span class="opt">itens de hoje antes do horário da tarde</span></div>
      <input type="time" id="cfg-morning" style="width:150px">
    </div>
    <div class="field">
      <div class="label">TARDE <span class="opt">itens de hoje a partir deste horário</span></div>
      <input type="time" id="cfg-split" style="width:150px">
    </div>
    <div class="hint" style="margin-bottom:16px">Cada resumo só chega se houver algo pendente naquele período.</div>
    <button class="btn btn-primary" id="cfg-save" style="width:auto;padding-left:22px;padding-right:22px">Salvar</button>
  </div>`;

  let enabled = true;
  try{
    const s = await api('/settings');
    enabled = s.digestEnabled;
    $('cfg-morning').value = s.digestMorningTime;
    $('cfg-split').value = s.digestSplitTime;
    $('cfg-enabled').classList.toggle('on', enabled);
  }catch(e){ toast(e.message); }

  $('cfg-enabled-row').addEventListener('click', e=>{
    e.preventDefault();
    enabled = !enabled;
    $('cfg-enabled').classList.toggle('on', enabled);
  });

  $('cfg-save').addEventListener('click', async ()=>{
    const morning = $('cfg-morning').value, split = $('cfg-split').value;
    if(!morning || !split){ toast('Preencha os dois horários'); return; }
    if(morning >= split){ toast('O horário da manhã precisa ser antes do da tarde'); return; }
    try{
      await api('/settings', {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ digestMorningTime: morning, digestSplitTime: split, digestEnabled: enabled }),
      });
      toast('Configurações salvas');
    }catch(e){ toast(e.message); }
  });
}

/* card de item dentro da timeline, sempre amarrado a uma data.
   dim = ocorrência "do meio" de um item repetido (não é a primeira nem a
   última dentro da janela visível), fica com menos opacidade pra não
   poluir a lista com o mesmo item repetido dia após dia. */
function itemHtml(it, ds, late, skipped, dim){
  const done=isDone(it, ds);
  const checkable = it.kind==='task';
  return `<div class="item ${done?'done':''} ${late?'late':''} ${(it.priority??1)===2?'high':''} ${dim?'dim':''}">
    <div class="item-row">
      <button class="check ${done?'on':''} ${checkable?'':'na'}"
              data-done="${it.id}" data-date="${ds}" data-val="${done?0:1}"
              title="${checkable?'Marcar como feito':'Eventos não se concluem'}">${done?'✓':''}</button>
      <button style="flex:1;text-align:left;min-width:0" data-edit="${it.id}">
        <div class="item-title">
          ${prioBadge(it)}<span class="t">${esc(it.title)}</span>${repeatBadge(it)}
        </div>
        ${contentPreview(it)}
        <div class="meta">
          <span class="pill ${kindOf(it)}">${pillLabel(it)}</span>
          <span class="when">${esc(whenLabel(it))}</span>
          ${late?`<span class="late-tag">${fmtShort(ds)}${skipped?` · ${skipped} antes`:''}</span>`:''}
          ${todoProgress(it)}
          ${it.nag && !done ? '<span class="nag-tag">insiste até o check</span>' : ''}
        </div>
      </button>
    </div>
    ${(()=>{const imgs=(it.content||[]).filter(b=>b.type==='img');
       return imgs.length?`<div class="thumbs">${imgs.map(b=>`<img src="${b.src}" data-zoom="${b.src}" loading="lazy">`).join('')}</div>`:'';})()}
  </div>`;
}

/* ---------- eventos delegados ---------- */
function wire(root){
  root.querySelectorAll('[data-day]').forEach(b=>b.addEventListener('click',()=>{
    S.selected=b.dataset.day; render();
  }));
  root.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>{
    const it=S.items.find(i=>i.id===Number(b.dataset.edit));
    if(it) openSheet(it);
  }));
  root.querySelectorAll('[data-done]').forEach(b=>b.addEventListener('click', async ()=>{
    const it=S.items.find(i=>i.id===Number(b.dataset.done));
    if(!it || it.kind==='event'){ toast('Eventos não se concluem, eles só acontecem'); return; }
    try{
      const ds=b.dataset.date || it.start_date;
      const want = b.dataset.val==='1';
      await api(`/items/${it.id}/done`,{
        method:'PUT', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({done: want, date: ds})
      });
      it.completions = it.completions || [];
      if(want) it.completions.push(ds);
      else it.completions = it.completions.filter(x=>x!==ds);
      render();
    }catch(e){ toast(e.message); }
  }));
  root.querySelectorAll('[data-zoom]').forEach(img=>img.addEventListener('click',()=>{
    const lb=document.createElement('div');
    lb.className='lightbox';
    lb.innerHTML=`<img src="${img.dataset.zoom}">`;
    lb.addEventListener('click',()=>lb.remove());
    document.body.appendChild(lb);
  }));
  wireTimelineSelect(root);
}

/* ==========================================================
   SELEÇÃO POR ARRASTE NA RÉGUA DO DIA
   Clique simples cria um item de 1h no horário tocado.
   Arrastar define o intervalo exato (início e fim).
   No mobile, um arrasto na direção errada é tratado como rolagem
   da página, não como seleção, pra não brigar com o scroll.
   ========================================================== */
function wireTimelineSelect(root){
  root.querySelectorAll('.tk-track[data-tl]').forEach(track=>{
    const from=Number(track.dataset.from), to=Number(track.dataset.to), size=Number(track.dataset.size);
    const isDesktop = track.dataset.desktop==='1';
    const dstr = track.dataset.tlday;
    const total = to-from;
    const blocksEl = track.querySelector('.tk-blocks');

    let mode=null;       // null | 'maybe' | 'drag' | 'scroll'
    let downX=0, downY=0, startMin=0;
    let selEl=null;

    function posToMin(clientX, clientY){
      const rect=track.getBoundingClientRect();
      const p = isDesktop ? (clientX-rect.left) : (clientY-rect.top);
      const raw = from + (p/size)*total;
      const snapped = Math.round(raw/15)*15;
      return Math.max(from, Math.min(to, snapped));
    }
    function showSel(a,b){
      if(!selEl){
        selEl=document.createElement('div');
        selEl.className='tk-select';
        selEl.innerHTML='<span class="tk-select-label"></span>';
        blocksEl.appendChild(selEl);
      }
      const s=Math.min(a,b), e=Math.max(a,b);
      const pos=((s-from)/total)*size;
      const len=Math.max(((e-s)/total)*size, 2);
      if(isDesktop){ selEl.style.cssText=`left:${pos}px;width:${len}px;top:0;height:100%`; }
      else { selEl.style.cssText=`top:${pos}px;height:${len}px;left:0;width:100%`; }
      selEl.querySelector('.tk-select-label').textContent = `${fromMin(s)} – ${fromMin(e)}`;
    }
    function clearSel(){ if(selEl){ selEl.remove(); selEl=null; } }

    track.addEventListener('pointerdown', e=>{
      if(e.target.closest('.tk-block') || e.button) return;
      e.preventDefault();
      mode='maybe';
      downX=e.clientX; downY=e.clientY;
      startMin=posToMin(e.clientX, e.clientY);
    });
    track.addEventListener('pointermove', e=>{
      if(!mode) return;
      const dx=e.clientX-downX, dy=e.clientY-downY;
      if(mode==='maybe'){
        const primary = isDesktop ? Math.abs(dx) : Math.abs(dy);
        const cross   = isDesktop ? Math.abs(dy) : Math.abs(dx);
        if(primary<6 && cross<6) return;
        mode = primary>cross ? 'drag' : 'scroll';
        if(mode==='drag') track.setPointerCapture(e.pointerId);
      }
      if(mode==='drag'){
        e.preventDefault();
        showSel(startMin, posToMin(e.clientX, e.clientY));
      }
    });
    track.addEventListener('pointerup', e=>{
      const dx=e.clientX-downX, dy=e.clientY-downY;
      const moved = Math.abs(dx)>6 || Math.abs(dy)>6;
      if(mode==='drag'){
        const endMin=posToMin(e.clientX, e.clientY);
        clearSel();
        let s=Math.min(startMin,endMin), en=Math.max(startMin,endMin);
        if(en-s<30) en=Math.min(to, s+60);
        openSheet(null, { date:dstr, time:fromMin(s), endTime:fromMin(en) });
      } else if(mode==='maybe' && !moved){
        openSheet(null, { date:dstr, time:fromMin(startMin), endTime:fromMin(Math.min(to, startMin+60)) });
      }
      mode=null; clearSel();
    });
    track.addEventListener('pointercancel', ()=>{ mode=null; clearSel(); });
  });

  /* mesma ideia, mas na grade de semana do desktop: célula = 1h fixa,
     o arrasto trava na coluna (dia) onde começou e só varia a hora,
     usando elementFromPoint pra sempre achar a célula certa por baixo do ponteiro */
  root.querySelectorAll('.wk-grid-hours[data-tlgrid]').forEach(grid=>{
    const PX=54; // .wk-grid .cell / .h-label height
    const baseHour=Number(grid.dataset.basehour);
    let mode=null, downX=0, downY=0, anchorDay=null, anchorX=0, startMin=0, selEl=null;

    function cellMinute(cell, clientY){
      const r=cell.getBoundingClientRect();
      const frac=Math.max(0, Math.min(1, (clientY-r.top)/r.height));
      const hr=Number(cell.dataset.hr);
      return hr*60 + Math.round(frac*60/15)*15;
    }
    function showSel(anchorCell, a, b){
      if(!selEl){
        selEl=document.createElement('div');
        selEl.className='tk-select';
        selEl.innerHTML='<span class="tk-select-label"></span>';
        grid.appendChild(selEl);
      }
      const gr=grid.getBoundingClientRect(), cr=anchorCell.getBoundingClientRect();
      const s=Math.min(a,b), e=Math.max(a,b);
      const top=((s-baseHour*60)/60)*PX, height=Math.max(((e-s)/60)*PX, 4);
      selEl.style.cssText=`left:${cr.left-gr.left}px;width:${cr.width}px;top:${top}px;height:${height}px`;
      selEl.querySelector('.tk-select-label').textContent = `${fromMin(s)} – ${fromMin(e)}`;
    }
    function clearSel(){ if(selEl){ selEl.remove(); selEl=null; } }

    grid.addEventListener('pointerdown', e=>{
      const cell=e.target.closest('.cell');
      if(!cell || e.target.closest('.block') || e.button) return;
      e.preventDefault();
      mode='maybe'; downX=e.clientX; downY=e.clientY;
      anchorDay=cell.dataset.tlday; anchorX=e.clientX;
      startMin=cellMinute(cell, e.clientY);
    });
    grid.addEventListener('pointermove', e=>{
      if(!mode) return;
      const dx=e.clientX-downX, dy=e.clientY-downY;
      if(mode==='maybe'){
        if(Math.abs(dx)<6 && Math.abs(dy)<6) return;
        mode = Math.abs(dy)>Math.abs(dx) ? 'drag' : 'scroll';
      }
      if(mode==='drag'){
        e.preventDefault();
        const under=document.elementFromPoint(anchorX, e.clientY);
        const cell=under && under.closest('.cell[data-tlday="'+anchorDay+'"]');
        if(cell) showSel(cell, startMin, cellMinute(cell, e.clientY));
      }
    });
    grid.addEventListener('pointerup', e=>{
      const dx=e.clientX-downX, dy=e.clientY-downY;
      const moved=Math.abs(dx)>6||Math.abs(dy)>6;
      if(mode==='drag'){
        const under=document.elementFromPoint(anchorX, e.clientY);
        const cell=under && under.closest('.cell[data-tlday="'+anchorDay+'"]');
        const endMin = cell ? cellMinute(cell, e.clientY) : startMin+60;
        clearSel();
        let s=Math.min(startMin,endMin), en=Math.max(startMin,endMin);
        if(en-s<30) en=s+60;
        openSheet(null, { date:anchorDay, time:fromMin(s), endTime:fromMin(en) });
      } else if(mode==='maybe' && !moved && anchorDay){
        openSheet(null, { date:anchorDay, time:fromMin(startMin), endTime:fromMin(startMin+60) });
      }
      mode=null; clearSel();
    });
    grid.addEventListener('pointercancel', ()=>{ mode=null; clearSel(); });
  });
}

/* ==========================================================
   SHEET / FORMULÁRIO
   ========================================================== */
function openSheet(item, prefill){
  S.editing = item || null;
  const F=S.form;

  if(item){
    F.kind=item.kind; F.start=item.start_date; F.end=item.end_date;
    $('sheet-title').textContent='Editar item';
    $('f-title').value=item.title;
    Editor.load(item.content||[]);
    $('f-time').value=item.time||'';
    $('f-end-time').value=item.end_time||'';
    F.repeat=item.repeat||'none'; F.priority=item.priority??1; F.nag=!!item.nag;
    $('f-delete').classList.remove('hidden');
    F.pickCursor=parse(item.start_date);
  } else {
    const d = (prefill && prefill.date) || S.selected;
    F.kind='event'; F.start=d; F.end=d;
    $('sheet-title').textContent='Novo item';
    $('f-title').value='';
    $('f-time').value = (prefill && prefill.time) || '';
    $('f-end-time').value = (prefill && prefill.endTime) || '';
    Editor.load([]);
    F.repeat='none'; F.priority=1; F.nag=false;
    $('f-delete').classList.add('hidden');
    F.pickCursor=parse(d);
  }
  F.picking='start';

  document.querySelectorAll('#f-kind button').forEach(b=>b.classList.toggle('on', b.dataset.kind===F.kind));
  renderRange(); renderPicker(); updateTimeHint(); renderOptions();
  if(prefill && prefill.time) setTimeout(()=>$('f-title').focus(), 260);

  $('backdrop').classList.remove('hidden');
  $('sheet').classList.remove('hidden');
  requestAnimationFrame(()=>{
    $('backdrop').classList.add('show');
    $('sheet').classList.add('show');
  });
}

function closeSheet(){
  $('backdrop').classList.remove('show');
  $('sheet').classList.remove('show');
  setTimeout(()=>{
    $('backdrop').classList.add('hidden');
    $('sheet').classList.add('hidden');
  },240);
}
$('sheet-close').addEventListener('click', closeSheet);
$('f-cancel').addEventListener('click', closeSheet);
$('backdrop').addEventListener('click', closeSheet);
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && !$('sheet').classList.contains('hidden')) closeSheet(); });

/* tipo */
document.querySelectorAll('#f-kind button').forEach(b=>b.addEventListener('click',()=>{
  S.form.kind=b.dataset.kind;
  document.querySelectorAll('#f-kind button').forEach(x=>x.classList.toggle('on',x===b));
  updateTimeHint();
}));

/* resumo do intervalo */
function renderRange(){
  const F=S.form;
  $('f-start-v').textContent = F.start ? fmtShort(F.start) : '—';
  $('f-end-v').textContent   = F.end   ? fmtShort(F.end)   : '—';
  $('f-start-btn').classList.toggle('on', F.picking==='start');
  $('f-end-btn').classList.toggle('on', F.picking==='end');
}
$('f-start-btn').addEventListener('click',()=>{ S.form.picking='start'; renderRange(); });
$('f-end-btn').addEventListener('click',()=>{ S.form.picking='end'; renderRange(); });

/* calendário do formulário */
function renderPicker(){
  const F=S.form;
  const y=F.pickCursor.getFullYear(), m=F.pickCursor.getMonth();
  $('pick-month').textContent=`${MONTHS[m]} ${y}`;

  const lead=new Date(y,m,1).getDay();
  const total=new Date(y,m+1,0).getDate();
  let h='';
  for(let i=0;i<lead;i++) h+='<div class="pick-day blank"></div>';
  for(let d=1;d<=total;d++){
    const ds=`${y}-${pad(m+1)}-${pad(d)}`;
    const inR = F.start && F.end && ds>=F.start && ds<=F.end;
    const isS = ds===F.start, isE = ds===F.end;
    let cls='pick-day';
    if(inR) cls += (isS||isE) ? ' in edge' : ' in';
    if(isS && isE) cls+=' single';
    else if(isS) cls+=' start';
    else if(isE) cls+=' end';
    h+=`<button class="${cls}" data-pick="${ds}">${d}</button>`;
  }
  $('pick-grid').innerHTML=h;
  $('pick-grid').querySelectorAll('[data-pick]').forEach(b=>{
    b.addEventListener('click',()=>pickDate(b.dataset.pick));
  });
}

/* lógica do intervalo estilo Airbnb */
function pickDate(ds){
  const F=S.form;
  if(F.repeat!=='none'){ F.start=ds; F.end=ds; renderRange(); renderPicker(); renderOptions(); return; }
  if(F.picking==='start'){
    F.start=ds;
    if(!F.end || F.end < ds) F.end=ds;
    F.picking='end';
  } else {
    if(ds < F.start){ F.start=ds; F.end=ds; F.picking='end'; }
    else { F.end=ds; F.picking='start'; }
  }
  renderRange(); renderPicker();
}
$('pick-prev').addEventListener('click',()=>{
  const F=S.form; F.pickCursor=new Date(F.pickCursor.getFullYear(),F.pickCursor.getMonth()-1,1); renderPicker();
});
$('pick-next').addEventListener('click',()=>{
  const F=S.form; F.pickCursor=new Date(F.pickCursor.getFullYear(),F.pickCursor.getMonth()+1,1); renderPicker();
});

/* repetição, prioridade e insistência */
function renderOptions(){
  const F=S.form;
  document.querySelectorAll('#f-repeat [data-rep]').forEach(b=>b.classList.toggle('on', b.dataset.rep===F.repeat));
  document.querySelectorAll('#f-prio [data-prio]').forEach(b=>b.classList.toggle('on', Number(b.dataset.prio)===F.priority));
  $('f-nag').classList.toggle('on', F.nag);
  $('f-repeat-hint').textContent = F.repeat==='none'
    ? 'Acontece uma vez, no intervalo escolhido acima.'
    : `${Recurrence.repeatLabel(F.repeat)}, a partir de ${F.start?fmtShort(F.start):'a data de início'}. A data de fim é ignorada.`;
  // com repetição, o intervalo de fim não se aplica
  $('f-end-btn').classList.toggle('disabled', F.repeat!=='none');
}
document.querySelectorAll('#f-repeat [data-rep]').forEach(b=>b.addEventListener('click',()=>{
  S.form.repeat=b.dataset.rep;
  if(S.form.repeat!=='none') S.form.end=S.form.start;
  renderOptions(); renderRange(); renderPicker();
}));
document.querySelectorAll('#f-prio [data-prio]').forEach(b=>b.addEventListener('click',()=>{
  S.form.priority=Number(b.dataset.prio); renderOptions();
}));
$('f-nag-row').addEventListener('click', e=>{
  e.preventDefault(); S.form.nag=!S.form.nag; renderOptions();
});

/* horário */
$('f-time-clear').addEventListener('click',()=>{
  $('f-time').value=''; $('f-end-time').value=''; updateTimeHint();
});
$('f-time').addEventListener('change', updateTimeHint);
$('f-end-time').addEventListener('change', updateTimeHint);
function updateTimeHint(){
  const ini=$('f-time').value, fim=$('f-end-time').value;
  $('f-end-time').disabled = !ini;
  let txt;
  if(!ini) txt='Sem horário, o item vira “dia inteiro” e o aviso chega às 8h da manhã.';
  else if(fim && fim<=ini) txt='O fim precisa ser depois do início, senão será ignorado.';
  else if(fim) txt='O aviso chega no início. Na régua do dia o bloco ocupa esse intervalo.';
  else txt='O aviso chega neste horário. Sem hora de fim, o bloco ocupa 1 hora na régua.';
  $('f-time-hint').textContent = txt;
}

/* salvar */
$('f-save').addEventListener('click', async ()=>{
  const F=S.form;
  const title=$('f-title').value.trim();
  if(!title){ toast('Dê um título ao item'); $('f-title').focus(); return; }
  if(!F.start){ toast('Escolha uma data'); return; }

  const { blocks, files } = Editor.serialize();
  const fd=new FormData();
  fd.append('kind',F.kind);
  fd.append('title',title);
  fd.append('content',JSON.stringify(blocks));
  fd.append('start_date',F.start);
  fd.append('end_date',F.end||F.start);
  fd.append('time',$('f-time').value||'');
  fd.append('end_time',$('f-end-time').value||'');
  fd.append('repeat',F.repeat);
  fd.append('priority',String(F.priority));
  fd.append('nag',F.nag?'true':'false');
  for(const f of files) fd.append('photos',f);

  const btn=$('f-save'); btn.disabled=true; btn.textContent='Salvando...';
  try{
    if(S.editing) await api(`/items/${S.editing.id}`,{method:'PUT',body:fd});
    else await api('/items',{method:'POST',body:fd});
    closeSheet();
    await loadItems();
    toast(S.editing?'Item atualizado':'Item criado');
  }catch(e){ toast(e.message); }
  finally{ btn.disabled=false; btn.textContent='Salvar'; }
});

/* excluir */
$('f-delete').addEventListener('click', async ()=>{
  if(!S.editing) return;
  if(!confirm('Excluir este item? Os anexos também serão apagados.')) return;
  try{
    await api(`/items/${S.editing.id}`,{method:'DELETE'});
    closeSheet(); await loadItems(); toast('Item excluído');
  }catch(e){ toast(e.message); }
});

/* ==========================================================
   PUSH
   ========================================================== */
function b64ToUint8(base64){
  const padding='='.repeat((4-base64.length%4)%4);
  const b64=(base64+padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(b64);
  return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}

async function setupPush(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  let reg;
  try{ reg=await navigator.serviceWorker.register('/sw.js'); }catch{ return; }

  const existing=await reg.pushManager.getSubscription();
  if(existing){
    // reenvia para o servidor (caso o banco tenha perdido a inscrição)
    fetch(API+'/push/subscribe',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(existing)
    }).catch(()=>{});
    return;
  }
  if(Notification.permission==='denied') return;

  const banner=$('push-banner');
  banner.classList.remove('hidden');
  $('push-enable').addEventListener('click', async ()=>{
    try{
      const perm=await Notification.requestPermission();
      if(perm!=='granted'){ toast('Permissão negada'); return; }
      const { key }=await api('/push/vapid-public-key');
      if(!key){ toast('Servidor sem chave VAPID configurada'); return; }
      const sub=await reg.pushManager.subscribe({
        userVisibleOnly:true, applicationServerKey:b64ToUint8(key)
      });
      await api('/push/subscribe',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sub)
      });
      banner.classList.add('hidden');
      toast('Notificações ativadas');
    }catch(e){ toast(e.message); }
  },{once:true});
}

/* re-render ao cruzar o breakpoint de desktop */
let wasDesktop=window.matchMedia('(min-width:900px)').matches;
window.addEventListener('resize',()=>{
  const now=window.matchMedia('(min-width:900px)').matches;
  if(now!==wasDesktop){ wasDesktop=now; render(); }
});

Editor.init($('f-editor'), $('f-photo'), ()=>{});

boot();
