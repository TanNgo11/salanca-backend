const CONTENT_MANAGER_READ_ACTION = 'plugin::content-manager.explorer.read';

export const contactMessageUid = 'api::contact-message.contact-message';
export const reservationRequestUid = 'api::reservation-request.reservation-request';

export const leadListPath = (uid: string): string =>
  `/content-manager/collection-types/${uid}`;

export const leadReadPermissions = (uid: string) => [
  { action: CONTENT_MANAGER_READ_ACTION, subject: uid },
];

export const LEAD_COLLECTION_LINKS_HOOK = 'Admin/CM/pages/App/mutate-collection-types-links';

interface CollectionTypeLink {
  uid?: string;
  name?: string;
}

interface CollectionTypeLinksState<TLink extends CollectionTypeLink> {
  ctLinks: readonly TLink[];
  models: readonly unknown[];
}

const leadUids = new Set([contactMessageUid, reservationRequestUid]);

/**
 * The leads have their own sidebar entries, so their duplicate rows in the
 * Content Manager's collection list are hidden. Their list and edit views
 * stay reachable; only the sidebar row goes.
 */
export const hideLeadCollectionLinks = <TLink extends CollectionTypeLink>(
  state: CollectionTypeLinksState<TLink>,
): CollectionTypeLinksState<TLink> => ({
  ...state,
  ctLinks: state.ctLinks.filter(
    (link) => !leadUids.has(link.uid ?? '') && !leadUids.has(link.name ?? ''),
  ),
});
