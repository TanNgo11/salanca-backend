export enum PublicContentRoleType {
  Public = 'public',
}

/**
 * Users-Permissions action strings granted to the Public role at bootstrap.
 * Format: `api::<api-name>.<api-name>.find` | `.findOne`
 */
export enum PublicContentPermissionAction {
  // Single types (find only)
  FindGlobalSetting = 'api::global-setting.global-setting.find',
  FindHomePage = 'api::home-page.home-page.find',
  FindMenuPage = 'api::menu-page.menu-page.find',
  FindCampaignPage = 'api::campaign-page.campaign-page.find',
  FindStoryPage = 'api::story-page.story-page.find',
  FindExperiencePage = 'api::experience-page.experience-page.find',
  FindSpacePage = 'api::space-page.space-page.find',
  FindContactPage = 'api::contact-page.contact-page.find',
  FindBookingPage = 'api::booking-page.booking-page.find',

  // Collections (find + findOne)
  FindLocation = 'api::location.location.find',
  FindOneLocation = 'api::location.location.findOne',
  FindMenuCategory = 'api::menu-category.menu-category.find',
  FindOneMenuCategory = 'api::menu-category.menu-category.findOne',
  FindMenuItem = 'api::menu-item.menu-item.find',
  FindOneMenuItem = 'api::menu-item.menu-item.findOne',
  FindMenuPackage = 'api::menu-package.menu-package.find',
  FindOneMenuPackage = 'api::menu-package.menu-package.findOne',
  FindCampaign = 'api::campaign.campaign.find',
  FindOneCampaign = 'api::campaign.campaign.findOne',
  FindGalleryItem = 'api::gallery-item.gallery-item.find',
  FindOneGalleryItem = 'api::gallery-item.gallery-item.findOne',
}

/** Permissions granted at bootstrap once the matching content type exists. */
export const getPublicContentPermissionActions =
  (): readonly PublicContentPermissionAction[] => [
    PublicContentPermissionAction.FindGlobalSetting,
    PublicContentPermissionAction.FindHomePage,
    PublicContentPermissionAction.FindMenuPage,
    PublicContentPermissionAction.FindCampaignPage,
    PublicContentPermissionAction.FindStoryPage,
    PublicContentPermissionAction.FindExperiencePage,
    PublicContentPermissionAction.FindSpacePage,
    PublicContentPermissionAction.FindContactPage,
    PublicContentPermissionAction.FindBookingPage,
    PublicContentPermissionAction.FindLocation,
    PublicContentPermissionAction.FindOneLocation,
    PublicContentPermissionAction.FindMenuCategory,
    PublicContentPermissionAction.FindOneMenuCategory,
    PublicContentPermissionAction.FindMenuItem,
    PublicContentPermissionAction.FindOneMenuItem,
    PublicContentPermissionAction.FindMenuPackage,
    PublicContentPermissionAction.FindOneMenuPackage,
    PublicContentPermissionAction.FindCampaign,
    PublicContentPermissionAction.FindOneCampaign,
    PublicContentPermissionAction.FindGalleryItem,
    PublicContentPermissionAction.FindOneGalleryItem,
  ];
