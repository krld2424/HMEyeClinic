import mongoose from 'mongoose';

const operationTypes = [
  'supplier',
  'purchase-order',
  'receiving',
  'inventory-item',
  'stock-in',
  'stock-out',
  'stock-adjustment',
  'stock-reservation',
  'stock-return',
  'stock-transfer',
  'invoice',
  'payment',
];

const clinicOperationSchema = new mongoose.Schema({
  recordType: { type: String, enum: operationTypes, required: true, index: true },
  operationKey: { type: String, trim: true },
  status: { type: String, default: 'active' },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
  inventoryApplied: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

clinicOperationSchema.index(
  { recordType: 1, operationKey: 1 },
  { unique: true, sparse: true }
);
clinicOperationSchema.index(
  { recordType: 1, 'data.sku': 1 },
  { unique: true, partialFilterExpression: { recordType: 'inventory-item', 'data.sku': { $type: 'string' } } }
);

const ClinicOperation = mongoose.models.ClinicOperation
  || mongoose.model('ClinicOperation', clinicOperationSchema);

export { operationTypes };
export default ClinicOperation;
