const cron = require('node-cron');
const webpush = require('web-push');
const nodemailer = require('nodemailer');
const db = require('../db/database');
const R = require('../public/recurrence');

// Horário em que itens sem hora marcada são avisados
const ALL_DAY_HOUR = process.env.ALL_DAY_NOTIFY_TIME || '08:00';
// de quanto em quanto tempo o aviso insistente volta, em minutos
const NAG_EVERY_MIN = Number(process.env.NAG_EVERY_MIN || 30);

// Resumo diário por email: horários configuráveis por usuário em Configurações
// (colunas digest_morning_time / digest_split_time na tabela users).
const APP_URL = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

let mailer = null;
if (process.env.SMTP_HOST) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

const pad = n => String(n).padStart(2, '0');
function now() {
  const d = new Date();
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

async function sendPush(userId, payload) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: JSON.parse(s.keys_json) },
        JSON.stringify(payload)
      );
    } catch (err) {
      // 404/410 = inscricao morta (app removido, navegador limpo)
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
      } else {
        console.error('[push]', err.statusCode || '', err.message);
      }
    }
  }
}

async function sendEmail(userId, subject, text) {
  if (!mailer) return;
  const u = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
  if (!u || !u.email) return;
  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: u.email,
      subject,
      text,
    });
  } catch (err) {
    console.error('[email]', err.message);
  }
}

function describe(item) {
  const parts = [];
  parts.push(item.time ? ('as ' + item.time) : 'dia inteiro');
  if (item.start_date !== item.end_date) parts.push(item.start_date + ' a ' + item.end_date);
  return parts.join(' - ');
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function digestItemsHtml(items) {
  return items.map(it => {
    const time = it.time || 'dia inteiro';
    const label = it.kind === 'task' ? 'Tarefa' : 'Compromisso';
    const prio = it.priority === 2
      ? ' <span style="color:#e5484d;font-weight:800">[!]</span>' : '';
    return `<tr>
      <td style="padding:9px 0;border-bottom:1px solid #eee;color:#777;font-size:13px;width:64px;vertical-align:top;white-space:nowrap">${escHtml(time)}</td>
      <td style="padding:9px 0 9px 10px;border-bottom:1px solid #eee;font-size:14px;color:#1a1a1a">
        <span style="display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.02em;color:#666;text-transform:uppercase;margin-right:6px">${label}</span>
        ${escHtml(it.title)}${prio}
      </td>
    </tr>`;
  }).join('');
}

function digestHtml(title, items) {
  return `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;padding:8px">
    <h2 style="font-size:19px;letter-spacing:-.02em;margin:0 0 4px">${escHtml(title)}</h2>
    <p style="color:#777;font-size:13px;margin:0 0 16px">${items.length} pendente${items.length === 1 ? '' : 's'}</p>
    <table style="width:100%;border-collapse:collapse">${digestItemsHtml(items)}</table>
    <div style="margin-top:22px">
      <a href="${APP_URL}" style="background:#2f6bff;color:#fff;padding:11px 20px;border-radius:9px;
        text-decoration:none;font-weight:700;font-size:14px;display:inline-block">Ver demandas</a>
    </div>
  </div>`;
}

function digestText(title, items) {
  const lines = items.map(it => {
    const time = it.time || 'dia inteiro';
    const label = it.kind === 'task' ? 'Tarefa' : 'Compromisso';
    const prio = it.priority === 2 ? ' [!]' : '';
    return `${time} - ${label}: ${it.title}${prio}`;
  });
  return `${title}\n\n${lines.join('\n')}\n\nVer demandas: ${APP_URL}`;
}

/* Resumo diário por email de UM usuário. period: 'morning' cobre os itens de
   hoje com horário antes de splitTime (mais os "dia inteiro"); 'afternoon'
   cobre os itens de hoje com horário a partir de splitTime.
   Retorna true se um email foi enviado. */
async function sendUserDigest(user, period, date, splitTime) {
  const doneToday = new Set(
    db.prepare('SELECT item_id FROM completions WHERE date = ?').all(date).map(r => r.item_id)
  );
  const candidates = db.prepare(
    'SELECT * FROM items WHERE user_id = ? AND start_date <= ? ORDER BY priority DESC, (time IS NULL) DESC, time'
  ).all(user.id, date);

  const today = candidates.filter(it => R.occursOn(it, date));
  const pending = today.filter(it => it.kind !== 'task' || !doneToday.has(it.id));
  const bucket = pending.filter(it => {
    if (!it.time) return period === 'morning';       // dia inteiro entra no resumo da manhã
    return period === 'morning' ? it.time < splitTime : it.time >= splitTime;
  });
  if (!bucket.length) return false;

  const title = period === 'morning' ? 'Resumo da manhã' : 'Resumo da tarde';
  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: user.email,
      subject: `${title} · ${bucket.length} pendente${bucket.length === 1 ? '' : 's'}`,
      text: digestText(title, bucket),
      html: digestHtml(title, bucket),
    });
    return true;
  } catch (err) {
    console.error('[digest]', err.message);
    return false;
  }
}

/* Roda a cada minuto: cada usuário tem seu próprio horário de manhã/tarde
   (configurável em Configurações), guardado em users.digest_*_time. Uma
   coluna de "última data enviada" evita mandar duas vezes no mesmo dia. */
async function digestTick() {
  if (!mailer) return;
  const { date, time } = now();

  const users = db.prepare(`
    SELECT id, email, digest_morning_time, digest_split_time, digest_enabled,
           digest_morning_sent_date, digest_afternoon_sent_date
    FROM users WHERE email IS NOT NULL AND email != ''
  `).all();

  for (const u of users) {
    if (!u.digest_enabled) continue;
    const morningTime = u.digest_morning_time || '07:00';
    const splitTime = u.digest_split_time || '14:00';

    if (time === morningTime && u.digest_morning_sent_date !== date) {
      await sendUserDigest(u, 'morning', date, splitTime);
      db.prepare('UPDATE users SET digest_morning_sent_date = ? WHERE id = ?').run(date, u.id);
    }
    if (time === splitTime && u.digest_afternoon_sent_date !== date) {
      await sendUserDigest(u, 'afternoon', date, splitTime);
      db.prepare('UPDATE users SET digest_afternoon_sent_date = ? WHERE id = ?').run(date, u.id);
    }
  }
}

/* Dispara o resumo na hora, pra teste manual — ignora o horário configurado
   e a trava de "já enviado hoje". */
async function runDigestNow(period) {
  if (!mailer) return 0;
  const { date } = now();
  const users = db.prepare('SELECT id, email, digest_split_time FROM users WHERE email IS NOT NULL AND email != \'\'').all();
  let sent = 0;
  for (const u of users) {
    const ok = await sendUserDigest(u, period, date, u.digest_split_time || '14:00');
    if (ok) sent++;
  }
  return sent;
}

async function tick() {
  const { date, time } = now();
  const nowMs = Date.now();

  // candidatos: tudo que já começou. A recorrência decide se cai hoje.
  const candidates = db.prepare(`
    SELECT * FROM items WHERE start_date <= ? ORDER BY priority DESC, time
  `).all(date);

  const doneToday = new Set(
    db.prepare('SELECT item_id FROM completions WHERE date = ?').all(date).map(r => r.item_id)
  );

  let sent = 0;

  for (const item of candidates) {
    if (!R.occursOn(item, date)) continue;
    if (doneToday.has(item.id)) continue;

    const dueAt = item.time || ALL_DAY_HOUR;
    if (dueAt > time) continue;               // ainda não chegou a hora

    const last = item.last_notified ? new Date(item.last_notified).getTime() : 0;
    const notifiedToday = item.last_notified && item.last_notified.slice(0, 10) === date;

    let should = false;
    if (!notifiedToday) {
      should = true;                          // primeiro aviso do dia
    } else if (item.nag) {
      // insiste até dar check
      should = (nowMs - last) >= NAG_EVERY_MIN * 60 * 1000;
    }
    if (!should) continue;

    const label = item.kind === 'task' ? 'Demanda' : 'Compromisso';
    const prio = item.priority === 2 ? '[!] ' : '';
    const again = notifiedToday ? ' (ainda pendente)' : '';
    const body = [item.description, describe(item)].filter(Boolean).join('\n');

    await sendPush(item.user_id, {
      title: prio + label + ': ' + item.title + again,
      body: item.description || describe(item),
      tag: 'item-' + item.id,                 // substitui o aviso anterior, não empilha
      renotify: !!item.nag,
      requireInteraction: !!item.nag,          // fica na tela até você tocar
      url: '/',
    });
    // email só no primeiro aviso do dia, para não encher a caixa
    if (!notifiedToday) await sendEmail(item.user_id, prio + label + ': ' + item.title, body);

    db.prepare('UPDATE items SET last_notified = ?, notified = 1 WHERE id = ?')
      .run(new Date().toISOString(), item.id);
    sent++;
  }

  return sent;
}

function start() {
  cron.schedule('* * * * *', () => {
    tick().catch(err => console.error('[notifier]', err));
    digestTick().catch(err => console.error('[digest]', err));
  });
  console.log(
    'Notificador ativo. Sem horario avisa as ' + ALL_DAY_HOUR + '. Insistencia a cada ' + NAG_EVERY_MIN + ' min. ' +
    'Resumo diario configuravel por usuario em Configuracoes.'
  );
}

module.exports = { start, tick, sendPush, runDigestNow };
