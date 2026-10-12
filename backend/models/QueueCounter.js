import mongoose from 'mongoose';

const queueCounterSchema = new mongoose.Schema({
  day: { type: String, required: true, unique: true },
  sequence: { type: Number, default: 0 },
});

export default mongoose.models.QueueCounter || mongoose.model('QueueCounter', queueCounterSchema);
