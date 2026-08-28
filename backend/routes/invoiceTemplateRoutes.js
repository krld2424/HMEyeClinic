import express from 'express';
import mongoose from 'mongoose';
import InvoiceTemplate from '../models/InvoiceTemplate.js';
import ClinicOperation from '../models/ClinicOperation.js';
import AuditLog from '../models/AuditLog.js';
import { requireAuth, allowRoles } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth, allowRoles('owner'));

const validFields = new Set(['business_name', 'business_address', 'business_contact', 'business_logo', 'invoice_number', 'invoice_date', 'due_date', 'customer_name', 'customer_address', 'customer_phone', 'customer_email', 'invoice_items', 'subtotal', 'discount', 'tax', 'total_amount', 'amount_paid', 'outstanding_balance', 'payment_method', 'payment_reference', 'payment_date']);
const allowedTypes = new Set(['text', 'heading', 'image', 'divider', 'line', 'spacer', 'signature', 'footer', 'field', 'customer', 'items-table', 'total', 'payment', 'shape']);

const validateTemplate = (body) => {
  if (!body.name?.trim()) return 'Template name is required.';
  if (!body.templateData || !Array.isArray(body.templateData.elements)) return 'A template must contain an element layout.';
  if (!['A4', 'Letter', 'Legal'].includes(body.paperSize || 'A4')) return 'Invalid paper size.';
  if (!['portrait', 'landscape'].includes(body.orientation || 'portrait')) return 'Invalid orientation.';
  if (body.templateData.elements.some((element) => !element || !allowedTypes.has(element.type) || (element.field && !validFields.has(element.field)))) return 'The template contains an invalid element or dynamic field.';
  return null;
};

router.get('/', async (req, res) => {
  let template = await InvoiceTemplate.findOne({ isDefault: true }).populate('createdBy', 'name email role');
  if (!template) {
    template = await InvoiceTemplate.findOne().populate('createdBy', 'name email role');
    if (!template) {
      const defaultElements = [
        { id: `element-${Date.now()}-1`, type: 'image', x: 48, y: 42, w: 120, h: 70 },
        { id: `element-${Date.now()}-2`, type: 'heading', text: '{{business_name}}', field: 'business_name', x: 180, y: 42, w: 310, h: 38, style: { size: 20, bold: true } },
        { id: `element-${Date.now()}-3`, type: 'text', text: '{{business_address}}', field: 'business_address', x: 180, y: 80, w: 310, h: 36, style: { size: 10 } },
        { id: `element-${Date.now()}-4`, type: 'heading', text: 'INVOICE', x: 500, y: 42, w: 240, h: 36, style: { size: 26, bold: true, align: 'right' } },
        { id: `element-${Date.now()}-5`, type: 'text', text: 'Invoice #: {{invoice_number}}\nDate: {{invoice_date}}\nDue: {{due_date}}', x: 500, y: 80, w: 240, h: 66, style: { size: 10, align: 'right' } },
        { id: `element-${Date.now()}-6`, type: 'customer', x: 48, y: 188, w: 330, h: 105, style: { size: 12 } },
        { id: `element-${Date.now()}-7`, type: 'items-table', x: 48, y: 330, w: 682, h: 160, style: { size: 11 } },
        { id: `element-${Date.now()}-8`, type: 'total', x: 450, y: 525, w: 280, h: 118, style: { size: 12 } },
        { id: `element-${Date.now()}-9`, type: 'footer', text: 'Thank you for trusting us with your vision.', x: 48, y: 1015, w: 682, h: 28, style: { size: 10, align: 'center' } },
      ];
      template = await InvoiceTemplate.create({
        name: 'Default Invoice Template',
        isDefault: true,
        templateData: { version: 1, elements: defaultElements },
        paperSize: 'A4',
        orientation: 'portrait',
        createdBy: req.user.id
      });
      template = await InvoiceTemplate.findById(template._id).populate('createdBy', 'name email role');
    } else {
      template.isDefault = true;
      await template.save();
    }
  }
  res.json({ templates: [template] });
});

router.get('/default', async (_req, res) => {
  const template = await InvoiceTemplate.findOne({ isDefault: true });
  res.json({ template });
});

router.get('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid template ID.' });
  const template = await InvoiceTemplate.findById(req.params.id).populate('createdBy', 'name email role');
  if (!template) return res.status(404).json({ message: 'Invoice template not found.' });
  return res.json({ template });
});

router.post('/', async (req, res) => {
  const existing = await InvoiceTemplate.findOne();
  if (existing) {
    return res.status(400).json({ message: 'Only one invoice template is allowed. Please update the existing template.' });
  }
  const error = validateTemplate(req.body || {});
  if (error) return res.status(400).json({ message: error });
  const body = req.body;
  const template = await InvoiceTemplate.create({ ...body, name: body.name.trim(), isDefault: true, createdBy: req.user.id });
  await AuditLog.create({ actorId: req.user.id, action: 'Created invoice template', target: `invoice-template:${template._id}`, newData: template.toObject() });
  return res.status(201).json({ message: 'Invoice template saved.', template });
});

router.patch('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid template ID.' });
  const template = await InvoiceTemplate.findById(req.params.id);
  if (!template) return res.status(404).json({ message: 'Invoice template not found.' });
  const next = { ...template.toObject(), ...req.body };
  const error = validateTemplate(next);
  if (error) return res.status(400).json({ message: error });
  const before = template.toObject();
  Object.assign(template, req.body, { name: req.body.name?.trim() || template.name, isDefault: true });
  await template.save();
  await AuditLog.create({ actorId: req.user.id, action: 'Updated invoice template', target: `invoice-template:${template._id}`, previousData: before, newData: template.toObject() });
  return res.json({ message: 'Invoice template saved.', template });
});

router.post('/:id/duplicate', async (req, res) => {
  return res.status(400).json({ message: 'Duplicating templates is not supported because only one template is allowed.' });
});

router.post('/:id/default', async (req, res) => {
  return res.status(400).json({ message: 'Only one template is allowed, which is default by default.' });
});

router.delete('/:id', async (req, res) => {
  return res.status(400).json({ message: 'The invoice template cannot be deleted because a single template is required by the clinic.' });
});

export default router;
