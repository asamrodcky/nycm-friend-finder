# Case study: six things that went wrong, and what they taught me

NYCM Friend Finder ran for 17 days and 73 people used it. This is the short version of
what actually happened — the problems worth reading about, rather than a tour of the
features.

The full chronological log is in [`project_notes_public.md`](../project_notes_public.md);
it is about 25,000 words and reads like working notes, because that is what it is. This
file is the 15-minute version.

1. [8.5%: the app wasn't broken, the order was](#1-85-the-app-wasnt-broken-the-order-was)
2. [The link that lost its password by design](#2-the-link-that-lost-its-password-by-design)
3. [A promise that never settles](#3-a-promise-that-never-settles)
4. [White on white, in one theme only](#4-white-on-white-in-one-theme-only)
5. [A spectator is not a runner with missing fields](#5-a-spectator-is-not-a-runner-with-missing-fields)
6. [Taking the identities out afterwards](#6-taking-the-identities-out-afterwards)

---

## 1. 8.5%: the app wasn't broken, the order was

I shared the link with a few run-club group chats and then looked at the numbers.

| | |
|---|---|
| Unique visitors | **423** |
| Signups | **36** |
| Conversion | **8.5%** |

My first instinct was that something was broken — a JS error on some phone, a dead link,
a failing request. So before changing anything I checked whether the traffic was even
real:

- **33 KB per visitor**, which is about one full app load
- **16 requests per visitor**

Crawlers do not do that. These were real browsers, loading the whole app, and then
leaving.

The cause was in the architecture, and it was mine. `/api/runners` required a *profile*
token, not just the group passcode. So the sequence a newcomer hit was:

1. Enter the group password
2. **Invent a six-digit PIN**
3. Fill in a form
4. *Then* see that 56 people were already inside

Roughly 390 people were asked to commit before being given a single reason to. Nobody
bounced because the app was broken; they bounced because it asked first and explained
never.

**The fix I did not make** is the interesting part. The obvious move was to relax
`/api/runners` so the roster was visible behind the group passcode alone. I decided
against it: the app's whole proposition is that everybody shows their start information
to everybody else, and letting people read the roster without adding themselves breaks
that reciprocity. The passcode was already effectively public — it had been forwarded
through several group chats — so "just show them the roster" would have meant publishing
60 people's names and bib numbers to anyone with the link.

So instead I changed the order, not the permissions:

- The explanation moved **in front of** the ask — my own words about why the app exists, on
  the screen people were bouncing off
- A shareable invite link, because people could not pass the thing on (see below)
- Filters moved behind a disclosure, because on a phone three rows of filter chips *were*
  the screen before a single person was visible

**What I took from it:** the measurement that mattered was not the conversion rate, it was
the 33 KB. Without it I would have spent the evening hunting a JavaScript bug that did not
exist. Checking whether a number is even describing what you think it is costs five
minutes and changes what you work on all week.

---

## 2. The link that lost its password by design

People kept messaging me for the password. That was strange, because the link I had sent
into the group chats contained it: `nycm26friendfinder.com/?k=<passcode>`.

The cause turned out to be a feature I had written on purpose, two weeks earlier.

When you arrive on a `?k=` link, the app redeems the passcode for a token and then
**strips it from the address bar** via `history.replaceState`. That is deliberate and I
still think it is right: it means a screenshot, a bookmark, the back button and any
outbound `Referer` header cannot carry the password onward.

The consequence I never drew out: **by the time you want to share the link, your address
bar no longer has the password in it.**

So Alice opens my link, her URL goes bare a second later, she taps Share, and Bob gets a
password prompt. Every single person who asked me for the password had been sent a
stripped link by somebody already inside. The feature working correctly was producing the
complaint.

The fix was a `GET /api/invite` endpoint that mints the real link server-side, behind the
group token, with `Cache-Control: no-store` — so the passcode never has to live on a
device in order to be shared — plus a visible "Copy invite link" control with the reason
written next to it.

I also wrote 21 assertions around it before shipping, one of which killed a theory I had
been carrying for a day: that some chat app was mangling the URL. The passcode turned out
to be URL-safe on every axis — no `#`, `&`, `+`, space or non-ASCII, and it survives an
encode/decode round trip. Not the problem.

**What I took from it:** a correct feature can still be the cause. I spent a day assuming
something external was corrupting the link because the local behaviour was *right*, and
the bug was in the interaction between a security decision and a human behaviour I had
not modelled.

---

## 3. A promise that never settles

While testing that invite button in a browser, I found that it did nothing. Not an error —
nothing. The button disabled itself and stayed that way.

The handler looked fine:

```js
btn.disabled = true;
const { url } = await api('/api/invite');
try { await navigator.clipboard.writeText(url); copied = true; } catch { /* fall back */ }
```

There is a fallback for when the clipboard write fails. It never ran.

I timed the two `await`s separately rather than guessing:

| | |
|---|---|
| `/api/invite` | resolved in **10 ms** |
| `navigator.clipboard.writeText` | **still pending after 3,000 ms** |

Not rejected. *Pending* — with `document.hasFocus()` true and `visibilityState` visible.

A promise that never settles is the one outcome `try/catch` cannot survive. The `catch`
never runs, nothing after the `await` runs, and the button stays disabled wearing its
original label — permanently, until a page reload. The control whose entire purpose was to
fix link sharing failed silently, which is precisely what the code comment above it said
must never happen.

The fix is four lines:

```js
await Promise.race([
  navigator.clipboard.writeText(text),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('clipboard did not respond')), 1200)),
]);
```

Re-tested in the same conditions: settles at 1,474 ms, button re-enabled, the fallback
shows the link pre-selected for a manual copy.

**What I took from it:** `try/catch` around `await` handles rejection, not silence. Any
promise from an API you do not control — clipboard, permissions, payments, Bluetooth —
needs a timeout, and the failure mode without one is the worst kind: no error anywhere, a
dead control, and a user who thinks they are being ignored.

WebKit makes this more than theoretical. It drops the user-gesture grant across an
`await`, so on iOS — most of this roster — the fallback path is the *normal* path, not the
edge case.

---

## 4. White on white, in one theme only

A later change asked for the 26 mile-marker buttons to wrap properly on a phone. While
fixing the layout I read the stylesheet and found something worse than the layout.

Selected chips fill with the colour they represent:

```css
.chips button[aria-pressed="true"] {
  background: var(--chip);
  border-color: transparent;
  color: #fff;
}
```

`--chip` is set **inline, per colour, on the start-colour chips** — and nowhere else. On a
mile chip that variable does not exist, so the `background` declaration is invalid and
dropped. What survives is `color: #fff` and a transparent border, over a chip whose
background is still `var(--card)`.

In **light mode, `--card` is white**. A selected mile was white text on a white box with no
border. Invisible.

In dark mode `--card` is near-black, so white text looks perfect. That is why it survived
every check — including mine. I had shipped that feature from a dark-themed browser and
verified it there.

Fixed by giving non-colour chips an accent fill, measured afterwards rather than eyeballed:
**16.59:1** selected, 17.76:1 unselected.

**What I took from it:** a CSS custom property that is only sometimes defined fails
*silently and selectively*. And "I tested it" means nothing if I only tested it in my own
theme — the bug was invisible to me specifically, which is the hardest kind to catch by
looking.

---

## 5. A spectator is not a runner with missing fields

Someone asked in the group chat: *"what if I am here to spectate?"* The answer from
another member was reasonable and wrong: *"just fill it out without a bib number."*

Following that advice put a person on the roster as a runner with no bib, no colour, no
wave and no corral. I had already found three cards exactly like that during a data audit:
they matched nobody and nobody matched them. They were not broken profiles, they were
people the model had no way to represent.

So I added a role to the fact table — `participant_role`, versioned alongside wave and
corral, because spectating is a fact about *this race*: you can run New York one year and
cheer it the next. Completeness became role-aware. **A spectator with a mile is complete
without a bib.**

Then the interesting bug. A spectator who had filled in everything asked of them *still*
appeared under "still missing info", being told they needed a bib, a colour, a wave and a
corral.

`v_runner_start` had learned about roles. `v_roster_gaps`, which sits on top of it, had
not. Its filter was:

```sql
WHERE is_complete = 0 OR transport_key IS NULL
```

...and its description of what was missing named only runner fields.

I found it by **reading the rendered page**, not from my list of views to rebuild. My list
was derived from which views mentioned the columns I had changed — and `v_roster_gaps`
does not mention `participant_role` at all. It just inherits from something that does.

For somebody who will never have a bib, being told they are missing one is both wrong and
discouraging: the exact tone problem spectators were added to fix.

A later round found the same shape again. Every transport option is a way to reach the
Staten Island start — the ferry, the Verrazzano buses, charity coaches. A spectator going
to mile 18 in Manhattan is not "getting to the start", so asking them for a departure time
was the same mistake as asking for a corral.

**What I took from it:** "which views mention this column?" is not the same question as
"which views depend on this meaning?" Dependency tracing by grep finds the first; only
reading the output finds the second. And a model that forces someone to describe
themselves by what they lack will keep producing dead rows until you give them their own
shape.

---

## 6. Taking the identities out afterwards

The race was 1 November. The app stopped being useful that morning; the data did not stop
being exposed.

What was sitting in a database behind a passcode roughly 423 people had seen:

| | |
|---|---|
| People | 73, with 53 under a real first-and-last name |
| Bib numbers | 62 |
| Instagram handles | 39 |
| Free-text notes describing what somebody wore in public | 25 |
| Password hashes | 73 |

**A display name plus a bib number is a lookup key.** Race results are public: given both,
you get a finish time, splits, an age group, a hometown and official photographs of
someone's face. An Instagram handle skips the inference entirely.

My own `.gitignore` had been making this argument since the first commit — it is why the
roster CSV was never committed. The live database had quietly become the exact thing the
CSV was kept out of git to avoid.

### The decision that mattered

The tempting option was to add alias columns and keep the real values alongside, so the
data stayed queryable and the change was reversible.

I rejected it, because this project had already shipped two bugs of precisely that shape:
an endpoint doing `SELECT *` over a view that had quietly gained a private column, and a
view describing one role using another role's fields. **A column that must never be
selected is a bug waiting for the next view rebuild.** If it is not in the database, it
cannot leak.

So migration `0010` overwrote the identity fields in place, and only those. Every
timestamp, every superseded row, every follow edge, the two accidental duplicate accounts
and the four people who removed themselves stayed exactly as they were.

Two sub-decisions I would defend in an interview:

**Instagram handles are nulled, not replaced.** The roster card links to
`instagram.com/<handle>`. Any invented handle is a plausible *real* account, so
"anonymising" that field by generating one would have pointed 39 cards at strangers who
had never heard of this app. There is no safe fake value for a field that is a URL to a
person.

**Outfit notes are replaced, not nulled.** Which rows have one is real signal — 25 of 69,
the 68%-blank gap my audit had flagged as the highest-leverage thing on the roster — and a
demo where that field is always empty hides the feature that mattered most. The text is
synthetic; the distribution is real.

### The tool that was itself the leak

I had written a snapshot exporter months earlier with an `--anonymise` mode and drift
guards. When I went to run it, it refused — three times, correctly, because the schema had
gained columns and a table it had never been told about.

Behind the guard was the thing that mattered: **`--anonymise` never touched the Instagram
column.** It would have written a file labelled "synthetic" containing 39 live handles. The
guard that blocked it was the only reason that had not already happened.

Its verification was also broken, in a way I liked finding. It scanned the output for every
original value as a bare substring — and one person had registered a **one-character
display name**, which occurs in any SQL text. It matched the "G" inside `INTEGER` and
failed a run whose data was perfectly anonymised. A single-letter name would equally
collide with a corral letter. I replaced it with positive assertions about the end state.

And when I wrote a second script to scrub the names out of my engineering notes, I made the
same class of mistake in a new place: **the first version held all 15 names and 6 bib
numbers inline**, so committing it would have published, in the repo, the exact data it
existed to remove. The scrubber would have been the leak. The list now lives in a
gitignored file, and the script refuses to run without it rather than silently writing an
unscrubbed file called "public".

**What I took from it:** tooling that handles sensitive data is itself sensitive data, and
the guard is worth more than the feature. Three times here, the thing that saved me was a
check that refused to proceed rather than a check that reported a problem.

---

## What I would do differently

**Measure the funnel on day one.** I had Cloudflare analytics the whole time and did not
look until a week in. The 8.5% had been true for days.

**Test in both themes, on a real phone, every time.** Two of the six problems above were
invisible in the environment I develop in.

**Write the "what breaks this?" list before shipping, not after.** The link-sharing bug and
the spectator-gaps bug were both findable by asking "who sees this, and what do they see?"
— a question I asked consistently afterwards and inconsistently before.

**Keep the tests in the repo.** I wrote 27 projection unit tests and 21 shared-link
assertions, and ran them repeatedly, but they lived in a scratch directory and are gone.
From the outside this project looks untested, and that is my fault rather than untrue.
