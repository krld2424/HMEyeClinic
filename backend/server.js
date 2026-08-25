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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'Hernandez Mercado Eye Clinic API',
    database: process.env.MONGODB_URI ? 'Atlas configured' : 'No MongoDB URI configured',
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
    console.log(`Backend server running on http://localhost:${PORT}`);
  });
};

startServer();
