const express = require('express');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

router.post('/subscribe', requireAuth, (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Subscription inválida' });

  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, keys_json)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, endpoint) DO UPDATE SET keys_json = excluded.keys_json
  `).run(req.userId, sub.endpoint, JSON.stringify(sub.keys));

  res.json({ ok: true });
});

router.post('/unsubscribe', requireAuth, (req, res) => {
  const { endpoint } = req.body;
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(req.userId, endpoint);
  res.json({ ok: true });
});

module.exports = router;
