/* ==========================================================
   Regras de repetição — usado no servidor e no navegador
   ========================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Recurrence = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const REPEATS = {
    none:     'Não repete',
    daily:    'Todo dia',
    weekdays: 'De segunda a sexta',
    weekly:   'Toda semana',
    monthly:  'Todo mês',
  };

  const PRIORITIES = {
    2: { label: 'Alta',   short: 'ALTA' },
    1: { label: 'Normal', short: '' },
    0: { label: 'Baixa',  short: 'BAIXA' },
  };

  const pad = n => String(n).padStart(2, '0');
  function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function addDays(d, n) { const c = new Date(d); c.setDate(c.getDate() + n); return c; }

  /* O item acontece neste dia? */
  function occursOn(item, dateStr) {
    const rep = item.repeat || 'none';
    if (rep === 'none') return item.start_date <= dateStr && item.end_date >= dateStr;

    // repetição começa na data de início e segue indefinidamente
    if (dateStr < item.start_date) return false;
    const d = parse(dateStr), s = parse(item.start_date);

    if (rep === 'daily') return true;
    if (rep === 'weekdays') { const w = d.getDay(); return w >= 1 && w <= 5; }
    if (rep === 'weekly') return d.getDay() === s.getDay();
    if (rep === 'monthly') {
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      // dia 31 em mês curto cai no último dia do mês
      return d.getDate() === Math.min(s.getDate(), lastDay);
    }
    return false;
  }

  /* Ocorrências dentro de uma janela [from, to] */
  function occurrencesBetween(item, from, to, cap = 400) {
    const out = [];
    if ((item.repeat || 'none') === 'none') {
      // um item de vários dias aparece em cada dia do intervalo
      let d = parse(item.start_date > from ? item.start_date : from);
      const end = parse(item.end_date < to ? item.end_date : to);
      while (d <= end && out.length < cap) { out.push(ymd(d)); d = addDays(d, 1); }
      return out;
    }
    let d = parse(item.start_date > from ? item.start_date : from);
    const end = parse(to);
    while (d <= end && out.length < cap) {
      const ds = ymd(d);
      if (occursOn(item, ds)) out.push(ds);
      d = addDays(d, 1);
    }
    return out;
  }

  /* Próxima ocorrência a partir de uma data (inclusive) */
  function nextOccurrence(item, fromStr, limitDays = 400) {
    let d = parse(fromStr);
    for (let i = 0; i < limitDays; i++) {
      const ds = ymd(d);
      if (occursOn(item, ds)) return ds;
      d = addDays(d, 1);
    }
    return null;
  }

  function repeatLabel(rep) { return REPEATS[rep] || REPEATS.none; }

  return { REPEATS, PRIORITIES, occursOn, occurrencesBetween, nextOccurrence, repeatLabel, ymd, parse, addDays };
});
