import { Navigate } from 'react-router-dom';

import { leadListPath } from './lead-shortcuts.helper';

/**
 * Top-level sidebar entries for the lead collections. The Content Manager owns
 * the real list route, so the shortcut route only forwards to it.
 */
export const createLeadListRedirect = (uid: string) => {
  const LeadListRedirect = () => <Navigate to={leadListPath(uid)} replace />;
  return LeadListRedirect;
};
