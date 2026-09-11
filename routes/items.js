const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const R = require('../public/recurrence');

const router = express.Router();
router.use(requireAuth);

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${req.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('Só imagens são aceitas'));
    cb(null, true);
  }
});

/* Normaliza os blocos vindos do cliente e resolve as imagens novas.
   O cliente manda blocos de imagem como { type:'img', ref:'new:0' }, onde o
   número é a posição do arquivo em req.files. Aqui o ref vira o caminho real. */
function resolveBlocks(rawContent, files) {
  let blocks;
  try { blocks = JSON.parse(rawContent || '[]'); } catch { blocks = []; }
  if (!Array.isArray(blocks)) blocks = [];

  const ALLOWED = new Set(['p', 'todo', 'num', 'bullet', 'img']);
  const out = [];

  for (const b of blocks) {
    if (!b || !ALLOWED.has(b.type)) continue;
    if (b.type === 'img') {
      let path = typeof b.src === 'string' && b.src.startsWith('/uploads/') ? b.src : null;
      if (!path && typeof b.ref === 'string' && b.ref.startsWith('new:')) {
        const f = files[Number(b.ref.slice(4))];
        if (f) path = `/uploads/${f.filename}`;
      }
      if (path) out.push({ id: b.id, type: 'img', src: path });
    } else {
      out.push({
        id: b.id,
        type: b.type,
        text: String(b.text || '').slice(0, 2000),
        ...(b.type === 'todo' ? { done: !!b.done } : {}),
      });
    }
  }
  return out;
}

/* Texto simples do conteúdo, usado no corpo do email e como prévia */
function plainText(blocks) {
  return blocks
    .filter(b => b.type !== 'img' && b.text)
    .map(b => (b.type === 'todo' ? (b.done ? '[x] ' : '[ ] ') : b.type === 'bullet' ? '• ' : '') + b.text)
    .join('\n')
    .slice(0, 1000) || null;
}

function attachFiles(items, userId) {
  if (items.length === 0) return items;
  const ids = items.map(i => i.id);
  const rows = db.prepare(
    `SELECT id, item_id, path FROM attachments WHERE user_id = ? AND item_id IN (${ids.map(() => '?').join(',')})`
  ).all(userId, ...ids);
  const byItem = {};
  for (const r of rows) (byItem[r.item_id] ||= []).push({ id: r.id, path: r.path });
  const comps = db.prepare(
    `SELECT item_id, date FROM completions WHERE user_id = ? AND item_id IN (${ids.map(() => '?').join(',')})`
  ).all(userId, ...ids);
  const doneBy = {};
  for (const c of comps) (doneBy[c.item_id] ||= []).push(c.date);

  return items.map(i => {
    let content = [];
    try { content = JSON.parse(i.content || '[]'); } catch {}
    return { ...i, content, attachments: byItem[i.id] || [], completions: doneBy[i.id] || [] };
  });
}

// GET /api/items?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/', (req, res) => {
  const { from, to } = req.query;
  let rows;
  if (from && to) {
    // qualquer item cujo intervalo cruza a janela pedida
    // itens com repetição podem cair na janela mesmo começando antes dela
    rows = db.prepare(`
      SELECT * FROM items
      WHERE user_id = ? AND (
        (repeat = 'none' AND start_date <= ? AND end_date >= ?) OR
        (repeat != 'none' AND start_date <= ?)
      )
      ORDER BY priority DESC, start_date, (time IS NULL) DESC, time
    `).all(req.userId, to, from, to);
  } else {
    rows = db.prepare(`
      SELECT * FROM items WHERE user_id = ?
      ORDER BY priority DESC, start_date, (time IS NULL) DESC, time
    `).all(req.userId);
  }
  res.json({ items: attachFiles(rows, req.userId) });
});

router.post('/', upload.array('photos', 6), (req, res) => {
  const b = req.body;
  const title = (b.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Título é obrigatório' });
  if (!b.start_date) return res.status(400).json({ error: 'Data é obrigatória' });

  const kind = b.kind === 'task' ? 'task' : 'event';
  const start = b.start_date;
  let end = b.end_date || start;
  if (end < start) end = start;
  const time = b.time ? b.time : null;
  // hora de fim só existe se houver hora de início, e precisa ser depois dela
  let endTime = time && b.end_time && b.end_time > time ? b.end_time : null;

  const blocks = resolveBlocks(b.content, req.files || []);
  const repeat = Object.keys(R.REPEATS).includes(b.repeat) ? b.repeat : 'none';
  const priority = [0, 1, 2].includes(Number(b.priority)) ? Number(b.priority) : 1;
  const nag = b.nag === 'true' || b.nag === true || b.nag === '1' ? 1 : 0;

  const info = db.prepare(`
    INSERT INTO items (user_id, kind, title, description, content, start_date, end_date, time, end_time, repeat, priority, nag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.userId, kind, title, plainText(blocks), JSON.stringify(blocks), start, end, time, endTime, repeat, priority, nag);

  const itemId = info.lastInsertRowid;
  const ins = db.prepare('INSERT INTO attachments (item_id, user_id, path, original_name, block_id) VALUES (?, ?, ?, ?, ?)');
  for (const blk of blocks.filter(x => x.type === 'img')) {
    ins.run(itemId, req.userId, blk.src, null, blk.id || null);
  }

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  res.json({ item: attachFiles([item], req.userId)[0] });
});

router.put('/:id', upload.array('photos', 6), (req, res) => {
  const cur = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!cur) return res.status(404).json({ error: 'Item não encontrado' });

  const b = req.body;
  const start = b.start_date || cur.start_date;
  let end = b.end_date || cur.end_date;
  if (end < start) end = start;
  // time: '' limpa explicitamente, undefined mantém
  const time = b.time === undefined ? cur.time : (b.time === '' ? null : b.time);
  const rawEnd = b.end_time === undefined ? cur.end_time : (b.end_time === '' ? null : b.end_time);
  const endTime = time && rawEnd && rawEnd > time ? rawEnd : null;

  const blocks = resolveBlocks(b.content, req.files || []);

  const repeat = Object.keys(R.REPEATS).includes(b.repeat) ? b.repeat : cur.repeat;
  const priority = [0, 1, 2].includes(Number(b.priority)) ? Number(b.priority) : cur.priority;
  const nag = b.nag === undefined ? cur.nag : (b.nag === 'true' || b.nag === true || b.nag === '1' ? 1 : 0);

  db.prepare(`
    UPDATE items SET kind=?, title=?, description=?, content=?, start_date=?, end_date=?, time=?, end_time=?,
      repeat=?, priority=?, nag=?, notified=0, last_notified=NULL
    WHERE id=? AND user_id=?
  `).run(
    b.kind === 'task' || b.kind === 'event' ? b.kind : cur.kind,
    (b.title || cur.title).trim(),
    plainText(blocks), JSON.stringify(blocks),
    start, end, time, endTime, repeat, priority, nag,
    req.params.id, req.userId
  );

  // reconcilia anexos: apaga do disco as imagens que saíram do conteúdo
  const keep = new Set(blocks.filter(x => x.type === 'img').map(x => x.src));
  const old = db.prepare('SELECT * FROM attachments WHERE item_id = ? AND user_id = ?').all(cur.id, req.userId);
  for (const a of old) {
    if (!keep.has(a.path)) {
      fs.unlink(path.join(__dirname, '..', a.path), () => {});
      db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
    }
  }
  const known = new Set(old.map(a => a.path));
  const ins = db.prepare('INSERT INTO attachments (item_id, user_id, path, original_name, block_id) VALUES (?, ?, ?, ?, ?)');
  for (const blk of blocks.filter(x => x.type === 'img')) {
    if (!known.has(blk.src)) ins.run(cur.id, req.userId, blk.src, null, blk.id || null);
  }

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(cur.id);
  res.json({ item: attachFiles([item], req.userId)[0] });
});

/* Conclusão é sempre por data: um lembrete que se repete é concluído
   em cada ocorrência, não de uma vez para sempre. */
router.put('/:id/done', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!item) return res.status(404).json({ error: 'Item não encontrado' });

  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : item.start_date;
  const done = !!req.body.done;

  if (done) {
    db.prepare('INSERT OR IGNORE INTO completions (item_id, user_id, date) VALUES (?, ?, ?)')
      .run(item.id, req.userId, date);
  } else {
    db.prepare('DELETE FROM completions WHERE item_id = ? AND user_id = ? AND date = ?')
      .run(item.id, req.userId, date);
  }
  // item sem repetição mantém o campo antigo em dia, para consultas simples
  if ((item.repeat || 'none') === 'none') {
    db.prepare('UPDATE items SET done = ? WHERE id = ?').run(done ? 1 : 0, item.id);
  }
  res.json({ ok: true, done, date });
});

router.delete('/:id', (req, res) => {
  const files = db.prepare('SELECT path FROM attachments WHERE item_id = ? AND user_id = ?')
    .all(req.params.id, req.userId);
  for (const f of files) fs.unlink(path.join(__dirname, '..', f.path), () => {});
  db.prepare('DELETE FROM attachments WHERE item_id = ? AND user_id = ?').run(req.params.id, req.userId);
  db.prepare('DELETE FROM completions WHERE item_id = ? AND user_id = ?').run(req.params.id, req.userId);
  db.prepare('DELETE FROM items WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ ok: true });
});

router.delete('/:id/attachments/:attId', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ? AND item_id = ? AND user_id = ?')
    .get(req.params.attId, req.params.id, req.userId);
  if (!a) return res.status(404).json({ error: 'Anexo não encontrado' });
  fs.unlink(path.join(__dirname, '..', a.path), () => {});
  db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
  res.json({ ok: true });
});

module.exports = router;
