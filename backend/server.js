import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import bookingRoutes from './routes/bookingRoutes.js';
import followUpRoutes from './routes/followUpRoutes.js';
import clinicalRoutes from './routes/clinicalRoutes.js';
import workspaceRoutes from './routes/workspaceRoutes.js';
import authRoutes from './routes/authRoutes.js';
import contentRoutes from './routes/contentRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import { ensureSuperAdmin } from './config/superAdmin.js';
import { generalApiLimiter } from './middleware/rateLimit.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const configuredOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? configuredOrigins
  : [...new Set(['http://localhost:4321', ...configuredOrigins])];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS.'));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', generalApiLimiter);

app.get('/', (_req, res) => {
  res.status(200).json({
    service: 'Hernandez Mercado Eye Clinic API',
    status: 'ok',
    health: '/api/health',
  });
});

app.get('/api/health', (req, res) => {
  const mongoUri = process.env.MONGODB_URI || (process.env.NODE_ENV === 'production' ? '' : 'mongodb://127.0.0.1:27017/hm_visionsync');
  res.status(200).json({
    status: 'ok',
    service: 'Hernandez Mercado Eye Clinic API',
    database: mongoUri ? (mongoUri.startsWith('mongodb+srv://') ? 'Atlas configured' : 'Local MongoDB configured') : 'No MongoDB URI configured',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/appointments', bookingRoutes);
app.use('/api/follow-ups', followUpRoutes);
app.use('/api/clinical-records', clinicalRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/admin', adminRoutes);

const startServer = async () => {
  const databaseConnected = await connectDB();

  if (databaseConnected) {
    await ensureSuperAdmin();
  }

  app.listen(PORT, () => {
    console.log(`Backend server listening on port ${PORT}`);
  });
};

startServer();
