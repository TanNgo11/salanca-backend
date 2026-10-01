import { mkdirSync, writeFileSync } from 'node:fs';
import { loadStrapiApp } from './lib/strapi-load.mjs';
if (!['localhost','127.0.0.1','::1'].includes(process.env.DATABASE_HOST) || process.env.DATABASE_URL) throw new Error('Loopback database required.');
const expected = {
 'api::campaign.campaign':['h4cscbkop2b7p5o49wipr3fg','thwkd9lr3ndm3fbnjtsc4bc6','u89h49x7xt74z5zijbsfcw0f','nxxlo4y160zzgnejm90td7dg','xks7wv7woxhtc3bmd19nep11','ztpmzaq8yaj2wzbx40iac1hp','fckn6skbnkq5cmz3jsskkjrj'],
 'api::gallery-item.gallery-item':['rq0amvaqiac6tqkvu0emnxi5','w2aklmp6trvcdungwe5fec74','roem7p7dtk1vosprhvv98cr1','etb7w5p81zsvtduye6eimqhp','y23itijgw1s9jvkc9xbznej4','hcb3c6fm6slfbat0a2wacifu'],
};
const app=await loadStrapiApp();
try {
 const snapshots=[];
 for (const [uid,ids] of Object.entries(expected)) for (const locale of ['vi','en']) {
  const rows=await app.documents(uid).findMany({locale,status:'published',populate:'*'});
  if(rows.some(row=>!ids.includes(row.documentId))) throw new Error(`Unexpected published ${uid} ${locale}; no changes made to this collection.`);
  snapshots.push({uid,locale,rows});
 }
 mkdirSync('.tmp/source-audit',{recursive:true});
 writeFileSync('.tmp/source-audit/unpublished-documents.json',JSON.stringify(snapshots,null,2));
 for (const {uid,locale,rows} of snapshots) {
  console.log(`${uid} ${locale}: ${rows.length} source-less demo records`);
  if(process.argv.includes('--apply')) for(const row of rows) await app.documents(uid).unpublish({documentId:row.documentId,locale});
 }
} finally { await app.destroy().catch(()=>{}); }
