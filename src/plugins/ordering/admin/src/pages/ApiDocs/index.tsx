import { Box, Button, Flex, Typography } from '@strapi/design-system';
import { Duplicate } from '@strapi/icons';
import { Layouts, Page, useNotification } from '@strapi/strapi/admin';

import { useT } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';

const OPENAPI_PATH = '/api/v1/ordering/openapi.json';

const NODE_SAMPLE = `import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret, header, rawBody) {
  const t = /^t=(\\d+)/.exec(header)?.[1];
  const sigs = [...header.matchAll(/v1=([0-9a-f]{64})/g)].map((m) => m[1]);
  if (!t || sigs.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`, 'utf8').digest('hex');
  return sigs.some((sig) => timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}`;

const PHP_SAMPLE = `function verifyOrdering(string $secret, string $header, string $rawBody): bool {
  if (!preg_match('/t=(\\d+)/', $header, $tm)) return false;
  preg_match_all('/v1=([0-9a-f]{64})/', $header, $sm);
  if (abs(time() - (int)$tm[1]) > 300) return false;
  $expected = hash_hmac('sha256', $tm[1] . '.' . $rawBody, $secret);
  foreach ($sm[1] as $sig) if (hash_equals($expected, $sig)) return true;
  return false;
}`;

const CodeBox = ({ children }: { children: string }) => (
  <Box tag="pre" padding={4} background="neutral100" hasRadius style={{ overflowX: 'auto', whiteSpace: 'pre', fontSize: '1.2rem', lineHeight: 1.5 }}>
    {children}
  </Box>
);

/**
 * X2 — static API-documentation screen: the public OpenAPI URL, how to open it in Swagger
 * Editor/Postman, and the sample code receivers use to verify webhook signatures. No Swagger UI
 * embed (no extra dependency).
 */
const ApiDocsPage = () => {
  const t = useT();
  const { toggleNotification } = useNotification();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const specUrl = `${origin}${OPENAPI_PATH}`;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toggleNotification({ type: 'success', message: t('x2.copied') });
    } catch {
      toggleNotification({ type: 'danger', message: t('x2.copyFailed') });
    }
  };

  return (
    <Page.Protect permissions={PERMISSIONS.settings}>
      <Layouts.Header title={t('x2.title')} subtitle={t('x2.subtitle')} />
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={6} paddingBottom={10}>
          <Box background="neutral0" padding={6} hasRadius shadow="filterShadow">
            <Typography variant="delta" tag="h2">{t('x2.openapi.title')}</Typography>
            <Box paddingTop={2} paddingBottom={3}>
              <Typography variant="pi" textColor="neutral600">{t('x2.openapi.hint')}</Typography>
            </Box>
            <Flex gap={3} alignItems="center">
              <CodeBox>{`GET ${specUrl}`}</CodeBox>
              <Button variant="secondary" startIcon={<Duplicate />} onClick={() => void copy(specUrl)}>
                {t('x2.copy')}
              </Button>
            </Flex>
            <Box paddingTop={3}>
              <Typography variant="pi" textColor="neutral600">{t('x2.openapi.tools')}</Typography>
            </Box>
          </Box>

          <Box background="neutral0" padding={6} hasRadius shadow="filterShadow">
            <Typography variant="delta" tag="h2">{t('x2.webhook.title')}</Typography>
            <Box paddingTop={2} paddingBottom={3}>
              <Typography variant="pi" textColor="neutral600">{t('x2.webhook.hint')}</Typography>
            </Box>
            <Typography variant="sigma">{t('x2.webhook.headers')}</Typography>
            <CodeBox>{`X-Ordering-Event: order.created\nX-Ordering-Delivery: <deliveryId>\nX-Ordering-Signature: t=<unix_seconds>,v1=<hex64>`}</CodeBox>
            <Box paddingTop={4} paddingBottom={2}>
              <Typography variant="sigma">Node.js</Typography>
            </Box>
            <CodeBox>{NODE_SAMPLE}</CodeBox>
            <Box paddingTop={4} paddingBottom={2}>
              <Typography variant="sigma">PHP</Typography>
            </Box>
            <CodeBox>{PHP_SAMPLE}</CodeBox>
          </Box>

          <Box background="neutral0" padding={6} hasRadius shadow="filterShadow">
            <Typography variant="delta" tag="h2">{t('x2.more.title')}</Typography>
            <Box paddingTop={2}>
              <Typography variant="pi" textColor="neutral600">
                {t('x2.more.hint')} <code>docs/ordering-integrations.md</code>
              </Typography>
            </Box>
          </Box>
        </Flex>
      </Layouts.Content>
    </Page.Protect>
  );
};

export default ApiDocsPage;
