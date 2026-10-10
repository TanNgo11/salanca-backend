export default {
  'content-api': {
    type: 'content-api',
    routes: [
      {
        method: 'GET',
        path: '/catalog/categories',
        handler: 'catalog.categories',
        config: { auth: false, policies: [], middlewares: [] },
      },
      {
        method: 'GET',
        path: '/catalog/products',
        handler: 'catalog.products',
        config: { auth: false, policies: [], middlewares: [] },
      },
      {
        method: 'GET',
        path: '/catalog/products/:slug',
        handler: 'catalog.product',
        config: { auth: false, policies: [], middlewares: [] },
      },
    ],
  },
  admin: {
    type: 'admin',
    routes: [],
  },
};
