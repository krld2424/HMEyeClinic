import express from 'express';
import ClaimStub, { archivableClaimStubStatuses, claimStubStatuses } from '../models/ClaimStub.js';
import { requireAuth, allowRoles } from '../middleware/auth.js';
import { broadcastRealtimeEvent } from '../config/realtime.js';
import { publicClaimStub } from '../utils/claimStub.js';

const router = express.Router();
const staffRoles = ['owner', 'optometrist', 'eye-care-assistant'];

const staffFilter = (req) => {
  const archivedOnly = String(req.query.archived || '').toLowerCase() === 'true';
  return archivedOnly ? { archived: true } : { archived: { $ne: true } };
};

router.get('/mine', requireAuth, allowRoles('patient'), async (req, res) => {
  try {
    const stubs = await ClaimStub.find({ patientId: req.user.id, archived: { $ne: true } }).sort({ createdAt: -1 });
    return res.status(200).json({ claimStubs: stubs.map(publicClaimStub) });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load claim stubs.', error: error.message });
  }
});

router.get('/', requireAuth, allowRoles(...staffRoles), async (req, res) => {
  try {
    const stubs = await ClaimStub.find(staffFilter(req)).sort({ createdAt: -1 });
    return res.status(200).json({ claimStubs: stubs.map(publicClaimStub) });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load claim stubs.', error: error.message });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const stub = await ClaimStub.findById(req.params.id);
    if (!stub) return res.status(404).json({ message: 'Claim stub not found.' });
    const isStaff = staffRoles.includes(req.user.role);
    const isOwnerPatient = String(stub.patientId) === String(req.user.id);
    if (!isStaff && !isOwnerPatient) {
      return res.status(403).json({ message: 'You do not have permission to view this claim stub.' });
    }
    return res.status(200).json({ claimStub: publicClaimStub(stub) });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load claim stub.', error: error.message });
  }
});

router.patch('/:id/status', requireAuth, allowRoles(...staffRoles), async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!claimStubStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid claim stub status.' });
    }
    const stub = await ClaimStub.findById(req.params.id);
    if (!stub) return res.status(404).json({ message: 'Claim stub not found.' });
    stub.status = status;
    await stub.save();
    broadcastRealtimeEvent(req.app.get('io'), {
      type: 'claim-stub',
      action: 'updated',
      entityId: String(stub._id),
      payload: publicClaimStub(stub),
      roles: staffRoles,
      userIds: [String(stub.patientId)],
    });
    return res.status(200).json({ message: 'Claim stub status updated.', claimStub: publicClaimStub(stub) });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Unable to update claim stub status.' });
  }
});

router.patch('/:id/archive', requireAuth, allowRoles(...staffRoles), async (req, res) => {
  try {
    const archived = Boolean(req.body?.archived ?? true);
    const stub = await ClaimStub.findById(req.params.id);
    if (!stub) return res.status(404).json({ message: 'Claim stub not found.' });
    if (archived && !archivableClaimStubStatuses.includes(stub.status)) {
      return res.status(400).json({ message: 'Only claimed or not-yet-claimed stubs can be archived.' });
    }
    stub.archived = archived;
    await stub.save();
    broadcastRealtimeEvent(req.app.get('io'), {
      type: 'claim-stub',
      action: archived ? 'archived' : 'restored',
      entityId: String(stub._id),
      payload: publicClaimStub(stub),
      roles: staffRoles,
      userIds: [String(stub.patientId)],
    });
    return res.status(200).json({
      message: archived ? 'Claim stub archived.' : 'Claim stub restored.',
      claimStub: publicClaimStub(stub),
    });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Unable to archive claim stub.' });
  }
});

export default router;
