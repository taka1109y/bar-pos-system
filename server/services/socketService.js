let _io = null;

function setIo(io) {
  _io = io;
}

function broadcast(event, data) {
  if (_io) _io.emit(event, data);
}

function broadcastToRoom(room, event, data) {
  if (_io) _io.to(room).emit(event, data);
}

module.exports = { setIo, broadcast, broadcastToRoom };
