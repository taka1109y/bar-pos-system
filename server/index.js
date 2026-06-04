const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs   = require('fs');

const app = express();
const server = http.createServer(app);

// CLIENT_ORIGIN="*" の場合は全オリジンを許可（LAN結合テスト時のみ使用）
const rawOrigin = process.env.CLIENT_ORIGIN;
const allowedOrigins = rawOrigin === '*'
  ? true
  : ['http://localhost:5173', 'http://localhost:4173', 'http://localhost', rawOrigin].filter(Boolean);

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
});

// socketServiceにioを登録
const socketService = require('./services/socketService');
socketService.setIo(io);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// アップロード画像の静的配信（ローカル開発用 / Docker では Nginx が担当）
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// APIルート
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/tables', require('./routes/tables'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/reports',  require('./routes/reports'));
app.use('/api/prices',   require('./routes/prices'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/kitchen',  require('./routes/kitchen'));
app.use('/api/receipts', require('./routes/receipts'));
app.use('/api/system',       require('./routes/system'));
app.use('/api/maintenance',  require('./routes/maintenance'));
app.use('/api/logs',         require('./routes/logs'));
app.use('/api/inventory',    require('./routes/inventory'));
app.use('/api/ingredients',  require('./routes/ingredients'));
app.use('/api/recipes',      require('./routes/recipes'));

// Socket.io接続処理
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  socket.on('client:subscribe_table', ({ tableId }) => {
    socket.join(`table:${tableId}`);
  });

  socket.on('client:unsubscribe_table', ({ tableId }) => {
    socket.leave(`table:${tableId}`);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// 未マッチの /api/* → 404 (エラーハンドラーに落とす前に明示的に返す)
app.use('/api/', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// 本番環境ではReactのビルドを配信 (nginx構成時はサーバーコンテナにdistは存在しないため実質無効)
if (process.env.NODE_ENV === 'production' && process.env.SERVE_STATIC === 'true') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// エラーハンドラー
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;

async function main() {
  const { initDb } = require('./db/database');
  const { seed, seedSubcategories, ensureImmediateTable } = require('./db/seed');
  const { startPricingEngine } = require('./services/pricingEngine');

  await initDb();
  await seed();
  await seedSubcategories();
  await ensureImmediateTable();
  startPricingEngine();

  server.listen(PORT, () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
  });
}

main().catch((e) => {
  console.error('[Server] Fatal startup error:', e);
  process.exit(1);
});
