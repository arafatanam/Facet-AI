import { createClient } from '@supabase/supabase-js';
export const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
function isLoopbackHost(host) {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}
export async function getUser(req) {
  const t = (req.headers.get('authorization') || '').replace(/^Bearer\s*/i, '').trim();
  if (!t && process.env.NODE_ENV === 'development' && process.env.TEST_MODE === 'true' && process.env.NEXT_PUBLIC_TEST_MODE === 'true') {
    const hosts = [req.headers.get('host'), req.headers.get('x-forwarded-host')].filter(Boolean);
    if (hosts.length && hosts.every(isLoopbackHost)) {
      return { id: '00000000-0000-4000-8000-000000000001', email: 'test-user@local.test', isTestUser: true };
    }
  }
  if (!t) return null;
  const { data } = await admin().auth.getUser(t);
  return data?.user || null;
}
export async function isPaid(email) {
  const { data } = await admin().from('subscriptions').select('status,current_period_end').eq('user_email', email).maybeSingle();
  return !!data && ['active', 'trialing'].includes(data.status) && new Date(data.current_period_end) > new Date();
}
