// Everything the input form needs to build its dropdowns.
//
// The form is driven by the DATABASE, not by hardcoded HTML. Correcting
// a seeded dimension row -- a transport option, a bridge deck -- changes
// the UI with no code change and no redeploy.

import { type Env, requireGroup } from '../../lib/auth';
import { json } from '../../lib/http';

/** 04:00 - 08:00 in 15-minute steps: covers every ferry and bus slot. */
function departureSlots(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let m = 4 * 60; m <= 8 * 60; m += 15) {
    const h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, '0');
    out.push({
      value: `${String(h).padStart(2, '0')}:${mm}`,
      label: `${h > 12 ? h - 12 : h}:${mm} ${h < 12 ? 'AM' : 'PM'}`,
    });
  }
  return out;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const blocked = await requireGroup(request, env);
  if (blocked) return blocked;

  const [colors, waves, corrals, transports] = await env.DB.batch([
    env.DB.prepare('SELECT color_key, color_name, color_hex, village_name, bridge_level, route_note FROM dim_color ORDER BY color_key'),
    env.DB.prepare('SELECT wave_key, wave_num, start_time_local, corral_open, corral_close, wave_label FROM dim_wave ORDER BY wave_num'),
    env.DB.prepare('SELECT corral_key, corral_letter FROM dim_corral ORDER BY corral_key'),
    env.DB.prepare('SELECT transport_key, transport_label, method, origin_name, origin_borough, icon_id, is_matchable FROM dim_transport ORDER BY sort_order'),
  ]);

  return json({
    colors: colors.results,
    waves: waves.results,
    corrals: corrals.results,
    transports: transports.results,
    departure_slots: departureSlots(),
    race: { name: 'TCS New York City Marathon', date: '2026-11-01' },
  });
};
