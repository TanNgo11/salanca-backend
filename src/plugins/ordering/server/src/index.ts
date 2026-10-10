import bootstrap from './bootstrap';
import config from './config';
import destroy from './destroy';
import register from './register';
import services from './services';
import contentTypes from './content-types';
import routes from './routes';
import controllers from './controllers';

export default {
  register,
  bootstrap,
  destroy,
  config,
  contentTypes,
  routes,
  controllers,
  services,
  policies: {},
  middlewares: {},
};
