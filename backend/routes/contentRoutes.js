import express from 'express';
import { clinicContent } from '../config/clinicContent.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json(clinicContent);
});

export default router;
