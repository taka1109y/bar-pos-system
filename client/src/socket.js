import { io } from 'socket.io-client';

const socket = io('/', {
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 1000,
});

export default socket;
