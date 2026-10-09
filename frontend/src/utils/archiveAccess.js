export const archivedFetchPlan = {
  patient: ['clinical-records'],
  optometrist: ['appointments', 'clinical-records', 'claim-stubs'],
  'eye-care-assistant': ['appointments', 'clinical-records', 'claim-stubs'],
  owner: ['appointments', 'users', 'operations', 'clinical-records', 'claim-stubs'],
};

export function getArchivedFetchPlan(role) {
  return archivedFetchPlan[role] || [];
}
