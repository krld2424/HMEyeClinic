import mongoose from 'mongoose';

const clinicalRecordSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['medical-record', 'clinical-note', 'consultation', 'prescription'], required: true },
    title: { type: String, required: true, trim: true },
    details: { type: String, required: true, trim: true },
    status: { type: String, enum: ['active', 'completed', 'expired'], default: 'active' },
    issuedAt: { type: String, trim: true },
  },
  { timestamps: true }
);

const ClinicalRecord = mongoose.models.ClinicalRecord || mongoose.model('ClinicalRecord', clinicalRecordSchema);

export default ClinicalRecord;
