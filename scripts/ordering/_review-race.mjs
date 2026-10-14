import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withApp } from './_harness.mjs';

export const directRun = (url, test) => {
  if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url)) return withApp(test);
};
export const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
export const interceptQuery = (app, uid, method, handler) => {
  const original = app.db.query;
  app.db.query = function (...args) {
    const repo = original.apply(this, args);
    if (args[0] !== uid) return repo;
    const wrapper = Object.create(repo);
    wrapper[method] = (...params) => handler(repo[method].bind(repo), ...params);
    return wrapper;
  };
  return () => { app.db.query = original; };
};
