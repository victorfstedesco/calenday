const cron = require('node-cron');
const webpush = require('web-push');
const nodemailer = require('nodemailer');
const db = require('../db/database');
const R = require('../public/recurrence');

// Horário em que itens sem hora marcada são avisados
const ALL_DAY_HOUR = process.env.ALL_DAY_NOTIFY_TIME || '08:00';
// de quanto em quanto tempo o aviso insistente volta, em minutos
const NAG_EVERY_MIN = Number(process.env.NAG_EVERY_MIN || 30);

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
  });
  console.log('Notificador ativo. Sem horario avisa as ' + ALL_DAY_HOUR + '. Insistencia a cada ' + NAG_EVERY_MIN + ' min.');
}

module.exports = { start, tick, sendPush };
