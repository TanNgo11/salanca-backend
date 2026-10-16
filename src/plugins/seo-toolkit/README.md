# strapi-plugin-seo-toolkit

Generic, read-only SEO audit for Strapi 5. It reads the SEO data already in the CMS and reports,
per entry and per locale, what is missing or suspicious before go-live. Salanca is the first
client; the plugin holds no Salanca-specific code (no content-type UIDs, no imports from the app).

v0.1 has **no admin screen, stores nothing and writes nothing**. It exposes a CLI command, an
admin API route and one service.

## Enable

The plugin is **off by default** and only loads when both are true:

1. `SEO_TOOLKIT_ENABLED=true` in the environment.
2. The server build exists — run `pnpm run build:seo-toolkit` (already part of `build`, `dev` and
   `develop`). Enabling without the build throws at boot instead of being silently skipped.

```powershell
$env:SEO_TOOLKIT_ENABLED='true'
pnpm run seo:audit -- --lang=vi
```

## Command

```
pnpm run seo:audit -- [--json] [--out=<file>] [--fail-on=error|warn|notice|never] [--status=published|draft] [--lang=vi|en]
```

- `--json` prints the report JSON; otherwise a compact translated table.
- `--out=<file>` writes the report as JSON to a file. Strapi logs its startup and shutdown lines
  to stdout, so stdout cannot be piped cleanly; the file is the clean artifact (for `jq` or
  diffing between runs). On its own it leaves stdout log-only.
- `--fail-on` (default `error`) is the threshold for exit code 1.
- `--status` selects the `published` or `draft` version. When omitted the host's configured
  `status` is used — the CLI never overrides it. Draft matters because Strapi only enforces
  `required` on publish, so missing titles actually occur in drafts.
- `--lang` (default `en`) is only the language of the printed table.

A leading `--` is dropped before parsing, so the documented `pnpm run seo:audit -- ...` form works
even on pnpm versions that forward the separator to the script.

Exit codes: `0` clean, `1` issues at or above `--fail-on`, `2` could not run (bad arguments,
plugin off, invalid config, database unreadable).

## Admin API

`POST /seo-toolkit/audit/run` (admin only). The body is optional:
`{ "status"?: "published"|"draft", "contentTypes"?: string[], "locales"?: string[] }`.
Requires the `plugin::seo-toolkit.audit.run` permission. POST because a full audit is expensive
and must not be cached. Read-only.

The service is also callable directly:
`strapi.plugin('seo-toolkit').service('audit').run({ status?, contentTypes?, locales? })`.

## Configuration

Under the `seo-toolkit` key of `config/plugins.ts`:

| Key | Default | Meaning |
| --- | --- | --- |
| `contentTypes` | `{}` | Map of content-type UID to `{ seoField?, labelField? }`. `seoField` is the SEO component attribute (default `seo`), or an array of attribute names when a type has several SEO blocks; `labelField` is a string attribute used as the report label. |
| `fields` | see below | Names inside the SEO component. |
| `status` | `published` | Audit the `published` or `draft` version. |
| `limits` | `{ title: 60, description: 160 }` | Character thresholds (a product choice, not a Google rule). |
| `severities` | `{}` | Per-code override: `error` \| `warn` \| `notice` \| `off`. |

`fields` defaults (they match the `shared.seo` component):

```ts
fields: { title: 'metaTitle', description: 'metaDescription', image: 'shareImage', noIndex: 'noIndex' }
```

`fields.image` and `fields.noIndex` accept `null` for a site that has no such field; the
`media.*` and `seo.noindex-set` rules are then skipped. `fields.title` and `fields.description`
are required.

A content type may have more than one SEO block: `seoField: ['seo', 'cateringSeo']` audits each
block as its own entry, one per (document, locale). Every issue carries the `seoField` that
produced it (null for document-level issues), so two blocks of one document stay distinguishable;
a report row is identified by `uid + documentId + locale + seoField`. The `others` list of a
duplicate issue carries `seoField` too, so a duplicate between two blocks of the same document is
not confused with a self-reference.

An invalid config never stops the CMS: the schema check runs at bootstrap, logs each problem and
marks the config unusable, so `run` answers 400 (CLI exit 2).

## Rules and default severity

| Code | Default | Condition |
| --- | --- | --- |
| `seo.block-missing` | error | No SEO block data (null). |
| `seo.title-missing` | error | SEO block present but title empty after trim. |
| `seo.description-missing` | error | Same for description. |
| `seo.title-too-long` | warn | Title longer than `limits.title` (counted in code points). |
| `seo.description-too-long` | warn | Same for description. |
| `seo.title-duplicate` | warn | Same title across more than one entry in the same locale (case/whitespace-insensitive, across all configured content types). noIndex entries are ignored. |
| `seo.description-duplicate` | warn | Same for description. |
| `i18n.translation-missing` | warn | An i18n document present in one locale but missing another configured locale (reported on the missing locale). |
| `media.share-image-missing` | notice | SEO block present but no share image. |
| `media.share-image-alt-missing` | notice | Share image present but `alternativeText` empty. |
| `seo.noindex-set` | warn | The entry is set to noIndex. |

v0.1 does not check canonical URLs, sitemaps, robots or rendered pages (v0.3): those are decided
by the frontend, not by CMS data.

## Boundaries

- Read-only. No writes, no content types, no migrations, no tables, no cron, no middleware.
- The plugin never imports application code and hardcodes no UIDs; every UID lives in
  `config/plugins.ts`.
- The engine is a pure function (no Strapi, no clock, no environment); all Strapi access sits in
  the collector and service.

## Adding another website

1. Declare the content types that carry an SEO component in `config/plugins.ts` under
   `seo-toolkit.contentTypes` (map by UID), setting `seoField`/`labelField` where they differ
   from the defaults.
2. Set `SEO_TOOLKIT_ENABLED=true` and run `pnpm run build:seo-toolkit` (or `pnpm run build`).
3. Run `pnpm run seo:audit`. Adjust `fields`, `limits` and `severities` to the site.
