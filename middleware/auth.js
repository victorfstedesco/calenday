const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'troque-esta-chave-no-env';

function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const payload = jwt.verify(token, SECRET);
    req.userId = payload.userId;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sessão inválida' });
  }
}

function signToken(userId) {
  return jwt.sign({ userId }, SECRET, { expiresIn: '180d' });
}

module.exports = { requireAuth, signToken, SECRET };
