import { useEffect, useState } from 'react';
import { Alert, Box, Flex, Grid, Loader, Typography } from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

import { formatMoney, localized } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';

type LoyaltyReportBody = {
  scope: 'all' | 'branch';
  enabled: boolean;
  pointValue: number;
  issued: number;
  redeemed: number;
  released: number;
  expired: number;
  reversed: number;
  circulation: { points: number; value: number } | null;
  tiers: Array<{ code: string; name: Record<string, string>; customers: number }>;
};

/** Y4: points card under the sales report. Reads the same range/branch the report applied. */
export const LoyaltyReport = ({ from, to, branch }: { from: string; to: string; branch: string | null }) => {
  const t = useT();
  const locale = useLocale();
  const { get } = useFetchClient();
  const [body, setBody] = useState<LoyaltyReportBody | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setBody(null);
    setFailed(false);
    const params = new URLSearchParams({ from, to, ...(branch ? { branch } : {}) });
    void get(`/ordering/reports/loyalty?${params.toString()}`)
      .then(({ data }) => {
        if (live) setBody(data as LoyaltyReportBody);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [branch, from, get, to]);

  if (failed) {
    return (
      <Alert closeLabel={t('common.close')} title={t('common.error.title')} variant="danger">
        {t('loyalty.report.loadFailed')}
      </Alert>
    );
  }
  if (!body) {
    return (
      <Flex justifyContent="center" padding={4}>
        <Loader small>{t('common.loading')}</Loader>
      </Flex>
    );
  }
  if (!body.enabled && body.issued === 0 && body.redeemed === 0 && !body.circulation?.points) return null;

  const cells: Array<[string, string, string?]> = [
    ['loyalty.report.issued', String(body.issued)],
    ['loyalty.report.redeemed', String(body.redeemed)],
    ['loyalty.report.released', String(body.released)],
    ['loyalty.report.expired', String(body.expired)],
    ['loyalty.report.reversed', String(body.reversed)],
  ];
  if (body.circulation) {
    cells.push([
      'loyalty.report.circulation',
      String(body.circulation.points),
      t('loyalty.report.liability', { amount: formatMoney(body.circulation.value) }),
    ]);
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      <Typography variant="delta">{t('loyalty.report.title')}</Typography>
      <Grid.Root gap={4}>
        {cells.map(([key, value, note]) => (
          <Grid.Item key={key} col={4} s={12}>
            <Box padding={4} background="neutral0" shadow="tableShadow" borderRadius="4px" width="100%">
              <Typography variant="sigma" textColor="neutral600">
                {t(key)}
              </Typography>
              <Typography variant="beta" tag="p">
                {value}
              </Typography>
              {note ? (
                <Typography variant="pi" textColor="neutral600">
                  {note}
                </Typography>
              ) : null}
            </Box>
          </Grid.Item>
        ))}
      </Grid.Root>
      {body.tiers.length > 0 ? (
        <Box>
          <Typography variant="sigma" textColor="neutral600">
            {t('loyalty.report.tiers')}
          </Typography>
          <Flex gap={4} paddingTop={1} wrap="wrap">
            {body.tiers.map((tier) => (
              <Typography key={tier.code}>
                {localized(tier.name, locale)}: <strong>{tier.customers}</strong>
              </Typography>
            ))}
          </Flex>
        </Box>
      ) : null}
      {body.scope === 'branch' ? (
        <Typography variant="pi" textColor="neutral500">
          {t('loyalty.report.branchOnly')}
        </Typography>
      ) : null}
    </Flex>
  );
};

export default LoyaltyReport;
