// GET /api/mode -> { demo, viewer_key }
//
// The one endpoint with no auth on it, and it has to be: the browser
// needs to know whether to put a password screen in front of somebody
// before it holds any credential to ask with.
//
// It gives away nothing. Whether this deployment is a read-only demo is
// not a secret -- the page says so in a banner -- and viewer_key is a
// row number on a roster whose identities were removed by 0010. When
// DEMO_MODE is off the key is withheld anyway, so a live deployment
// answers only "no".

import { type Env, demoMode, demoViewerKey } from '../../lib/auth';
import { json } from '../../lib/http';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const demo = demoMode(env);
  return json({ demo, viewer_key: demo ? await demoViewerKey(env) : null });
};
