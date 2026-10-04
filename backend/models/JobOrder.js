import mongoose from 'mongoose';

export const jobOrderStatusOverrides = ['Ordered', 'In Process', 'Arrived', 'Claimed'];

export const getJobOrderStatus = (jobOrder) => {
  if (jobOrder.dateOfClaiming) return 'Claimed';
  if (jobOrder.statusOverride) return jobOrder.statusOverride;
  if (jobOrder.deliveryDate) return 'Arrived';
  if (jobOrder.orderDate) return 'Ordered';
  return 'Pending Order';
};

const jobOrderSchema = new mongoose.Schema({
  surname: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  contact: { type: String, required: true, trim: true },
  joNumber: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    match: [/^[\p{N}\p{P}\p{S}]+$/u, 'JO Number may contain numbers and special characters only.'],
  },
  transactionDate: { type: String, required: true, trim: true },
  orderDate: { type: String, trim: true, default: '' },
  frameModelColor: { type: String, required: true, trim: true },
  lensType: { type: String, required: true, trim: true },
  pickupByRider: { type: Boolean, default: false },
  pickupByRiderDate: { type: String, trim: true, default: '' },
  balance: { type: Number, min: 0, default: 0 },
  dueDate: { type: String, trim: true, default: '' },
  deliveryDate: { type: String, trim: true, default: '' },
  dateOfClaiming: { type: String, trim: true, default: '' },
  statusOverride: { type: String, enum: ['', ...jobOrderStatusOverrides], default: '' },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  archived: { type: Boolean, default: false, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

jobOrderSchema.index({ joNumber: 1 }, { unique: true });

const JobOrder = mongoose.models.JobOrder || mongoose.model('JobOrder', jobOrderSchema);

export default JobOrder;
