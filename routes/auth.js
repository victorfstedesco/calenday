const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { signToken } = require('../middleware/auth');

const router = express.Router();

router.post('/register', (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Usuário já existe' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)')
    .run(username, hash, email || null);

  const token = signToken(info.lastInsertRowid);
  res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 180 * 24 * 60 * 60 * 1000 });
  res.json({ ok: true, userId: info.lastInsertRowid });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  }
  const token = signToken(user.id);
  res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 180 * 24 * 60 * 60 * 1000 });
  res.json({ ok: true, userId: user.id });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const jwt = require('jsonwebtoken');
  const { SECRET } = require('../middleware/auth');
  try {
    const payload = jwt.verify(req.cookies.token, SECRET);
    const user = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(payload.userId);
    res.json({ user });
  } catch {
    res.json({ user: null });
  }
});

module.exports = router;
