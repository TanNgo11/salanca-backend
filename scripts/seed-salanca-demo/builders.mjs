/**
 * Shared content builders for Salanca demo seed (VI/EN CMS payloads).
 */

export function seo(metaTitle, metaDescription, canonicalPath) {
  return {
    metaTitle: metaTitle.slice(0, 60),
    metaDescription: metaDescription.slice(0, 160),
    canonicalPath,
    noIndex: false,
  };
}

export function link(label, url) {
  return { label, url, openInNewTab: false };
}

export function image(mediaId, alt, caption = null) {
  return { media: mediaId, alt, caption };
}

export function hero(mediaId, title, description, ctaLabel, ctaUrl) {
  return {
    title,
    description,
    backgroundImage: image(mediaId, `${title} — ảnh nền`),
    primaryLink: link(ctaLabel, ctaUrl),
  };
}

export function cta(heading, body, label, url) {
  return {
    heading,
    body,
    link: link(label, url),
  };
}

export function paragraph(text) {
  return [
    {
      type: 'paragraph',
      children: [{ type: 'text', text }],
    },
  ];
}
