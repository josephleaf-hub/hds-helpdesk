// Page-agnostic label/config maps — ported from shared.js + the portal/admin pages.

export const CAT_LABEL: Record<string, string> = {
  access: 'Access Request', hardware: 'Hardware Request', account: 'Account Setup', support: 'IT Support',
};

export const STATUS_LABEL: Record<string, string> = {
  new: 'New', 'in-progress': 'In Progress', 'waiting-on-admin': 'Waiting on Admin',
  'waiting-on-requester': 'Waiting on Requester', 'on-hold': 'On Hold', resolved: 'Resolved', closed: 'Closed',
};

// Requester-facing status labels (portal): the requester sees "IT to respond"
// rather than the internal "Waiting on Admin".
export const PORTAL_STATUS: Record<string, string> = { ...STATUS_LABEL, 'waiting-on-admin': 'IT to respond' };

export const PRI_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };

export const IT_TEAM = ['IT Level 1', 'IT Level 2', 'Senior Engineer', 'IT Manager'];

export const DEPARTMENTS = [
  'Operations', 'Technology', 'Finance', 'Sales', 'Customer Service',
  'HR & People', 'Leadership', 'Marketing', 'Warehouse', 'Driver / Field',
];

export const LOCATIONS = [
  'HQ - VIC, Toorak',
  'DC - VIC, Clayton South',
  'DC - VIC, Dandenong South',
  'DC - VIC, Ravenhall',
  'DC - NSW, Wetherill Park',
  'DC - NSW, Tamworth',
  'DC - NSW, Eastern Creek',
  'DC - QLD, Morningside Bldg 7',
  'DC - QLD, Morningside Bldg 12',
  'DC - QLD, Acacia Ridge',
  'DC - WA, Jandakot',
  'DC - SA, Dry Creek',
  'DC - TAS, Hobart',
  'DC - ACT, Canberra',
  'Remote',
];

export const SUB_TYPES: Record<string, string[]> = {
  access:   ['New System Access', 'Modify Existing Access', 'VPN / Remote Access', 'Application License', 'Remove / Revoke Access'],
  hardware: ['New Laptop', 'Laptop Replacement', 'Monitor / Peripheral', 'Mobile Device', 'Headset / Audio', 'Other Hardware'],
  account:  ['New Starter Setup', 'Leaver Account Deactivation', 'Password Reset', 'Email & Signature Setup', 'Profile / Name Change'],
  support:  ['Software Not Working', 'Hardware Fault', 'Network / Connectivity', 'Email Problem', 'Printing / Scanning', 'Other'],
};

export const STATUS_ORDER: Record<string, number> = {
  new: 0, 'in-progress': 1, 'waiting-on-admin': 2, 'waiting-on-requester': 3, 'on-hold': 4, resolved: 5, closed: 6,
};
export const PRI_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export const ALLOWED_DOMAINS = ['homedelivery.com.au', 'hdsau.com'];
