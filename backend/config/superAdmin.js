import bcrypt from 'bcryptjs';
import User from '../models/User.js';

export const ensureSuperAdmin = async () => {
  const { SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_NAME = 'HM VisionSync Super Admin' } = process.env;

  if (!SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
    console.warn('Super admin is not configured. Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD to provision it.');
    return;
  }

  const email = SUPER_ADMIN_EMAIL.toLowerCase();
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    if (existingUser.role === 'superadmin') {
      existingUser.role = 'owner';
      await existingUser.save();
      console.log(`Super admin account migrated to Owner for ${email}.`);
      return;
    }
    if (existingUser.role !== 'owner') {
      throw new Error('SUPER_ADMIN_EMAIL belongs to a non-owner account.');
    }
    return;
  }

  await User.create({
    name: SUPER_ADMIN_NAME,
    email,
    password: await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12),
    role: 'owner',
  });

  console.log(`Owner account provisioned for ${email}.`);
};
