import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who, error: e1 } = await svc.auth.getUser(jwt);
    if (e1 || !who?.user) return json({ error: 'Chưa đăng nhập.' }, 401);
    const { data: me } = await svc.from('profiles').select('id, role, is_banned').eq('id', who.user.id).maybeSingle();
    if (!me || me.role !== 'admin' || me.is_banned) return json({ error: 'Chỉ quản trị viên mới được đổi tài khoản.' }, 403);
    const body = await req.json().catch(() => ({}));
    const target = String(body.user_id || '');
    if (!UUID.test(target)) return json({ error: 'Tài khoản không hợp lệ.' }, 400);
    const { data: tu, error: e2 } = await svc.auth.admin.getUserById(target);
    if (e2 || !tu?.user?.email) return json({ error: 'Không tìm thấy tài khoản.' }, 404);
    const { data: link, error: e3 } = await svc.auth.admin.generateLink({ type: 'magiclink', email: tu.user.email });
    if (e3 || !link?.properties?.hashed_token) return json({ error: 'Không tạo được phiên đăng nhập.' }, 500);
    await svc.from('audit_logs').insert({ actor_id: me.id, action: 'admin_switch_account', target_table: 'profiles', target_id: target, details: { from: me.id, to: target } });
    return json({ token_hash: link.properties.hashed_token });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
