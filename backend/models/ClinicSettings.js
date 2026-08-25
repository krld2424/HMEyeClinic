import mongoose from 'mongoose';

const clinicSettingsSchema = new mongoose.Schema({
  name: { type: String, default: 'Hernandez Mercado Eye Clinic' },
  phone: String,
  email: String,
  address: String,
  hours: String,
  services: [String],
}, { timestamps: true });

const ClinicSettings = mongoose.models.ClinicSettings || mongoose.model('ClinicSettings', clinicSettingsSchema);

export default ClinicSettings;
