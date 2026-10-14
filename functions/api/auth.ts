import { type Env, mintToken, passcodeMatches } from '../../lib/auth';
import { err, json } from '../../lib/http';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GROUP_PASSCODE || !env.TOKEN_SECRET) {
    return err('server is missing GROUP_PASSCODE or TOKEN_SECRET', 500);
  }

  let passcode = '';
  try {
    const body = await request.json<{ passcode?: string }>();
    passcode = typeof body?.passcode === 'string' ? body.passcode.trim() : '';
  } catch {
    return err('expected a JSON body');
  }

  if (!passcode) return err('passcode is required');
  if (!passcodeMatches(passcode, env)) return err('that passcode is not right', 401);

  return json({ token: await mintToken(env) });
};
