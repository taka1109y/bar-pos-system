const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost',
  process.env.CLIENT_ORIGIN,
].filter(Boolean);

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
});

// socketServiceにioを登録
const socketService = require('./services/socketService');
socketService.setIo(io);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// APIルート
app.use('/api/tables', require('./routes/tables'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/prices', require('./routes/prices'));

// Socket.io接続処理
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  socket.on('client:subscribe_table', ({ tableId }) => {
    socket.join(`table:${tableId}`);
  });

  socket.on('client:unsubscribe_table', ({ tableId }) => {
    socket.leave(`table:${tableId}`);
  });

  // お客さんがスタッフを呼ぶ
  socket.on('customer:call_staff', ({ tableId }) => {
    io.emit('staff:called', { tableId });
    console.log(`[Socket] Staff called for table ${tableId}`);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// 本番環境ではReactのビルドを配信
if (process.env.NODE_ENV === 'production') {
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
  const { seed } = require('./db/seed');
  const { startPricingEngine } = require('./services/pricingEngine');

  await initDb();
  await seed();
  startPricingEngine();

  server.listen(PORT, () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
  });
}

main().catch((e) => {
  console.error('[Server] Fatal startup error:', e);
  process.exit(1);
});
