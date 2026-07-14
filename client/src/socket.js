import { io } from 'socket.io-client';
import { useConnStore } from './store/useConnStore';

const socket = io('/', {
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: Infinity,
  reconnectionDelayMax: 5000,
});

const setConnected = (v) => {
  try { useConnStore.getState().setConnected(v); } catch (_) { /* noop */ }
};
socket.on('connect',       () => setConnected(true));
socket.on('disconnect',    () => setConnected(false));
socket.on('connect_error', () => setConnected(false));

export default socket;
