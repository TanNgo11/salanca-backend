export enum CmsWebhookContentUid {
  BookingPage = 'api::booking-page.booking-page',
  Campaign = 'api::campaign.campaign',
  CampaignPage = 'api::campaign-page.campaign-page',
  ContactPage = 'api::contact-page.contact-page',
  ExperiencePage = 'api::experience-page.experience-page',
  GalleryItem = 'api::gallery-item.gallery-item',
  GlobalSetting = 'api::global-setting.global-setting',
  HomePage = 'api::home-page.home-page',
  Location = 'api::location.location',
  MenuCategory = 'api::menu-category.menu-category',
  MenuItem = 'api::menu-item.menu-item',
  MenuPackage = 'api::menu-package.menu-package',
  MenuPage = 'api::menu-page.menu-page',
  SpacePage = 'api::space-page.space-page',
  StoryPage = 'api::story-page.story-page',
}

export enum CmsWebhookEvent {
  Publish = 'entry.publish',
  Unpublish = 'entry.unpublish',
}

export type CmsWebhookPayload = Readonly<{
  documentId: string;
  event: CmsWebhookEvent;
  locale: string;
  uid: CmsWebhookContentUid;
}>;

export const CMS_WEBHOOK_ALLOWED_UIDS = new Set<string>(Object.values(CmsWebhookContentUid));

export const CMS_WEBHOOK_ALLOWED_LOCALES = new Set(['vi', 'en']);

export const CMS_WEBHOOK_MAX_BODY_BYTES = 4_096;
