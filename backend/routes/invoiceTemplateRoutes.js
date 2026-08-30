import express from 'express';
import mongoose from 'mongoose';
import InvoiceTemplate from '../models/InvoiceTemplate.js';
import ClinicOperation from '../models/ClinicOperation.js';
import AuditLog from '../models/AuditLog.js';
import { requireAuth, allowRoles } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth, allowRoles('owner'));

const validFields = new Set(['business_name', 'business_address', 'business_contact', 'business_email', 'business_logo', 'invoice_number', 'invoice_date', 'due_date', 'customer_name', 'customer_address', 'customer_phone', 'customer_email', 'invoice_items', 'subtotal', 'discount', 'tax', 'total_amount', 'amount_paid', 'outstanding_balance', 'payment_method', 'payment_reference', 'payment_date']);
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
  try {
    let template = await InvoiceTemplate.findOne({ isDefault: true }).populate('createdBy', 'name email role');
    if (!template) {
      template = await InvoiceTemplate.findOne().populate('createdBy', 'name email role');
      if (!template) {
        const defaultElements = [
          { id: `element-${Date.now()}-1`, type: 'heading', text: 'Invoice', x: 48, y: 30, w: 680, h: 28, style: { size: 22, bold: true } },
          
          { id: `element-${Date.now()}-2`, type: 'heading', text: 'Invoice To', x: 48, y: 75, w: 310, h: 18, style: { size: 11, bold: true } },
          { id: `element-${Date.now()}-3`, type: 'customer', x: 48, y: 100, w: 310, h: 55, style: { size: 10 } },
          
          { id: `element-${Date.now()}-4`, type: 'heading', text: 'Invoice Details:', x: 390, y: 75, w: 330, h: 18, style: { size: 11, bold: true, align: 'right' } },
          { id: `element-${Date.now()}-5`, type: 'text', text: 'Invoice No: {{invoice_number}}\nInvoice Date: {{invoice_date}}', x: 390, y: 100, w: 330, h: 55, style: { size: 10, align: 'right' } },
          
          { id: `element-${Date.now()}-6`, type: 'items-table', x: 48, y: 170, w: 680, h: 240, style: { size: 10 } },
          
          { id: `element-${Date.now()}-7`, type: 'heading', text: 'Terms and Conditions:', x: 48, y: 420, w: 680, h: 16, style: { size: 10, bold: true } },
          { id: `element-${Date.now()}-8`, type: 'text', text: 'Please send payment within 30 days', x: 48, y: 440, w: 680, h: 24, style: { size: 10 } },
          
          { id: `element-${Date.now()}-9`, type: 'divider', x: 48, y: 480, w: 680, h: 1, style: { color: '#cbd5e1' } },
          
          { id: `element-${Date.now()}-10`, type: 'image', x: 48, y: 500, w: 60, h: 40 },
          { id: `element-${Date.now()}-11`, type: 'text', text: '{{business_name}}', x: 115, y: 500, w: 150, h: 18, style: { size: 9, bold: true } },
          { id: `element-${Date.now()}-12`, type: 'text', text: '{{business_contact}}', x: 115, y: 518, w: 200, h: 18, style: { size: 9 } },
          { id: `element-${Date.now()}-13`, type: 'text', text: '{{business_email}}', x: 330, y: 500, w: 330, h: 36, style: { size: 9, align: 'right' } },
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
  } catch (error) {
    console.error('Invoice template GET error:', error);
    res.status(500).json({ message: 'Unable to load invoice templates.' });
  }
});

router.get('/default', async (_req, res) => {
  try {
    const template = await InvoiceTemplate.findOne({ isDefault: true });
    res.json({ template });
  } catch (error) {
    console.error('Invoice template GET default error:', error);
    res.status(500).json({ message: 'Unable to load default template.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid template ID.' });
    const template = await InvoiceTemplate.findById(req.params.id).populate('createdBy', 'name email role');
    if (!template) return res.status(404).json({ message: 'Invoice template not found.' });
    return res.json({ template });
  } catch (error) {
    console.error('Invoice template GET by ID error:', error);
    res.status(500).json({ message: 'Unable to load template.' });
  }
});

router.post('/', async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Invoice template POST error:', error);
    res.status(500).json({ message: 'Unable to save template.' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Invoice template PATCH error:', error);
    res.status(500).json({ message: 'Unable to save template.' });
  }
});

router.post('/:id/duplicate', async (req, res) => {
  return res.status(400).json({ message: 'Duplicating templates is not supported because only one template is allowed.' });
});

router.post('/:id/default', async (req, res) => {
  return res.status(400).json({ message: 'Only one template is allowed, which is default by default.' });
});

router.delete('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid template ID.' });
    const template = await InvoiceTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: 'Invoice template not found.' });

    const before = template.toObject();
    await InvoiceTemplate.findByIdAndDelete(req.params.id);
    await AuditLog.create({ actorId: req.user.id, action: 'Deleted invoice template', target: `invoice-template:${template._id}`, previousData: before });

    // Ensure at least one default template exists
    const existingTemplate = await InvoiceTemplate.findOne();
    if (!existingTemplate) {
      const defaultElements = [
        { id: `element-${Date.now()}-1`, type: 'heading', text: 'Invoice', x: 48, y: 30, w: 680, h: 28, style: { size: 22, bold: true } },
        { id: `element-${Date.now()}-2`, type: 'heading', text: 'Invoice To', x: 48, y: 75, w: 310, h: 18, style: { size: 11, bold: true } },
        { id: `element-${Date.now()}-3`, type: 'customer', x: 48, y: 100, w: 310, h: 55, style: { size: 10 } },
        { id: `element-${Date.now()}-4`, type: 'heading', text: 'Invoice Details:', x: 390, y: 75, w: 330, h: 18, style: { size: 11, bold: true, align: 'right' } },
        { id: `element-${Date.now()}-5`, type: 'text', text: 'Invoice No: {{invoice_number}}\nInvoice Date: {{invoice_date}}', x: 390, y: 100, w: 330, h: 55, style: { size: 10, align: 'right' } },
        { id: `element-${Date.now()}-6`, type: 'items-table', x: 48, y: 170, w: 680, h: 240, style: { size: 10 } },
        { id: `element-${Date.now()}-7`, type: 'heading', text: 'Terms and Conditions:', x: 48, y: 420, w: 680, h: 16, style: { size: 10, bold: true } },
        { id: `element-${Date.now()}-8`, type: 'text', text: 'Please send payment within 30 days', x: 48, y: 440, w: 680, h: 24, style: { size: 10 } },
        { id: `element-${Date.now()}-9`, type: 'divider', x: 48, y: 480, w: 680, h: 1, style: { color: '#cbd5e1' } },
        { id: `element-${Date.now()}-10`, type: 'image', x: 48, y: 500, w: 60, h: 40 },
        { id: `element-${Date.now()}-11`, type: 'text', text: '{{business_name}}', x: 115, y: 500, w: 150, h: 18, style: { size: 9, bold: true } },
        { id: `element-${Date.now()}-12`, type: 'text', text: '{{business_contact}}', x: 115, y: 518, w: 200, h: 18, style: { size: 9 } },
        { id: `element-${Date.now()}-13`, type: 'text', text: '{{business_email}}', x: 330, y: 500, w: 330, h: 36, style: { size: 9, align: 'right' } },
      ];
      await InvoiceTemplate.create({
        name: 'Default Invoice Template',
        isDefault: true,
        templateData: { version: 1, elements: defaultElements },
        paperSize: 'A4',
        orientation: 'portrait',
        createdBy: req.user.id
      });
    }

    res.json({ message: 'Template removed. Reset to default template.' });
  } catch (error) {
    console.error('Invoice template DELETE error:', error);
    res.status(500).json({ message: 'Unable to delete template.' });
  }
});

export default router;
