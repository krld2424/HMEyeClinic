import mongoose from 'mongoose';

export const claimStubStatuses = ['not-claimed', 'claimed', 'partially-claimed', 'pending-verification', 'expired'];
export const archivableClaimStubStatuses = ['not-claimed', 'claimed'];

const moneyLineSchema = new mongoose.Schema(
  {
    from: { type: String, trim: true, default: '' },
    less: { type: String, trim: true, default: '' },
    to: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const claimStubSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    patientName: { type: String, trim: true, default: '' },
    patientEmail: { type: String, trim: true, default: '' },
    visitDate: { type: String, trim: true, default: '' },
    dueDate: { type: String, trim: true, default: '' },
    downPayment: { type: String, trim: true, default: '' },
    balance: { type: String, trim: true, default: '' },
    items: {
      professionalfee: { type: moneyLineSchema, default: () => ({}) },
      frame: { type: moneyLineSchema, default: () => ({}) },
      lens: { type: moneyLineSchema, default: () => ({}) },
      contactlens: { type: moneyLineSchema, default: () => ({}) },
      ophthalmicdrops: { type: moneyLineSchema, default: () => ({}) },
      others: { type: moneyLineSchema, default: () => ({}) },
    },
    status: {
      type: String,
      enum: claimStubStatuses,
      default: 'not-claimed',
      index: true,
    },
    archived: { type: Boolean, default: false, index: true },
    sourceRecordId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClinicalRecord', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

const ClaimStub = mongoose.models.ClaimStub || mongoose.model('ClaimStub', claimStubSchema);

export default ClaimStub;
