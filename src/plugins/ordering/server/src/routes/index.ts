export default {
  'content-api': {
    type: 'content-api',
    routes: [{
      method: 'POST',
      path: '/webhooks/spike',
      handler: 'spike.webhook',
      config: { auth: false, policies: [], middlewares: [] },
    }],
  },
};
