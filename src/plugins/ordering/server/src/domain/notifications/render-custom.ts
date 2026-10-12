import { OrderingError } from '../errors';
import type { OpsAlertData, TemplateCode, TemplateData } from './templates';
import { buildVars, markdownVars, variablesFor } from './template-vars';

/**
 * Restricted-markdown renderer for staff-edited email templates (O10, contracts §14).
 * - `{{var}}` substitutes against the template's allowlisted variables; anything else in double
 *   braces is a TEMPLATE_VARIABLE_UNKNOWN error, never silent output.
 * - A line holding only an empty variable disappears, so optional rows collapse cleanly.
 * - HTML is escaped everywhere; the only formatting is paragraphs, `**bold**`, `- ` lists and
 *   `[label](https://…)` links — no raw HTML, no images, no `javascript:` URLs.
 */

export type RenderedMail = { subject: string; text: string; html: string };

const VAR_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;
const NAME_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;
const NUL = '\u0000';

/** Every `{{name}}` referenced by the source pair, first occurrence order. */
export const templateVarNames = (subject: string, body: string): string[] => {
  const found = new Set<string>();
  for (const match of `${subject}\n${body}`.matchAll(VAR_RE)) {
    found.add(match[1].trim());
  }
  return [...found];
};

/** Unknown or malformed `{{…}}` names → `TEMPLATE_VARIABLE_UNKNOWN` (400, `details.variables`). */
export const validateTemplateVars = (code: TemplateCode, subject: string, body: string): void => {
  const allowed = new Set(variablesFor(code).map((variable) => variable.name));
  const unknown = templateVarNames(subject, body).filter(
    (name) => !NAME_RE.test(name) || !allowed.has(name),
  );
  if (unknown.length > 0) {
    throw new OrderingError(
      'TEMPLATE_VARIABLE_UNKNOWN',
      `unknown template variables: ${unknown.join(', ')}`,
      { details: { variables: unknown } },
    );
  }
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/**
 * Inline markdown: `\x` escapes first (each escaped char hides behind a `\u0000<index>\u0000`
 * sentinel that survives the HTML escape and the markdown passes, then turns into the literal
 * char), then `**bold**` and https links. A non-https `](…)` keeps its label — the URL is dropped.
 */
const inlineHtml = (line: string): string => {
  const literals: string[] = [];
  const marked = line.replace(/\\(.)/gs, (_all, char: string) => {
    literals.push(char);
    return `${NUL}${literals.length - 1}${NUL}`;
  });
  let html = escapeHtml(marked);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" rel="noopener noreferrer">$1</a>',
  );
  html = html.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // eslint-disable-next-line no-control-regex -- the sentinels only ever come from this function.
  return html.replace(/\u0000(\d+)\u0000/g, (_all, index: string) => escapeHtml(literals[Number(index)]));
};

/**
 * Plain-text inline: markdown transforms run on the STILL-escaped text (`\*\*` can't satisfy
 * `**…**` — the backslash sits between the stars), then `\x` escapes unwrap to literal chars.
 */
const inlineText = (line: string): string =>
  line
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1: $2')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\\(.)/gs, '$1');

/** Blocks: blank-line separated; a block of only `- ` lines is a `<ul>`, else `<p>` + `<br>`. */
export const markdownToHtml = (source: string): string => {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of source.split('\n')) {
    if (line.trim() === '') {
      if (current.length > 0) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks
    .map((block) =>
      block.every((line) => line.trimStart().startsWith('- '))
        ? `<ul>${block
            .map((line) => `<li>${inlineHtml(line.trimStart().slice(2))}</li>`)
            .join('')}</ul>`
        : `<p>${block.map(inlineHtml).join('<br>')}</p>`,
    )
    .join('\n');
};

export const markdownToText = (source: string): string =>
  source
    .split('\n')
    .map(inlineText)
    .join('\n')
    .trim();

/**
 * Render a saved `{subject, body}` override. Unknown vars throw `TEMPLATE_VARIABLE_UNKNOWN`;
 * any other throw is the caller's problem (`notification-template` service falls back + alerts).
 */
export function renderCustom(
  code: TemplateCode,
  locale: string | null | undefined,
  source: { subject: string; body: string },
  data: TemplateData | OpsAlertData,
): RenderedMail {
  validateTemplateVars(code, source.subject, source.body);
  const raw = buildVars(code, locale, data);
  const md = markdownVars(raw, code);
  const substitute = (value: string, vars: Record<string, string>) =>
    value.replace(VAR_RE, (_all, name: string) => vars[name.trim()] ?? '');

  const subject = substitute(source.subject, raw);
  const lines = source.body.split('\n').flatMap((line) => {
    const only = /^\s*\{\{\s*([^{}]*?)\s*\}\}\s*$/.exec(line);
    if (only && (raw[only[1].trim()] ?? '') === '') return [];
    return [substitute(line, md)];
  });
  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { subject, text: markdownToText(body), html: markdownToHtml(body) };
}
