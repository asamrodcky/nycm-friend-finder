import { type Env, mintGroupToken, passcodeMatches, demoBlocked } from '../../lib/auth';
import { err, json } from '../../lib/http';
import { GROUP, LOCKED_OUT, clearFailures, clientIp, isLockedOut, noteFailure } from '../../lib/throttle';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const demo = demoBlocked(env);
  if (demo) return demo;

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

  // Checked after parsing but before comparing, so a locked-out caller
  // learns nothing about the passcode itself.
  const ip = clientIp(request);
  if (await isLockedOut(env, GROUP, ip)) return err(LOCKED_OUT, 429);

  if (!passcodeMatches(passcode, env)) {
    await noteFailure(env, GROUP, ip);
    return err('that passcode is not right', 401);
  }

  await clearFailures(env, GROUP, ip);
  return json({ token: await mintGroupToken(env) });
};
