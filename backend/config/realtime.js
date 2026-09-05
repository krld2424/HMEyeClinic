import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'hm-visionsync-dev-secret';
const socketUsers = new Map();

const normalizeOrigin = (origin, allowedOrigins = []) => {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
};

const getTokenFromSocket = (socket) => {
  const authToken = socket.handshake.auth?.token || socket.handshake.query?.token;
  const headerToken = socket.handshake.headers?.authorization;

  if (authToken) {
    return String(authToken).replace(/^Bearer\s+/i, '');
  }

  if (headerToken) {
    return String(headerToken).replace(/^Bearer\s+/i, '');
  }

  return null;
};

export const publicUserPayload = (user) => {
  if (!user) return {};
  return {
    _id: String(user._id),
    id: String(user._id || user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    patientId: user.patientId || null,
    specialty: user.specialty,
    department: user.department,
    isActive: user.isActive !== false,
    phone: user.phone,
  };
};

export const publicAppointmentPayload = (appointment) => {
  if (!appointment) return {};
  const source = typeof appointment.toObject === 'function' ? appointment.toObject() : appointment;
  return {
    _id: String(source._id),
    id: String(source._id),
    name: source.name,
    email: source.email,
    phone: source.phone,
    service: source.service,
    preferredDate: source.preferredDate,
    preferredTime: source.preferredTime,
    status: source.status,
    userId: source.userId ? String(source.userId) : null,
    message: source.message,
  };
};

export const setupRealtime = (httpServer, allowedOrigins = []) => {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (normalizeOrigin(origin, allowedOrigins)) {
          callback(null, true);
          return;
        }
        callback(new Error('Origin is not allowed by Socket.IO CORS policy.'));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token = getTokenFromSocket(socket);
    if (!token) {
      return next(new Error('Authentication required.'));
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = {
        id: String(decoded.id || decoded._id || ''),
        role: decoded.role,
        email: decoded.email,
      };

      if (!user.id || !user.role) {
        return next(new Error('Invalid socket authentication payload.'));
      }

      socket.user = user;
      socket.join(`role:${user.role}`);
      socket.join(`user:${user.id}`);
      if (user.email) socket.join(`email:${String(user.email).toLowerCase()}`);
      socketUsers.set(socket.id, user);
      next();
    } catch {
      next(new Error('Invalid or expired socket token.'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('register-room', () => {
      // Rooms are assigned from the verified JWT only.
    });

    socket.on('leave-room', () => {
      // Rooms are assigned from the verified JWT only.
    });

    socket.on('disconnect', () => {
      socketUsers.delete(socket.id);
    });
  });

  return io;
};

const normalizeRooms = (rooms = []) => [...new Set((rooms || []).filter(Boolean).map((value) => String(value)))];

export const broadcastRealtimeEvent = async (io, { type, action, entityId, payload = {}, roles = [], userIds = [], emails = [], room = null }) => {
  if (!io) return null;

  const event = {
    id: `${type}:${action}:${entityId || payload?._id || Date.now()}:${Math.random().toString(36).slice(2, 9)}`,
    type,
    action,
    entityId: entityId || payload?._id || null,
    payload,
    timestamp: new Date().toISOString(),
  };

  const roomsToEmit = new Set();
  if (room) roomsToEmit.add(room);
  normalizeRooms(roles).forEach((role) => roomsToEmit.add(`role:${role}`));
  normalizeRooms(userIds).forEach((userId) => roomsToEmit.add(`user:${userId}`));
  normalizeRooms(emails).forEach((email) => roomsToEmit.add(`email:${String(email).toLowerCase()}`));

  if (roomsToEmit.size === 0) {
    return event;
  }

  const recipients = new Map();
  for (const target of roomsToEmit) {
    const sockets = await io.in(target).fetchSockets();
    sockets.forEach((socket) => recipients.set(socket.id, socket));
  }

  for (const socket of recipients.values()) {
    socket.emit('entity-change', event);
  }

  return event;
};

export const getSocketUsers = () => socketUsers;
