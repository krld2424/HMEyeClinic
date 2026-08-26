import mongoose from 'mongoose';

const connectDB = async () => {
  const mongoUri = process.env.MONGODB_URI || (process.env.NODE_ENV === 'production' ? '' : 'mongodb://127.0.0.1:27017/hm_visionsync');

  if (!mongoUri) {
    throw new Error('MONGODB_URI must be configured in production.');
  }

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
    });
    console.log(`MongoDB connected successfully (${mongoUri.startsWith('mongodb+srv://') ? 'Atlas' : 'local'}).`);
    return true;
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    return false;
  }
};

export default connectDB;
