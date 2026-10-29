# WheelCam

Broadcast graphics for Squeektoshi's wheel stream. WheelCam is a set of transparent
web pages you add to OBS as Browser Sources: a corner bug, a lower third, a ticker, an
analog rpm gauge, a run card with a live speed trace and alert plates, all driven by the
live WHEELY9000 telemetry and the settled Squeekchain numbers. Open the page without
parameters and you get the studio, where you preview every scene (the everyday four
stacked over a drawn stand-in for the camera, so you can see the finished broadcast
without OBS), pick your own accent colour and small-print size, fire test alerts and
copy ready-made OBS links. There is a 9:16 version of the program for phone-shaped
streams too.

It is a fan project. The hamster, the wheel and the chain belong to the Squeekchain
folks at [squeekchain.com](https://squeekchain.com); WheelCam only reads their public API.

## Scenes

| Scene | What it shows | OBS source size |
| --- | --- | --- |
| `bug` | The wheel mark turning at the real wheel speed, live rpm, and whether Squeektoshi is on the wheel, taking a breather, stirring or asleep | 1920 x 1080 |
| `lowerthird` | Distance today, 7-day top speed, settled Squeek block height with a bar to the next block, how long ago the last round settled, blocks still queued | 1920 x 1080 |
| `ticker` | A crawl of lifetime km, settled blocks, records, the latest settlement and test SQK minted, written to be read out loud | 1920 x 1080 |
| `gauge` | A 0 to 140 rpm dial with a sprung needle, the 7-day rpm record marked in orange, and a rolling odometer for today | 720 x 720 |
| `run` | This run as it happens: a speed trace since he stepped on, distance, run clock, top and average speed, with the 7-day best as a dashed line. Between runs it keeps the last one up | 720 x 720 |
| `alerts` | One plate at a time: woke up, went to sleep, run recap, speed record, lifetime and daily distance milestones, speed milestones, distance streaks, new Squeek blocks | 1920 x 1080 |
| `program` | The everyday four in one source: bug, lower third, ticker and alerts. The studio shows it over a drawn stand-in for the camera | 1920 x 1080 |
| `program` with `layout=vertical` | The program for phone-shaped streams: bug and run card up top, alerts mid-frame, the lower third above the strip where phone apps put their chat. The studio shows it over a vertical stand-in | 1080 x 1920 |
| `full` | All of the above in one 1920 x 1080 layout that never overlaps itself, with the gauge and run card docked at a smaller size | 1920 x 1080 |

The 1920 x 1080 scenes share one layout, so you can stack several of them at full canvas
size and nothing collides. Every scene scales to whatever size the source is, keeping its
aspect ratio. The gauge and the run card are square: place them wherever they look good.

The vertical program is its own layout on a 1080 x 1920 canvas. Phone apps lay their own
header over roughly the top 150 px and their chat and buttons over the bottom 240 px, so
both strips stay empty. The bug sits in a top corner with the run card (at 80 %) stacked
under it on the same side, alerts play mid-frame below the run card, and the lower third,
narrowed to 952 px, sits just above the chat strip. There is no ticker or gauge in it: a
crawl that narrow shows a few words at a time, and the bottom strip it would need belongs
to the app. Each plate grows away from its neighbours, so bigger small print never pushes
one into another, and `scale` only shrinks it.

When the feed is stale, missing or the API says `unavailable`, the graphics swap to a
yellow and black "Signal lost" plate. Unknown numbers print as `--`, never as zero. A
sleeping hamster, on the other hand, is a perfectly good zero: the bug says ASLEEP and
the lower third tells you when he usually turns up, based on the 7-day typical day. The
run card keeps his last run on screen while he sleeps; if it opened after that run, it
pieces the run together from the stats feed's half-hour totals and stamps it EST.

## URL parameters

| Parameter | Values | Default |
| --- | --- | --- |
| `scene` | `bug`, `lowerthird`, `ticker`, `gauge`, `run`, `alerts`, `program`, `full` | none (studio) |
| `layout` | `vertical` for the 9:16 program (only the program has one) | landscape |
| `theme` | `dark` (broadcast black plates) or `light` (warm white plates) | `dark` |
| `accent` | Six hex digits without the `#` (`5aa9e6`; `%23` plus the digits and three-digit `fc0` work too). Takes over from the signal yellow in every scene. Anything else is ignored | signal yellow `f4c20d` |
| `type` | 90 to 130, in steps of 5: the small print in percent (labels, units, notes, status words, ticker, alert details). Big figures keep their size. Out of range is clamped; anything that is not a whole number is ignored | `100` |
| `scale` | 0.5 to 2. Scales each plate around its anchor. The gauge, the run card and the vertical program only shrink; resize their sources instead | `1` |
| `corner` | `tl`, `tr`, `bl`, `br` for the bug. Program and the full package keep it in a top corner; the vertical program also puts the run card on that side | `tr` |
| `sound` | `1` for short synthesized blips on alerts (WebAudio, no files) | off |
| `demo` | `1` for a scripted 160-second night: an estimated last run on the run card, then wake-up, sprints, a record, milestones, a streak, two settlements, a run recap, bedtime and a signal drop. Tagged DEMO on screen | off |
| `mute` | Comma list of alert kinds to keep off air: `wake`, `sleep`, `run_recap`, `speed_record`, `distance_milestone`, `daily_distance_milestone`, `speed_milestone`, `distance_streak`, `blocks` | none |
| `motion` | `reduce` to force cuts and fades (the system's reduced-motion setting is honoured anyway) | auto |

Example: `https://your-host/?scene=bug&corner=tl&theme=light`

Vertical, in your colours: `https://your-host/?scene=program&layout=vertical&accent=5aa9e6&type=115`

How the accent is applied (`src/logic/colour.ts`, covered by `npm test`): on dark plates
it fills the tabs, bars, the gauge arc and hub, the odometer's metre drums, the run trace
and the running lamp; on light plates the tabs stay black and the accent becomes their
lettering, the metre drums and the running lamp. Lettering that
sits on the accent switches between black and cream, whichever reads better. A colour too
dark to see is lifted towards white until it stands 3:1 off the black plates, or 4.5:1 as
lettering on the light theme's black tabs. The yellow and black "Signal lost" stripes and
the orange for records and estimates do not change, so a warning still looks like one.
The accent only ever reaches the page as a `#rrggbb` value rebuilt from numbers.

## Data feeds

All data comes from the public API at `https://api.squeekchain.com/v1` (CORS open, no
key). There are no contract calls, no wallet and no transactions anywhere in this app.
Big numbers arrive as decimal strings and stay `BigInt` until they become text.

| Endpoint | Every | Used for |
| --- | --- | --- |
| `/v1/status` | 2 s | `measurement` (coreStatus, rpmMilli, speedMmPerSecond, distanceMm, freshness, receivedAt) for the live readout; `builder.anchor` (blockHeight, blockProgress, settledThroughRound, confirmedAt) for settled chain data; `builder.projected` for blocks still queued |
| `/v1/events?category=measurement&limit=40` | 15 s | Records, milestones and streaks for the alerts. Their speeds also help estimate the top speed of a run the page joined late |
| `/v1/measurement/stats?range=7d` | 60 s | Lifetime totals, the 7-day records, the typical day, and `activity.days[].buckets` (half-hour work totals) for estimating runs the page did not watch |
| `/v1/settlements?range=now` | 60 s | The latest settlement that added blocks, for the ticker |
| `/v1/economy/state` | 60 s | Total test SQK minted, for the ticker |

Each scene only polls what it draws: the bug reads `/v1/status` and nothing else, the run
card reads `/v1/status` and the stats. The alerts read the stats too, so a run that was
already under way when the source opened can still get an estimated recap.
Requests send `If-None-Match` with the ETag the API returns (exposed through CORS) and
reuse the cached copy on 304. Failures back off exponentially with jitter (status: 2 s
doubling up to 30 s), and 429 or 503 wait at least the `Retry-After` the API asks for.

How alerts are decided (all in `src/logic/rules.ts`, covered by `npm test`):

- **Woke up**: `coreStatus` goes from IDLE to ACTIVE and stays ACTIVE for 60 seconds.
  **Went to sleep**: back to IDLE and held for 3 minutes. A lost signal freezes the
  state, so an outage can never announce a bedtime by itself.
- **Run recap**: a run has ended (see below). The plate gives its distance, how long he
  was on the wheel and the top speed, and airs just before "back to bed". Runs shorter
  than a minute or 10 m get no plate.
- **Squeek blocks**: `builder.anchor.blockHeight` went up; the plate says how many and
  which. Block alerts that have not aired yet merge into one.
- **Records, milestones, streaks**: measurement events, deduplicated by `id`, and only
  those that occurred after the page loaded (server time), so reloading OBS does not
  replay last night.
- Plates never overlap: they queue and air one at a time.

How runs are tracked (all in `src/logic/run.ts`, covered by `npm test`):

- A run starts with the first ACTIVE reading and ends once the wheel has been out of
  ACTIVE for 3 minutes, the same hold as "went to sleep". A shorter breather stays inside
  the run and shows as a dip in the trace. The run ends at his last ACTIVE reading.
- Distance is the growth of the wheel's own day counter between readings. The noon UTC
  roll-over counts from zero, and a jump faster than any hamster is ignored. Top speed is
  the fastest reading seen (speeds above 4 m/s count as glitches); the trace keeps up to
  480 samples and averages neighbours once a long run outgrows that.
- A lost signal keeps the run open and restarts the 3-minute hold, so an outage never
  ends a run.
- Opened mid-run, a source cannot know when he started. It takes the unbroken stretch of
  busy half hours that reaches the present, assumes he started as late as the first half
  hour's work allows at a steady pace, and takes the distance before tune-in from the day
  counter minus what the day had logged before that stretch. The start, the distance and
  the dashed half-hour averages on the trace are stamped EST. If the totals cannot tell
  (he started minutes ago), the card counts from tune-in and says PARTIAL instead.
- Between runs the card shows the last run it watched, or else the latest stretch of busy
  half hours in the stats, stamped EST.

## Development

You need Node 22.18 or newer (the tests load the TypeScript sources directly).

```sh
npm install
npm run dev        # studio at the printed URL; add ?scene=full&demo=1 to rehearse
npm test           # alert and run logic, readers, formatting, look parameters (node:test)
npm run probe      # checks the live API still has every field the graphics read
npm run build      # type-check, then build to dist/
npm run preview    # serve dist/
```

To point the build at another API base, set `VITE_SQUEEK_API` at build time.

## Putting it online

It is a static site. On Vercel, import the repo and keep the Vite defaults (build command
`npm run build`, output directory `dist`). Any static host works; the build uses relative
paths, so a sub-folder is fine too. Then open the deployed URL, pick a look in the studio
and copy the links into OBS.

In OBS: add a Browser source, paste the link, set the width and height from the table
above, and untick "Shutdown source when not visible" so the alerts keep watching the
wheel. If you use `sound=1`, tick "Control audio via OBS". For the vertical program, set
the OBS canvas to 1080 x 1920 first (Settings, Video, Base Canvas Resolution).

## Known limits

- It polls; there is no push feed. Live numbers can trail the wheel by a couple of
  seconds, and settled numbers trail it by 10 to 20 minutes because that is how often
  rounds settle on Sepolia.
- "Today" is the wheel's own day, noon to noon UTC, because that is what the device
  reports. The top speed is the 7-day peak from the stats endpoint, not a per-day value.
- The wake and sleep timers (60 s and 3 min) are judgment calls about a hamster's habits.
  If he naps in short bursts, a wake-up may not be announced; that is deliberate.
- Alerts are decided in each browser source. If OBS was closed when something happened,
  that alert is gone; nothing is replayed after a reload.
- Runs are tracked in each browser source from the 2-second status readings. A sprint
  between two polls can be missed, so a run's top speed can sit below the API's own peak
  record. Two sources opened at different times can disagree about an estimated start.
- Anything rebuilt from half-hour totals is a guess: a nap inside a half hour is
  invisible to it, and times are a steady-pace estimate. That is why it says EST.
- The studio's nine previews each poll on their own, and the conditional requests trigger
  CORS preflights. Well inside the API's limits, but close the studio tab when you are done.
  Changing the accent or the small print repaints them in place without reloading.
- The vertical program's empty strips (150 px top, 240 px bottom) are a rough average of
  what phone apps cover; check yours with the app open. Its lower third shortens a long
  status line with an ellipsis rather than run past its edge.
- A very dark accent on dark plates, or as lettering on light ones, is shown lifted, so it
  will not match your brand swatch exactly. That is the price of being able to read it.
- Sound needs a browser that lets the page start audio. OBS does; a normal browser tab
  plays it only after you have clicked something on the studio page.
- The wake-up hint ("usually up around 21:00 UTC") is a 7-day average, not a promise.
- SQK on Sepolia is test money. Nothing here has real value.

## License

MIT. See [LICENSE](LICENSE). Barlow and Barlow Condensed are bundled from Fontsource
under the SIL Open Font License.
