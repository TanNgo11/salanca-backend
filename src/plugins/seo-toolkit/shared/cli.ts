import type { AuditReport } from './audit/types';
import { formatMessage, type MessageLang } from './messages';

export type FailOn = 'error' | 'warn' | 'notice' | 'never';

export function parseFailOn(value: string): FailOn {
  if (value === 'error' || value === 'warn' || value === 'notice' || value === 'never') {
    return value;
  }
  throw new Error(`--fail-on must be one of error|warn|notice|never, got "${value}"`);
}

export function exitCodeFor(report: AuditReport, failOn: FailOn): 0 | 1 {
  if (failOn === 'never') return 0;
  const { error, warn, notice } = report.summary;
  if (failOn === 'error') return error > 0 ? 1 : 0;
  if (failOn === 'warn') return error + warn > 0 ? 1 : 0;
  return error + warn + notice > 0 ? 1 : 0;
}

export function formatTable(report: AuditReport, lang: MessageLang): string {
  const lines = [
    `SEO audit (status=${report.scope.status}, locales=${report.scope.locales.join(',')}, entries=${report.summary.entries})`,
  ];

  if (report.issues.length === 0) {
    lines.push(lang === 'vi' ? 'Không có lỗi.' : 'No issues.');
  } else {
    for (const issue of report.issues) {
      const message = formatMessage(issue.code, issue.params, lang);
      const label = issue.label ? ` (${issue.label})` : '';
      lines.push(
        `[${issue.severity.toUpperCase()}] ${issue.uid}  ${issue.documentId}  ${issue.locale ?? '-'}  ${message}${label}  (${issue.code})`,
      );
    }
  }

  lines.push(`error: ${report.summary.error}  warn: ${report.summary.warn}  notice: ${report.summary.notice}`);
  return lines.join('\n');
}
