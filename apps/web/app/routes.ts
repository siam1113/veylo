import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [index('routes/home.tsx'), route('auth/callback', 'routes/auth-callback.tsx')] satisfies RouteConfig;
