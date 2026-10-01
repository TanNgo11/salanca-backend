import assert from 'node:assert/strict';
const base='http://localhost:1337/api/v1';
const get=async(path,locale,populate='')=>{const r=await fetch(`${base}/${path}?locale=${locale}&pagination[pageSize]=100${populate}`);assert.equal(r.status,200);return(await r.json()).data;};
for(const locale of ['vi','en']) {
 for(const path of ['campaigns','gallery-items']) assert.equal((await get(path,locale)).length,0);
 for(const path of ['global-setting','footer-setting']) assert.deepEqual((await get(path,locale,'&populate[openingHours]=true')).openingHours,[]);
 const menu=await get('menu-items',locale);assert.equal(Number(menu.find(v=>v.slug==='take-wings')?.price),750000);
 const steak=menu.find(v=>v.name==='Steak Salanca');assert.ok(steak);assert.ok(!/rib.?eye|thăn nội|tenderloin/i.test(JSON.stringify(steak)));
 const moqueca=menu.find(v=>v.slug==='seafood-moqueca');assert.equal(Number(moqueca.price),0);
 const story=await get('story-page',locale,'&populate[timelineEntries]=true');assert.deepEqual(story.timelineEntries.map(v=>v.label.slice(0,4)),['2003','2006','2016','2020','2026']);
 console.log(`${locale}: source-only menu decisions, revised DOCX milestones, no published demo offers/gallery/hours.`);
}
