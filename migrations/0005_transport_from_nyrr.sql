-- dim_transport: replace the seeded guesses with what NYRR actually offers.
--
-- 0001 seeded this list from secondary sources with a note to correct it
-- once the real options were known. Sam has the NYRR email now, and it
-- lists four:
--
--   Staten Island Ferry
--   New Jersey Bus (Meadowlands)
--   Midtown Bus (NYPL)
--   Have My Own Transportation
--
-- plus the charity / team bus, which NYRR does not run but which charity
-- runners genuinely take -- it was on the original spreadsheet for that
-- reason, and two people on the live roster are on one today.
--
-- WHY THIS IS UPDATE AND DELETE RATHER THAN A RESEEDED TABLE: every key
-- below is referenced by fct_runner_start, including superseded rows
-- that preserve what someone picked before they changed it. Checked
-- against production before writing this -- across ALL history, only
-- keys 1, 4 and 8 have ever been used:
--
--   key 1  Staten Island Ferry    17 rows   (13 current)
--   key 4  Charity / team bus      3 rows   ( 2 current)
--   key 8  Still deciding          1 row    ( 1 current)
--
-- So keys 2, 3, 5, 6 and 7 are free to relabel or remove, and the two
-- that carry real answers (1 and 4) keep both their key AND their
-- meaning. Nobody's stored answer changes meaning because of this file.

-- Already correct -- NYRR calls it exactly this. Left alone deliberately,
-- because 13 of the 16 assignments point at it.
UPDATE dim_transport SET sort_order = 1 WHERE transport_key = 1;

-- Relabelled to NYRR's wording. Never used by anyone, so this is a
-- rename of an option nobody has chosen, not a change to an answer.
UPDATE dim_transport
   SET transport_label = 'New Jersey Bus (Meadowlands)',
       origin_name     = 'Meadowlands',
       origin_borough  = 'New Jersey',
       sort_order      = 2
 WHERE transport_key = 3;

UPDATE dim_transport
   SET transport_label = 'Midtown Bus (NYPL)',
       origin_name     = 'NY Public Library, 5th Ave & 42nd St',
       origin_borough  = 'Manhattan',
       sort_order      = 3
 WHERE transport_key = 2;

-- "Have My Own Transportation", and NOT matchable.
--
-- This is the one judgement call in the file. Two people who both picked
-- the ferry at 5:30 are on the same boat; two people who both drive
-- themselves at 5:30 are in two different cars. Reporting that as a
-- match would be exactly the false precision dim_transport.is_matchable
-- exists to prevent -- the column comment in 0001 already says so about
-- "a bus", and this is the same problem.
--
-- The cost of 0 is a missed suggestion; the cost of 1 is two people
-- agreeing to meet somewhere neither of them is going. Nobody is on this
-- option today, so nothing visible changes either way.
UPDATE dim_transport
   SET transport_label = 'Have My Own Transportation',
       method          = 'Own',
       origin_name     = NULL,
       origin_borough  = NULL,
       icon_id         = 'car',
       sort_order      = 4,
       is_matchable    = 0
 WHERE transport_key = 5;

-- Charity / team bus keeps its label: two people are on it and the words
-- still describe what they picked. Its sort_order moves below the four
-- NYRR options because it is not one of them.
UPDATE dim_transport SET sort_order = 5 WHERE transport_key = 4;

-- The two honest-ignorance rows stay last and stay unmatchable.
UPDATE dim_transport SET sort_order = 6 WHERE transport_key = 7;
UPDATE dim_transport SET sort_order = 7 WHERE transport_key = 8;

-- "Walking / local" goes. It is not an NYRR option, nobody has ever
-- picked it, and it overlaps "Have My Own Transportation" -- keeping
-- both would split the Staten Island locals across two options that can
-- never match each other, which is worse than having one.
DELETE FROM dim_transport WHERE transport_key = 6;
