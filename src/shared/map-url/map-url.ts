import { defaultTreeAdapter, parseFragment } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

import {
  EXTERNAL_MAP_ALLOWED_HOSTS,
  MAP_EMBED_ALLOWED_HOST,
  MAP_EMBED_ALLOWED_PATH,
  MAP_INPUT_MAX_RAW_LENGTH,
  MAP_URL_MAX_LENGTH,
  MapUrlError,
  MapUrlErrorCode,
} from './map-url.types';

type ParsedElement = DefaultTreeAdapterMap['element'];
type ParsedNode = DefaultTreeAdapterMap['node'];

const IFRAME_TAG_NAME = 'iframe';

const SECRET_PARAMETER_PATTERN =
  /^(access[_-]?token|api[_-]?key|auth|authorization|client[_-]?secret|key|password|secret|signature|sig|token)$/i;

const EXTERNAL_MAP_HOSTS_REQUIRING_MAPS_PATH = new Set([
  'goo.gl',
  'maps.google.com',
  'www.google.com',
]);

const fail = (message: string): never => {
  throw new MapUrlError(MapUrlErrorCode.Invalid, message);
};

const hasMapsPath = (pathname: string): boolean =>
  pathname === '/maps' || pathname.startsWith('/maps/');

const isEmbedPath = (parsed: URL): boolean =>
  parsed.hostname === MAP_EMBED_ALLOWED_HOST &&
  (parsed.pathname === MAP_EMBED_ALLOWED_PATH ||
    parsed.pathname.startsWith(`${MAP_EMBED_ALLOWED_PATH}/`));

const collectElements = (node: ParsedNode, elements: ParsedElement[]): void => {
  if (defaultTreeAdapter.isCommentNode(node)) {
    return;
  }

  if (defaultTreeAdapter.isTextNode(node)) {
    if (node.value.trim().length > 0) {
      fail('Ô bản đồ chỉ nhận một liên kết hoặc đúng một thẻ iframe, không kèm văn bản khác.');
    }
    return;
  }

  if (!defaultTreeAdapter.isElementNode(node)) {
    fail('Nội dung dán vào ô bản đồ không hợp lệ.');
  }

  // parse5 type guards do not narrow DefaultTreeAdapterMap unions in this version.
  const element = node as ParsedElement;
  elements.push(element);

  for (const child of element.childNodes ?? []) {
    collectElements(child, elements);
  }
};

/** Extract `src` from exactly one safe iframe; never return raw HTML. */
const readIframeSource = (rawInput: string): string => {
  const fragment = parseFragment(rawInput);
  const elements: ParsedElement[] = [];

  for (const child of fragment.childNodes) {
    collectElements(child, elements);
  }

  if (elements.length === 0) {
    fail('Không tìm thấy thẻ iframe nào trong nội dung đã dán.');
  }

  if (elements.length > 1) {
    fail('Ô bản đồ chỉ nhận đúng một thẻ iframe, không kèm thẻ HTML nào khác.');
  }

  const element = elements[0];
  if (!element || element.tagName !== IFRAME_TAG_NAME) {
    fail(
      `Thẻ <${element?.tagName ?? 'unknown'}> không được phép. Ô bản đồ chỉ nhận thẻ iframe của Google Maps.`,
    );
  }

  for (const attribute of element.attrs) {
    const name = attribute.name.toLowerCase();
    if (name.startsWith('on')) {
      fail('Thẻ iframe chứa thuộc tính sự kiện không được phép.');
    }
    if (name === 'srcdoc') {
      fail('Thuộc tính srcdoc không được phép trong ô bản đồ.');
    }
  }

  const sourceAttr = element.attrs.find(
    (attribute) => attribute.name.toLowerCase() === 'src',
  );
  const source = sourceAttr?.value.trim() ?? '';
  if (!source) {
    fail('Thẻ iframe không có thuộc tính src.');
  }

  return source;
};

const parseHttpsMapUrl = (candidate: string): URL => {
  if (candidate.length > MAP_URL_MAX_LENGTH) {
    fail(`mapUrl vượt quá ${MAP_URL_MAX_LENGTH} ký tự.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return fail('mapUrl không phải là một URL hợp lệ.');
  }

  if (parsed.protocol !== 'https:') {
    fail('mapUrl phải dùng giao thức https.');
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    fail('mapUrl không được chứa thông tin đăng nhập.');
  }

  if (parsed.hash.length > 0) {
    fail('mapUrl không được chứa phần fragment (#).');
  }

  for (const parameterName of parsed.searchParams.keys()) {
    if (SECRET_PARAMETER_PATTERN.test(parameterName)) {
      fail(
        `mapUrl chứa tham số bí mật "${parameterName}". Hãy dùng liên kết không cần khóa API.`,
      );
    }
  }

  return parsed;
};

/**
 * Salanca single-field map URL: share link, embed URL, or one pasted iframe.
 * Persists only a normalized HTTPS URL (never HTML). Empty → null.
 */
export const normalizeOptionalMapUrl = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    return fail('mapUrl phải là chuỗi văn bản hoặc để trống.');
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > MAP_INPUT_MAX_RAW_LENGTH) {
    fail(
      `mapUrl vượt quá ${MAP_INPUT_MAX_RAW_LENGTH} ký tự. Hãy dán đúng một liên kết hoặc một thẻ iframe.`,
    );
  }

  const candidate = trimmed.includes('<') ? readIframeSource(trimmed) : trimmed;
  const parsed = parseHttpsMapUrl(candidate);

  if (isEmbedPath(parsed)) {
    return parsed.toString();
  }

  if (!EXTERNAL_MAP_ALLOWED_HOSTS.includes(parsed.hostname)) {
    fail(`mapUrl không chấp nhận địa chỉ ${parsed.hostname}.`);
  }

  if (
    EXTERNAL_MAP_HOSTS_REQUIRING_MAPS_PATH.has(parsed.hostname) &&
    !hasMapsPath(parsed.pathname)
  ) {
    fail('mapUrl phải trỏ tới đường dẫn /maps của Google.');
  }

  return parsed.toString();
};
