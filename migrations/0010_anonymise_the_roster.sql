-- The race is over. Take the identities out and keep everything else.
--
-- The app stopped being useful on 1 November and the roster did not stop
-- being exposed. §29 measured 423 unique visitors against 36 signups, and
-- §27 chose "unlisted, not private" on purpose -- the Google-Doc posture,
-- where anybody sent the link walks in. That was a fair trade while the
-- thing was helping people find each other on race morning. It buys
-- nothing now, and what it costs is this:
--
--   a display name + a bib number is a lookup key. NYRR publishes
--   results; given both you get a finish time, splits, an age group, a
--   hometown and official photographs of someone's face.
--
--   an Instagram handle skips the inference step entirely.
--
-- .gitignore has made this argument since the first commit -- it is why
-- the roster CSV was never committed. The live database had quietly
-- become the thing the CSV was kept out of git to avoid.
--
-- IDENTITY FIELDS ONLY. Nothing structural is touched: every timestamp,
-- every superseded row, every follow edge, the two accidental duplicate
-- accounts and the four self-removals all stay exactly as they are.
-- That is deliberate. 98 versioned rows over 69 current assignments, 18
-- people who came back and edited, a 50-edge follow graph and a 16-day
-- signup curve are what show real people used this. The names never
-- were -- a name is the single easiest thing to fabricate. Tidying the
-- data to make the demo look neater would destroy the only evidence
-- that it was real.

-- Stable and obviously synthetic. "Runner 017" tells a reader this was
-- anonymised on purpose, which a plausible fake name does not.
UPDATE dim_runner
   SET display_name = 'Runner ' || printf('%03d', runner_key),
       first_name   = NULL,
       last_name    = NULL;

-- NULL rather than a synthetic handle, and this one is worth spelling
-- out: the roster card links to instagram.com/<handle>. Any invented
-- handle is a plausible real account, so "anonymising" by making one up
-- would point 39 cards at strangers who never heard of this app. There
-- is no safe fake value for a field that is a URL to a person.
UPDATE dim_runner SET instagram = NULL;

-- Nobody signs in again. PBKDF2 at the 10k iterations the Workers CPU
-- budget allows is minutes of offline work over a six-digit space, and
-- people reuse PINs across other things that matter more than this.
UPDATE dim_runner SET pin_hash = NULL, pin_salt = NULL;

-- Unique per runner, so the partial unique index on live bibs still
-- holds. Keyed on runner_key rather than row, so every superseded row
-- for a person keeps the same synthetic bib and the edit history stays
-- followable. 90000+ sits clear of every real bib on this roster
-- (checked: none fall in 90001-90073, and none are a substring of one).
UPDATE fct_runner_start
   SET bib_number = CASE WHEN bib_number IS NULL THEN NULL
                         ELSE printf('%05d', 90000 + runner_key) END;

-- Outfit notes are free text describing what a specific person wore in
-- a public place. Replaced rather than nulled, because WHICH rows have
-- one is real signal worth keeping -- 25 of 69, the 68%-blank gap §29
-- called the highest-leverage thing on the roster -- and because a demo
-- where that field is always empty hides the feature that mattered
-- most. The text is synthetic; the distribution is not.
UPDATE fct_runner_start
   SET meetup_note = CASE runner_key % 8
         WHEN 0 THEN 'bright yellow jacket, black shorts'
         WHEN 1 THEN 'red throwaway hoodie over a white singlet'
         WHEN 2 THEN 'blue cap, grey long sleeve, orange shoes'
         WHEN 3 THEN 'green team vest, white arm sleeves'
         WHEN 4 THEN 'pink headband, black tights'
         WHEN 5 THEN 'orange gloves, navy windbreaker'
         WHEN 6 THEN 'white singlet, neon green shoes'
         ELSE        'purple buff, black vest, yellow socks'
       END
 WHERE meetup_note IS NOT NULL AND meetup_note <> '';

-- Operational state with client IP addresses in it. Empty right now;
-- cleared so that stays true.
DELETE FROM auth_throttle;
