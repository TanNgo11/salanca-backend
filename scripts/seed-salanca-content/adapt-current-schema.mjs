/**
 * Maps the exported `salanca-content.json` (flat homepage + chrome on
 * global-setting) onto the current Strapi model: eight home.* sections,
 * bookingStrip, and split header/footer settings.
 */

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function omitUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(omitUndefined);
  }
  if (!isRecord(value)) return value;
  const next = {};
  for (const [key, nested] of Object.entries(value)) {
    if (nested === undefined || nested === null) continue;
    next[key] = omitUndefined(nested);
  }
  return next;
}

function usableLink(value) {
  return isRecord(value) && typeof value.label === 'string' && typeof value.url === 'string'
    ? value
    : undefined;
}

export function adaptHomePageForCurrentSchema(data) {
  if (!isRecord(data)) return data;
  if (
    isRecord(data.buffet) ||
    isRecord(data.process) ||
    (isRecord(data.bookingStrip) && isRecord(data.experience))
  ) {
    return omitUndefined(data);
  }

  const rawHero = isRecord(data.hero) ? data.hero : {};

  return omitUndefined({
    hero: {
      title: rawHero.title,
      description: rawHero.description,
      backgroundImage: rawHero.backgroundImage,
      primaryLink: usableLink(rawHero.primaryLink),
      secondaryLink: usableLink(rawHero.secondaryLink),
      scrollHint: rawHero.scrollHint,
    },
    experience: {
      title: data.experienceHeading,
      body: data.experienceBody,
      image: data.experienceImage,
      link: usableLink(data.experienceLink),
    },
    featuredPackage: data.featuredPackage,
    menuHighlights: {
      title: data.featuredMenuHeading,
    },
    featuredMenuItems: data.featuredMenuItems,
    story: {
      title: data.storyHeading,
      body: data.storyBody,
      link: usableLink(data.storyLink),
    },
    space: {
      title: data.spaceHeading,
      images: data.spaceImage ? [data.spaceImage] : undefined,
      link: usableLink(data.spaceLink),
    },
    bookingStrip: data.closingCta,
    seo: data.seo,
  });
}

export function adaptGlobalSettingForCurrentSchema(data) {
  if (!isRecord(data)) return data;
  const {
    headerLinks: _headerLinks,
    footerExploreLinks: _footerExploreLinks,
    footerInfoLinks: _footerInfoLinks,
    ...rest
  } = data;
  return rest;
}

export function headerSettingFromGlobal(data) {
  if (!isRecord(data)) return data;
  return {
    brandName: data.brandName,
    tagline: data.tagline,
    logo: data.logo,
    headerLinks: data.headerLinks,
  };
}

export function footerSettingFromGlobal(data) {
  if (!isRecord(data)) return data;
  return {
    brandName: data.brandName,
    tagline: data.tagline,
    logo: data.logo,
    hotline: data.hotline,
    email: data.email,
    address: data.address,
    mapUrl: data.mapUrl,
    openingHours: data.openingHours,
    socialLinks: data.socialLinks,
    footerExploreLinks: data.footerExploreLinks,
    footerInfoLinks: data.footerInfoLinks,
  };
}
