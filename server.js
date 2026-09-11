require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const webpush = require('web-push');
const path = require('path');

const authRoutes = require('./routes/auth');
const itemRoutes = require('./routes/items');
const pushRoutes = require('./routes/push');
const notifier = require('./services/notifier');

const app = express();
const PORT = process.env.PORT || 3000;

// Atrás do nginx: necessário para cookies "secure" funcionarem
app.set('trust proxy', 1);

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn('AVISO: chaves VAPID ausentes no .env. Rode: node scripts/generate-vapid.js');
}

app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/push', pushRoutes);

// Erros de upload (tamanho, tipo de arquivo) viram JSON em vez de HTML
app.use((err, req, res, next) => {
  if (err) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Imagem acima de 8 MB' : err.message;
    return res.status(400).json({ error: msg });
  }
  next();
});

app.listen(PORT, () => {
  console.log('Servidor na porta ' + PORT);
  notifier.start();
});
