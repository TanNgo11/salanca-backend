import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const payload = JSON.parse(readFileSync('data/salanca-content.json', 'utf8'));
const api = 'http://localhost:1337/api/v1';
const documentsByLocale = new Map();
for (const locale of ['vi', 'en']) {
  for (const path of ['home-page', 'menu-page', 'story-page', 'space-page', 'experience-page', 'campaign-page', 'booking-page', 'contact-page']) {
    const response = await fetch(`${api}/${path}?locale=${locale}`);
    assert.equal(response.status, 200, `${path} (${locale}) HTTP`);
    const { data } = await response.json();
    assert.equal(data.locale, locale);
  }
  const response = await fetch(`${api}/menu-items?locale=${locale}&pagination[pageSize]=100&populate[category]=true`);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  const bySlug = new Map(data.map((row) => [row.slug, row]));
  documentsByLocale.set(locale, bySlug);
  const entries = payload.collections['api::menu-item.menu-item'].entries;
  for (const entry of entries) {
    const expected = entry[locale];
    const actual = bySlug.get(expected.slug);
    assert.ok(actual, `${expected.slug} (${locale}) published`);
    assert.equal(actual.name, expected.name);
    assert.equal(Number(actual.price), expected.price);
    assert.equal(actual.portion || '', expected.portion || '');
    assert.equal(actual.category.locale, locale);
  }
  const storyResponse = await fetch(`${api}/story-page?locale=${locale}&populate[timelineEntries]=true&populate[ingredients]=true&populate[values]=true`);
  const { data: story } = await storyResponse.json();
  const expectedStory = payload.pages['api::story-page.story-page'][locale];
  assert.deepEqual(story.timelineEntries.map(({ label, title, body }) => ({ label, title, body })), expectedStory.timelineEntries);
  assert.deepEqual(story.ingredients.map(({ title, body, detailBody }) => ({ title, body, detailBody })), expectedStory.ingredients.map(({ title, body, detailBody }) => ({ title, body, detailBody })));
  assert.deepEqual(story.values.map(({ title, body }) => ({ title, body })), expectedStory.values.map(({ title, body }) => ({ title, body })));
  assert.deepEqual(story.originBody, expectedStory.originBody);
  for (const path of ['menu-page', 'story-page']) {
    const mediaResponse = await fetch(`${api}/${path}?locale=${locale}&populate[hero][populate][backgroundImage][populate]=media`);
    assert.equal(mediaResponse.status, 200);
    const { data: page } = await mediaResponse.json();
    const image = page.hero.backgroundImage.media;
    assert.equal(image.width, 3840, `${path} (${locale}) original CMS image width`);
    assert.match(image.name, /^pdf-.*-4k\.webp$/);
    const imageResponse = await fetch(new URL(image.url, api));
    assert.equal(imageResponse.status, 200);
  }
  console.log(`${locale}: 8 published pages; ${entries.length} menu prices/names/portions; story timeline, details and values match payload.`);
}
for (const [slug, row] of documentsByLocale.get('vi')) {
  const peer = documentsByLocale.get('en').get(slug);
  if (peer) assert.equal(peer.documentId, row.documentId, `${slug} shares VI/EN identity`);
}
console.log('Owner content verification passed: VI/EN document identity preserved.');
