import ClaimStub from '../models/ClaimStub.js';

export const claimStubItemKeys = [
  ['Professional Fee', 'professionalfee'],
  ['Frame', 'frame'],
  ['Lens', 'lens'],
  ['Contact Lens', 'contactlens'],
  ['Ophthalmic Drops', 'ophthalmicdrops'],
  ['Others', 'others'],
];

export const parseRecordDetails = (details) => {
  if (!details) return {};
  if (typeof details === 'object') return details;
  try {
    return JSON.parse(details);
  } catch {
    return {};
  }
};

export const claimStubFromRecordDetails = (details = {}, { patientUser, sourceRecordId, createdBy } = {}) => {
  const data = parseRecordDetails(details);
  const items = Object.fromEntries(
    claimStubItemKeys.map(([, key]) => [
      key,
      {
        from: data[`claim_${key}_from`] || '',
        less: data[`claim_${key}_less`] || '',
        to: data[`claim_${key}_to`] || '',
      },
    ])
  );

  return {
    patientId: patientUser?._id,
    patientName: data.claimPatientName || patientUser?.name || '',
    patientEmail: patientUser?.email && !String(patientUser.email).includes('@patient.local') ? patientUser.email : '',
    visitDate: data.visitDate || data.date || '',
    dueDate: data.claimDueDate || data.dueDate || '',
    downPayment: data.claimDownPayment || '',
    balance: data.claimBalance || '',
    items,
    sourceRecordId,
    createdBy,
  };
};

export const publicClaimStub = (stub) => {
  if (!stub) return null;
  const source = typeof stub.toObject === 'function' ? stub.toObject() : stub;
  return {
    _id: String(source._id),
    id: String(source._id),
    patientId: source.patientId ? String(source.patientId) : null,
    patientName: source.patientName || '',
    patientEmail: source.patientEmail || '',
    visitDate: source.visitDate || '',
    dueDate: source.dueDate || '',
    downPayment: source.downPayment || '',
    balance: source.balance || '',
    items: source.items || {},
    status: source.status || 'not-claimed',
    archived: Boolean(source.archived),
    sourceRecordId: source.sourceRecordId ? String(source.sourceRecordId) : null,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
};

export const upsertClaimStubForRecord = async ({ record, patientUser, createdBy }) => {
  if (!record || !patientUser) return null;
  const payload = claimStubFromRecordDetails(record.details, {
    patientUser,
    sourceRecordId: record._id,
    createdBy,
  });
  const hasClaimContent = Boolean(
    payload.patientName ||
    payload.visitDate ||
    payload.dueDate ||
    payload.downPayment ||
    payload.balance ||
    Object.values(payload.items || {}).some((line) => line.from || line.less || line.to)
  );
  if (!hasClaimContent) return null;

  const existing = await ClaimStub.findOne({ sourceRecordId: record._id, archived: { $ne: true } });
  if (existing) {
    existing.set({
      patientId: payload.patientId,
      patientName: payload.patientName,
      patientEmail: payload.patientEmail,
      visitDate: payload.visitDate,
      dueDate: payload.dueDate,
      downPayment: payload.downPayment,
      balance: payload.balance,
      items: payload.items,
    });
    await existing.save();
    return existing;
  }

  return ClaimStub.create({
    ...payload,
    status: 'not-claimed',
  });
};
