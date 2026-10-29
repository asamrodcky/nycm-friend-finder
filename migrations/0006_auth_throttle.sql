-- 0006_auth_throttle.sql
--
-- Rate limiting for the two endpoints that take a secret. There was
-- none anywhere: §16 accepted that for "a 19-person app with a
-- three-week life", and the roster is now heading past that.
--
-- The threat is cheap and specific. A PIN is 4-6 digits, so a 4-digit
-- one is 10,000 combinations, and bib numbers are printed on every
-- roster card AND public on NYRR tracking -- so an attacker who can
-- reach /api/profile/signin can pick a person and walk their PIN space
-- at whatever rate the network allows.
--
-- WHY D1 AND NOT THE WORKERS RATE LIMITING BINDING: Pages Functions
-- only support a subset of Workers bindings, and ratelimits is not in
-- it. That turns out to be the better outcome anyway. The binding's
-- `period` may only be 10 or 60 seconds, so the tightest it can express
-- is ~10/minute -- still 17 hours to exhaust a 4-digit PIN. Here the
-- window is ours to choose, and its counts are strongly consistent
-- rather than approximate and per-Cloudflare-location.
--
-- One row per (scope, key), holding a count and the start of the window
-- it belongs to. A window older than the limit is treated as expired
-- and reset in place, so rows are reused rather than accumulated.
CREATE TABLE auth_throttle (
  scope            TEXT    NOT NULL,   -- 'signin' | 'group'
  throttle_key     TEXT    NOT NULL,   -- the bib/name being attacked, or the client IP
  attempts         INTEGER NOT NULL,
  window_start_utc TEXT    NOT NULL,
  PRIMARY KEY (scope, throttle_key)
) WITHOUT ROWID;

-- Lets the opportunistic prune in noteFailure() find expired rows
-- without scanning, which matters only if someone sprays many keys.
CREATE INDEX idx_auth_throttle_window ON auth_throttle (window_start_utc);
