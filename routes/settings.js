const express = require('express');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

router.get('/', (req, res) => {
  const u = db.prepare('SELECT digest_morning_time, digest_split_time, digest_enabled FROM users WHERE id = ?')
    .get(req.userId);
  res.json({
    digestMorningTime: u.digest_morning_time || '07:00',
    digestSplitTime: u.digest_split_time || '14:00',
    digestEnabled: !!u.digest_enabled,
  });
});

router.put('/', (req, res) => {
  const { digestMorningTime, digestSplitTime, digestEnabled } = req.body;
  if (digestMorningTime !== undefined && !TIME_RE.test(digestMorningTime)) {
    return res.status(400).json({ error: 'Horário da manhã inválido' });
  }
  if (digestSplitTime !== undefined && !TIME_RE.test(digestSplitTime)) {
    return res.status(400).json({ error: 'Horário da tarde inválido' });
  }

  const cur = db.prepare('SELECT digest_morning_time, digest_split_time, digest_enabled FROM users WHERE id = ?')
    .get(req.userId);
  const morning = digestMorningTime !== undefined ? digestMorningTime : cur.digest_morning_time;
  const split = digestSplitTime !== undefined ? digestSplitTime : cur.digest_split_time;
  const enabled = digestEnabled !== undefined ? (digestEnabled ? 1 : 0) : cur.digest_enabled;

  db.prepare('UPDATE users SET digest_morning_time = ?, digest_split_time = ?, digest_enabled = ? WHERE id = ?')
    .run(morning, split, enabled, req.userId);

  res.json({ ok: true, digestMorningTime: morning, digestSplitTime: split, digestEnabled: !!enabled });
});

module.exports = router;
