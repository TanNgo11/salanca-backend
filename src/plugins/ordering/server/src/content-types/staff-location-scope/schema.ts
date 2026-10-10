import { collection } from '../internal';

export default collection(
  'staff-location-scope',
  {
    adminUserId: { type: 'integer', required: true, unique: true },
    allLocations: { type: 'boolean', required: true, default: false },
    locationRefs: { type: 'json', required: true },
    updatedBy: { type: 'string' },
  },
  { displayName: 'Phạm vi chi nhánh' },
);
