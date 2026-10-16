import bootstrap from './bootstrap';
import config from './config';
import controllers from './controllers';
import register from './register';
import routes from './routes';
import services from './services';

export default {
  register,
  bootstrap,
  destroy: () => {},
  config,
  contentTypes: {},
  routes,
  controllers,
  services,
  policies: {},
  middlewares: {},
};
