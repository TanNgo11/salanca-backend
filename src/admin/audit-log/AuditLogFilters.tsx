import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  DatePicker,
  Field,
  Flex,
  IconButton,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Cross, Filter, Search } from '@strapi/icons';

import {
  auditLogCalendarValueToDate,
  auditLogDateToCalendarValue,
  countActiveAuditLogFilters,
} from './audit-log.helper';
import type { AuditLogDraftFilters } from './audit-log.types';

export interface AuditLogFiltersProps {
  actionOptions: ReadonlyArray<{ label: string; value: string }>;
  disabled: boolean;
  draft: AuditLogDraftFilters;
  labels: {
    action: string;
    category: string;
    from: string;
    result: string;
    search: string;
    searchPlaceholder: string;
    source: string;
    to: string;
  };
  onApply: () => void;
  onChange: (patch: Partial<AuditLogDraftFilters>) => void;
  onQuickCategory: (category: string) => void;
  quickLabels: ReadonlyArray<{ code: string; label: string }>;
  sourceOptions: ReadonlyArray<{ label: string; value: string }>;
}

const MOBILE_PANEL_LABELS = {
  close: 'Đóng bộ lọc',
  open: 'Bộ lọc',
  title: 'Bộ lọc nhật ký',
} as const;

const AuditLogFilters = ({
  actionOptions,
  disabled,
  draft,
  labels,
  onApply,
  onChange,
  onQuickCategory,
  quickLabels,
  sourceOptions,
}: AuditLogFiltersProps) => {
  const [isPanelOpen, setPanelOpen] = useState(false);
  const activeCount = countActiveAuditLogFilters(draft);

  useEffect(() => {
    if (!isPanelOpen) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPanelOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPanelOpen]);

  const applyAndClose = () => {
    setPanelOpen(false);
    onApply();
  };

  return (
    <Box
      background="neutral0"
      className={`audit-log__filter-panel${
        isPanelOpen ? ' audit-log__filter-panel--open' : ''
      }`}
      hasRadius
      padding={4}
      shadow="filterShadow"
    >
      <div className="audit-log__filter-trigger">
        <Button
          disabled={disabled}
          fullWidth
          onClick={() => setPanelOpen(true)}
          startIcon={<Filter />}
          variant="tertiary"
        >
          {activeCount > 0
            ? `${MOBILE_PANEL_LABELS.open} (${activeCount})`
            : MOBILE_PANEL_LABELS.open}
        </Button>
      </div>

      {isPanelOpen ? (
        <button
          aria-label={MOBILE_PANEL_LABELS.close}
          className="audit-log__filter-backdrop"
          onClick={() => setPanelOpen(false)}
          type="button"
        />
      ) : null}

      <div className="audit-log__filter-body">
        <Flex
          alignItems="center"
          className="audit-log__filter-sheet-header"
          justifyContent="space-between"
        >
          <Typography fontWeight="bold" variant="delta">
            {MOBILE_PANEL_LABELS.title}
          </Typography>
          <IconButton
            label={MOBILE_PANEL_LABELS.close}
            onClick={() => setPanelOpen(false)}
            size="S"
            variant="tertiary"
          >
            <Cross />
          </IconButton>
        </Flex>

        <div className="audit-log__filters">
          <Field.Root className="audit-log__filter audit-log__filter--search" name="audit-log-search">
            <Field.Label>{labels.search}</Field.Label>
            <TextInput
              disabled={disabled}
              name="audit-log-search"
              placeholder={labels.searchPlaceholder}
              value={draft.search}
              onChange={(event: Readonly<{ target: { value: string } }>) =>
                onChange({ search: event.target.value })
              }
              onKeyDown={(event: Readonly<{ key: string }>) => {
                if (event.key === 'Enter') {
                  applyAndClose();
                }
              }}
            />
          </Field.Root>

          <Field.Root className="audit-log__filter audit-log__filter--category" name="audit-log-category">
            <Field.Label>{labels.category}</Field.Label>
            <SingleSelect
              disabled={disabled}
              onChange={(value: string | number) =>
                onChange({ action: '', category: String(value) })
              }
              value={draft.category}
            >
              <SingleSelectOption value="">Tất cả nhóm</SingleSelectOption>
              <SingleSelectOption value="content">Nội dung</SingleSelectOption>
              <SingleSelectOption value="account">Tài khoản</SingleSelectOption>
              <SingleSelectOption value="security">Bảo mật</SingleSelectOption>
            </SingleSelect>
          </Field.Root>

          <Field.Root className="audit-log__filter audit-log__filter--action" name="audit-log-action">
            <Field.Label>{labels.action}</Field.Label>
            <SingleSelect
              disabled={disabled}
              onChange={(value: string | number) => onChange({ action: String(value) })}
              value={draft.action}
            >
              <SingleSelectOption value="">Tất cả hành động</SingleSelectOption>
              {actionOptions.map((option) => (
                <SingleSelectOption key={option.value} value={option.value}>
                  {option.label}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>

          <Field.Root className="audit-log__filter audit-log__filter--source" name="audit-log-source">
            <Field.Label>{labels.source}</Field.Label>
            <SingleSelect
              disabled={disabled}
              onChange={(value: string | number) => onChange({ source: String(value) })}
              value={draft.source}
            >
              <SingleSelectOption value="">Tất cả nguồn</SingleSelectOption>
              {sourceOptions.map((option) => (
                <SingleSelectOption key={option.value} value={option.value}>
                  {option.label}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>

          <Field.Root className="audit-log__filter audit-log__filter--result" name="audit-log-result">
            <Field.Label>{labels.result}</Field.Label>
            <SingleSelect
              disabled={disabled}
              onChange={(value: string | number) => onChange({ success: String(value) })}
              value={draft.success}
            >
              <SingleSelectOption value="">Tất cả kết quả</SingleSelectOption>
              <SingleSelectOption value="true">Thành công</SingleSelectOption>
              <SingleSelectOption value="false">Thất bại</SingleSelectOption>
            </SingleSelect>
          </Field.Root>

          <Field.Root className="audit-log__filter audit-log__filter--date audit-log__filter--from" name="audit-log-from">
            <Field.Label>{labels.from}</Field.Label>
            <DatePicker
              calendarLabel={labels.from}
              disabled={disabled}
              locale="vi-VN"
              onChange={(date) => {
                if (date) {
                  onChange({ from: auditLogDateToCalendarValue(date) });
                }
              }}
              value={auditLogCalendarValueToDate(draft.from)}
            />
          </Field.Root>

          <Field.Root className="audit-log__filter audit-log__filter--date audit-log__filter--to" name="audit-log-to">
            <Field.Label>{labels.to}</Field.Label>
            <DatePicker
              calendarLabel={labels.to}
              disabled={disabled}
              locale="vi-VN"
              onChange={(date) => {
                if (date) {
                  onChange({ to: auditLogDateToCalendarValue(date) });
                }
              }}
              value={auditLogCalendarValueToDate(draft.to)}
            />
          </Field.Root>

          <Flex alignItems="flex-end" className="audit-log__filter-action">
            <Button disabled={disabled} fullWidth onClick={applyAndClose} startIcon={<Search />}>
              {labels.search}
            </Button>
          </Flex>
        </div>

        <Flex className="audit-log__quick" gap={2} wrap="wrap">
          {quickLabels.map((item) => {
            const isActive = draft.category === item.code;
            return (
              <Button
                aria-pressed={isActive}
                className={`audit-log__quick-button audit-log__quick-button--${item.code}`}
                data-active={isActive ? 'true' : 'false'}
                disabled={disabled}
                key={item.code}
                onClick={() => onQuickCategory(item.code)}
                size="S"
                variant="tertiary"
              >
                {item.label}
              </Button>
            );
          })}
        </Flex>
      </div>
    </Box>
  );
};

export default AuditLogFilters;
