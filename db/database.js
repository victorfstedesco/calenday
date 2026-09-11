const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'app.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  keys_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id),
  UNIQUE(user_id, endpoint)
);

-- Item unificado: kind = 'event' (acontece) ou 'task' (precisa ser feito)
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'event',
  title TEXT NOT NULL,
  description TEXT,
  start_date TEXT NOT NULL,        -- YYYY-MM-DD
  end_date TEXT NOT NULL,          -- YYYY-MM-DD (= start_date se for de um dia)
  time TEXT,                       -- HH:MM ou NULL (dia inteiro)
  done INTEGER DEFAULT 0,          -- só usado quando kind='task'
  notified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_items_user_dates ON items(user_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_items_pending ON items(notified, start_date);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  original_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachments_item ON attachments(item_id);
`);

// ---- migrações incrementais ----
const cols = db.prepare("PRAGMA table_info(items)").all().map(c => c.name);
if (!cols.includes('content')) {
  // conteúdo em blocos (JSON): texto, checkbox, lista numerada, imagem
  db.exec("ALTER TABLE items ADD COLUMN content TEXT");
  // converte descrições antigas em um bloco de parágrafo
  const legacy = db.prepare("SELECT id, description FROM items WHERE description IS NOT NULL AND content IS NULL").all();
  const upd = db.prepare("UPDATE items SET content = ? WHERE id = ?");
  for (const r of legacy) {
    upd.run(JSON.stringify([{ type: 'p', text: r.description }]), r.id);
  }
}

// anexos agora podem pertencer a um bloco específico do conteúdo
const acols = db.prepare("PRAGMA table_info(attachments)").all().map(c => c.name);
if (!acols.includes('block_id')) {
  db.exec("ALTER TABLE attachments ADD COLUMN block_id TEXT");
}

// repetição, prioridade e insistência do aviso
for (const [col, ddl] of [
  ['repeat',        "ALTER TABLE items ADD COLUMN repeat TEXT DEFAULT 'none'"],
  ['priority',      "ALTER TABLE items ADD COLUMN priority INTEGER DEFAULT 1"],
  ['nag',           "ALTER TABLE items ADD COLUMN nag INTEGER DEFAULT 0"],
  ['last_notified', "ALTER TABLE items ADD COLUMN last_notified TEXT"],
  ['end_time',      "ALTER TABLE items ADD COLUMN end_time TEXT"],
]) {
  if (!db.prepare("PRAGMA table_info(items)").all().map(c => c.name).includes(col)) db.exec(ddl);
}

/* Conclusões por data.
   Um item que se repete não tem um "done" só: ele é concluído a cada
   ocorrência. Cada linha aqui é "este item foi dado como feito neste dia". */
db.exec(`
CREATE TABLE IF NOT EXISTS completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(item_id, date),
  FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_completions_item ON completions(item_id);
`);

// migra o antigo done (booleano) para uma conclusão na data de início
const pending = db.prepare(`
  SELECT id, user_id, start_date FROM items
  WHERE done = 1 AND id NOT IN (SELECT item_id FROM completions)
`).all();
if (pending.length) {
  const ins = db.prepare('INSERT OR IGNORE INTO completions (item_id, user_id, date) VALUES (?, ?, ?)');
  for (const r of pending) ins.run(r.id, r.user_id, r.start_date);
}

module.exports = db;
