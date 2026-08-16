let _io = null;

function setIo(io) {
  _io = io;
}

// broadcast は多くの場合 DB COMMIT 後・try 内で呼ばれるため、emit の例外が
// ロールバック/500 を誘発しないよう握りつぶす(通知失敗は致命ではない)。
function broadcast(event, data) {
  try {
    if (_io) _io.emit(event, data);
  } catch { /* 通知失敗は無視(会計等の確定処理は成功済み) */ }
}

function broadcastToRoom(room, event, data) {
  try {
    if (_io) _io.to(room).emit(event, data);
  } catch { /* 通知失敗は無視 */ }
}

module.exports = { setIo, broadcast, broadcastToRoom };
