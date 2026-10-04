import PatientNotification from '../models/PatientNotification.js';

export const createPatientNotification = ({ recipientId, eventKey, message, href }) => PatientNotification.updateOne(
  { eventKey },
  { $setOnInsert: { recipientId, eventKey, message, href } },
  { upsert: true }
);