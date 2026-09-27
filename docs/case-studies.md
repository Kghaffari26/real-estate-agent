# Case studies

Five real incidents from building this agent, each as problem → how it was caught →
fix → result. Sources: `DECISIONS.md`, `STATUS.md`, `data/guard_failures.jsonl`,
`evals/history.jsonl` and the git log. Commit links point at this repo.

The through-line: the model never computes a published number, and every defense
was added because something got past the previous one. Some of the catches below
came from a guard, some from a test. The two investigator ones came from a person
reading a live output that every automated check had passed.

---

## 1. The index outgrew its 150 KB budget, and the size guard refused to publish

**Problem.** Adding per-metro figures to alert groups (incident 5) and the
investigations list pushed `latest.json` past `max_index_kb = 150`. It had already
been at 147.5 KiB after the first real run (`STATUS.md`, 2026-09-26: "the next
addition will trigger §10's trimming").

**How it was caught.** A **live run**: the size check in `agent.py` raised
`PublishSizeError: latest.json is 154755 bytes after trimming (limit 153088)`. The
run failed and nothing was published, so the previous data stayed up. That's §10
working as specified. SPEC §10's only trimming step (drop `national.series`
beyond the core 6) saves about 2 KB, so it couldn't absorb the growth.

**Fix.** A byte breakdown of the index (a free, no-key run) showed 129 KB of the
index was `metros[].latest`: every metro summary serialized the full `MetricValue`,
7 of whose 9 fields are always `null` in the index. §6.1 specifies `{value, yoy}`,
so the index now matches the spec with a `MetricSummaryValue` model. The size check
also now counts `meta.warnings`, which it had left out, with a 512-byte margin, and
§10's trimming has a test
([2cbd219](https://github.com/Kghaffari26/real-estate-agent/commit/2cbd219),
[fa20bc1](https://github.com/Kghaffari26/real-estate-agent/commit/fa20bc1)).

**Result.** `latest.json` went from 147.5 KiB to **85 KB**, with investigations and
alert figures included. Metro files are unchanged (8.7–11.9 KB, limit 40 KB). One
cost: the failed run spent $0.06 on briefs before the size check ran. Checking
size before calling the LLM would have been cheaper.

## 2. The number guard catches mis-rounded figures in live briefs, including the same one twice

**Problem.** The fast-tier model sometimes rounds a figure wrongly. In the first
real run (2026-09-26), `north-port-fl` wrote "$420,000" for a median of $419,990.
`oklahoma-city-ok` wrote its rent as **"$1,379"** when ZORI was **$1,378.08**, and
it made the same mistake again on 2026-09-27, from the same prompt hash. Another
2026-09-27 brief, `oakland-ca`, quoted a "4" and a "6" that weren't in its facts.

**How it was caught.** **Guard**: `fields_guard(facts, ["text", "key_points"])`
in `analyze.py` accepts a token only if it's a correct rounding of a fact, and
"$1,379" isn't a rounding of 1378.08. Each failure is logged to
[`data/guard_failures.jsonl`](../data/guard_failures.jsonl) with the unsupported
tokens.

**Fix.** None was needed in the prompt. The guard retried once, naming the bad
token, and the retry dropped or corrected it. The template is the fallback if the
retry fails too
([90f55be](https://github.com/Kghaffari26/real-estate-agent/commit/90f55be),
[ffd01aa](https://github.com/Kghaffari26/real-estate-agent/commit/ffd01aa)).

**Result.** Across three full generations of the 50 metro briefs, 4 of 150 failed
the first check. All 4 passed on the retry, so every published brief is
`narrative_source: "llm"` and no wrong figure was published. The same guard caught
the investigator quoting "36" (its tool's search window, not a fact). That phrase
is now allow-listed
([6d1d392](https://github.com/Kghaffari26/real-estate-agent/commit/6d1d392)). The `LLM_BRIEFS` eval tracks this as
`guard_first_try` (1.000 on the 12 fixtures).

## 3. The investigator computed "4.3 times", and the number guard passed it by coincidence

**Problem.** The second live Pittsburgh investigation said prices grew "more than
three times the 2.2% national growth and **4.3 times** its Northeast peers' median
growth of 1.8%". The model computed 7.8/1.8 itself, which the design forbids.

**How it was caught.** A **person reading the live run's output**. Every automated
check passed:
- The number guard passed because 4.3 happens to appear elsewhere in that run's
  tool outputs. The guard checks that a number *exists* in the facts, not *where
  it came from*.
- The eval suite (1.000 pass rate) had no case that tempted a multiple.

**Fix.** The `finish` tool's schema now rejects "N times", "Nx", "twice" and the
like, and the system prompt names multiples as a forbidden calculation. No tool
ever returns a multiple, so any multiple in an explanation is the model's own
arithmetic. A rejected `finish` goes back to the model as an error, and it restates
both figures
([6d1d392](https://github.com/Kghaffari26/real-estate-agent/commit/6d1d392)).

**Result.** The next live Pittsburgh explanation compares "7.8%" with "2.2%" and
"-10.5%" directly. A unit test pins the rejected phrasings, and the investigator
suite stayed at 1.000 pass rate. A new eval case that invites a multiple is still
to do (`STATUS.md`).

## 4. The investigator's reasoning ran backwards, with every number correct

**Problem.** The first live investigation (Pittsburgh, top mover, +7.8% YoY) called
rising inventory (+5.2%) with falling sales (−7.3%) "tightening supply dynamics …
as demand outpaces available stock". It also read "rank 1 among the metro and its
5 peers" as "the strongest performer among Northeast markets".

**How it was caught.** A **live run**, read by a person. The number guard passed,
since every figure was real. The LLM judge had scored a similar explanation 0.75
("accurate") in the evals. It checks figures against evidence more than reasoning.

**Fix.** Two changes in
[80418cc](https://github.com/Kghaffari26/real-estate-agent/commit/80418cc):
- The system prompt now says which direction of change loosens or tightens a
  market, and that a peer comparison covers only the peers.
- `compare_to_peers` returns `rank_vs_peers` with a `rank_note` ("1 = the largest
  change among this metro and its 5 peers only (not the whole region)") instead of
  an ambiguous `rank_among_metro_and_peers`.

**Result.** The regenerated explanation says inventory growth means "the price
growth is not driven by supply constraints" and compares Pittsburgh only with "its
five closest regional peers". The judge's mean didn't move (0.833 before and after;
6 cases × a 1–5 scale is coarse). That's why incidents 3 and 4 were caught by
reading, and why judge calibration against human labels is next in `STATUS.md`.

## 5. Alert groups were labelled with the first metro's figure

**Problem.** An alert groups every metro with the same flag, but its label came from
whichever metro was first: "Inventory -24.2% YoY" for a group of 4 metros whose
drops ran from 20% to 25%. The national brief then repeated it as "4 metros recorded
inventory declines of 24%", a figure that was true of only one of them.

**How it was caught.** A **live run**: reading the first real national brief
(`STATUS.md`, 2026-09-26, "Things you must do by hand" #6). The number guard
couldn't catch it, because 24 was a real computed number, attached to the wrong
subject. agents-hub reported the same problem from the site side.

**Fix.** `flags.build_alerts` labels a group with its threshold ("Inventory down
≥20% YoY") and its highest severity. Each metro gets its own label, value and
severity in an additive `alerts[].metros` list (§6.3). The national prompt receives
up to 3 of those per-metro examples. A test covers mixed severities and a
threshold that isn't the first metro's value
([fa20bc1](https://github.com/Kghaffari26/real-estate-agent/commit/fa20bc1)).

**Result.** The live national brief now reads "4 metros — Jacksonville, Miami, North
Port, and others — saw inventory drop at least 20% YoY" and "22 metros saw monthly
payments rise at least 10% … including Chicago (+14%)". Every figure is attached to
the metro it belongs to.
