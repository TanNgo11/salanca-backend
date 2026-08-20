import { randomBytes } from 'node:crypto';
import { stdout } from 'node:process';

function hexSecret() {
  return randomBytes(32).toString('hex');
}

const appKeys = Array.from({ length: 4 }, () => hexSecret()).join(',');
const cmsWebhookSecret = hexSecret();
const cmsPreviewGateSecret = hexSecret();

const backendSecrets = [
  ['APP_KEYS', appKeys],
  ['API_TOKEN_SALT', hexSecret()],
  ['ADMIN_JWT_SECRET', hexSecret()],
  ['TRANSFER_TOKEN_SALT', hexSecret()],
  ['JWT_SECRET', hexSecret()],
  ['ENCRYPTION_KEY', hexSecret()],
  ['CMS_WEBHOOK_SECRET', cmsWebhookSecret],
];

stdout.write('# salanca-backend .env\n');
for (const [name, value] of backendSecrets) {
  stdout.write(`${name}=${value}\n`);
}

stdout.write('\n# salanca-web .env (same CMS_WEBHOOK_SECRET as backend)\n');
stdout.write(`CMS_WEBHOOK_SECRET=${cmsWebhookSecret}\n`);
stdout.write(`CMS_PREVIEW_GATE_SECRET=${cmsPreviewGateSecret}\n`);
