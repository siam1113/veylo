import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('auth/callback', 'routes/auth-callback.tsx'),
  route('.well-known/appspecific/com.chrome.devtools.json', 'routes/chrome-devtools.tsx'),
] satisfies RouteConfig;
