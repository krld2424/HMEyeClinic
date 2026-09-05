import { io } from 'socket.io-client';

const EVENT_NAME = 'entity-change';
const MAX_SEEN = 500;

const getStore = () => {
  if (typeof window === 'undefined') return null;
  if (!window.__hmVisionRealtime) {
    window.__hmVisionRealtime = {
      socket: null,
      connecting: false,
      seen: new Set(),
      listeners: new Set(),
    };
  }
  return window.__hmVisionRealtime;
};

const rememberEvent = (store, eventId) => {
  if (!eventId || store.seen.has(eventId)) return false;
  store.seen.add(eventId);
  if (store.seen.size > MAX_SEEN) {
    const oldest = store.seen.values().next().value;
    store.seen.delete(oldest);
  }
  return true;
};

export const connectClinicRealtime = ({ apiUrl, token, onEvent }) => {
  const store = getStore();
  if (!store || !apiUrl || !token) {
    return () => {};
  }

  if (typeof onEvent === 'function') {
    store.listeners.add(onEvent);
  }

  if (!store.socket && !store.connecting) {
    store.connecting = true;
    store.socket = io(apiUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      timeout: 10000,
    });

    store.socket.on('connect', () => {
      store.connecting = false;
    });

    store.socket.on('connect_error', () => {
      store.connecting = false;
    });

    store.socket.on(EVENT_NAME, (event) => {
      if (!event || !rememberEvent(store, event.id)) return;
      store.listeners.forEach((listener) => {
        try {
          listener(event);
        } catch (error) {
          console.error('Realtime listener failed.', error);
        }
      });
    });
  }

  return () => {
    if (typeof onEvent === 'function') {
      store.listeners.delete(onEvent);
    }
  };
};
