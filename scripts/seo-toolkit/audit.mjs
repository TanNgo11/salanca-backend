/**
 * `pnpm run seo:audit -- [--json] [--out=<file>] [--fail-on=error|warn|notice|never]
 *                        [--status=published|draft] [--lang=vi|en]`
 *
 * Loads a full Strapi app (no HTTP), runs the read-only audit through the plugin service and
 * prints either the report JSON or a compact table. `--out` writes the JSON report to a file
 * (stdout keeps Strapi's own log lines, so the file is the clean artifact for `jq`).
 * Exit codes: 0 clean, 1 issues at or above the fail-on level, 2 could not run (bad args, plugin
 * off, bad config, unreadable DB, unwritable --out path).
 */
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

import { loadStrapiApp } from '../lib/strapi-load.mjs';

const require = createRequire(import.meta.url);

const cli = require('../../src/plugins/seo-toolkit/dist/shared/cli.js');

const parseCliArgs = () => {
  // pnpm 11.7 forwards the `--` separator to the script, so `pnpm run seo:audit -- --json`
  // arrives as `['--', '--json']`; drop a leading separator so parseArgs sees the flags.
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  try {
    return parseArgs({
      args,
      options: {
        json: { type: 'boolean', default: false },
        out: { type: 'string' },
        'fail-on': { type: 'string', default: 'error' },
        // No default: omitting --status keeps the host's configured `status`.
        status: { type: 'string' },
        lang: { type: 'string', default: 'en' },
      },
      strict: true,
    }).values;
  } catch (error) {
    console.error(`seo:audit: ${error?.message ?? error}`);
    return null;
  }
};

const main = async () => {
  const values = parseCliArgs();
  if (!values) return 2;

  const { json, status, lang, out } = values;
  let failOn;
  try {
    failOn = cli.parseFailOn(values['fail-on']);
  } catch (error) {
    console.error(`seo:audit: ${error?.message ?? error}`);
    return 2;
  }
  if (status !== undefined && status !== 'published' && status !== 'draft') {
    console.error('seo:audit: --status must be published|draft');
    return 2;
  }
  if (lang !== 'vi' && lang !== 'en') {
    console.error('seo:audit: --lang must be vi|en');
    return 2;
  }

  let app;
  try {
    app = await loadStrapiApp();
  } catch (error) {
    console.error(`seo:audit: could not load Strapi: ${error?.message ?? error}`);
    return 2;
  }

  try {
    if (!app.plugin('seo-toolkit')) {
      console.error('seo:audit: plugin "seo-toolkit" is not loaded (set SEO_TOOLKIT_ENABLED=true).');
      return 2;
    }
    // Omit `status` when the flag was not given so the host config decides.
    const report = await app
      .plugin('seo-toolkit')
      .service('audit')
      .run(status === undefined ? {} : { status });
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    // `--out` writes the report to a file because Strapi logs its startup and shutdown lines to
    // stdout, which makes stdout unsafe to pipe. Alone, `--out` prints one summary line and leaves
    // the rest of stdout log-only.
    if (out) await fs.writeFile(out, serialized, 'utf8');
    if (json) process.stdout.write(serialized);
    else if (out) process.stdout.write(`${cli.formatOutSummary(report, out)}\n`);
    else process.stdout.write(`${cli.formatTable(report, lang)}\n`);
    return cli.exitCodeFor(report, failOn);
  } catch (error) {
    console.error(`seo:audit: ${error?.message ?? error}`);
    return 2;
  } finally {
    await app.destroy().catch((destroyError) => {
      console.warn('seo:audit: shutdown warning:', destroyError?.message ?? destroyError);
    });
  }
};

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`seo:audit: ${error?.message ?? error}`);
    process.exit(2);
  });
