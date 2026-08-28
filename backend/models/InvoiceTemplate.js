import mongoose from 'mongoose';

const invoiceTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  templateData: { type: mongoose.Schema.Types.Mixed, required: true },
  paperSize: { type: String, enum: ['A4', 'Letter', 'Legal'], default: 'A4' },
  orientation: { type: String, enum: ['portrait', 'landscape'], default: 'portrait' },
  margins: { type: mongoose.Schema.Types.Mixed, default: () => ({ top: 18, right: 18, bottom: 18, left: 18 }) },
  isDefault: { type: Boolean, default: false, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

const InvoiceTemplate = mongoose.models.InvoiceTemplate || mongoose.model('InvoiceTemplate', invoiceTemplateSchema);

export default InvoiceTemplate;
