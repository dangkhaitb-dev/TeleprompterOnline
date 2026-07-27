# Voice Scroll ASR contextual-bias benchmark

Date: 2026-07-27  
Browser: Google Chrome 150.0.7871.184, macOS arm64  
Engine: Web Speech API, on-device `command` language packs  
Languages: English (`en-US`), Vietnamese (`vi-VN`), Japanese (`ja-JP`),
Korean (`ko-KR`), Spanish (`es-ES`)

## Method

- Fixed synthesized speech was used so every configuration received identical
  audio.
- Each language was tested at 185 and 235 words per minute.
- Each in-script sample contained four deliberately difficult product or
  technology terms.
- Phrase lengths, stride, and boost were varied independently.
- The baseline and selected 2–6 word configuration were repeated three times.
- A separate off-script sentence was tested against the in-script hints to
  measure hint leakage and false positives.
- Metrics are character error rate (CER), word error rate (WER), and exact
  difficult-term recall. Lower CER/WER is better; higher recall is better.

Run the benchmark:

```sh
node scripts/voice-scroll-asr-benchmark.mjs \
  --languages=en,vi,ja,ko,es \
  --variants=clean,fast \
  --configs=none,2-6-b2.5 \
  --trials=3
```

On-device language packs are origin-scoped in the tested Chrome build. Install
them for the benchmark origin when required:

```sh
node scripts/voice-scroll-asr-benchmark.mjs \
  --languages=en,vi,ja,ko,es \
  --install --probe
```

## Repeated baseline versus 2–6 words, boost 2.5

The following values average both speaking speeds and three trials per speed.

| Language | Config | CER | WER | Term recall |
|---|---:|---:|---:|---:|
| English | No hints | 10.13% | 34.17% | 25.00% |
| English | 2–6 / 2.5 | 6.92% | 20.00% | 62.50% |
| Vietnamese | No hints | 36.52% | 39.51% | 0.00% |
| Vietnamese | 2–6 / 2.5 | 36.23% | 38.89% | 0.00% |
| Japanese | No hints | 5.79% | 19.19% | 75.00% |
| Japanese | 2–6 / 2.5 | 6.71% | 21.72% | 75.00% |
| Korean | No hints | 9.60% | 37.78% | 29.17% |
| Korean | 2–6 / 2.5 | 8.19% | 34.44% | 33.33% |
| Spanish | No hints | 12.81% | 45.24% | 0.00% |
| Spanish | 2–6 / 2.5 | 13.56% | 43.65% | 0.00% |

Across all five languages, 2–6 words at boost 2.5 changed mean WER from
35.18% to 31.74%.

## Phrase-length result

- Single-word hints caused severe repetition in English (WER up to 190%).
- 4–8 and 6–10 word phrases repeatedly caused the English recognizer to end
  after the opening phrase.
- 2–6 words with stride 3 was the only tested shape that improved English
  strongly without a consistent multi-language regression.

## Boost result

For clean speech averaged across the five languages:

| Boost | CER | WER | Term recall |
|---:|---:|---:|---:|
| No hints | 13.30% | 31.59% | 25% |
| 1 | 20.86% | 36.29% | 25% |
| 2 | 11.74% | 29.59% | 35% |
| 2.5 | 12.37% | 29.59% | 35% |
| 4 | 26.36% | 37.64% | 25% |
| 6 | 11.42% | 24.85% | 40% |
| 8 | 20.68% | 33.59% | 40% |

English at boost 6 was stable across three repetitions at both speeds: CER
3.85%, WER 5%, and 100% difficult-term recall. Boost 8 hallucinated and
repeated hinted phrases in both in-script and off-script English. Vietnamese
fast speech regressed at boost 6, so boost 6 is not used globally.

## Production configuration

```text
window: 12 words behind, 120 ahead
phrase length: 2–6 words
stride: 3 words
near range: 40 words
near boost: 6 for English and Korean; 2 for all other languages
far boost: 2
maximum phrases: 48
refresh: every 16 matched words
```

The conservative default is intentional. This benchmark does not justify
using the English-specific boost for an unmeasured language.

## Browser-service limitation

Chrome's browser service emitted `phrases-not-supported` in this benchmark.
Contextual hints were therefore benchmarked on installed on-device language
packs. The application keeps browser-service recognition running without
hints when that error occurs.

## Limits

These numbers compare configurations; they are not a universal ASR accuracy
claim. The corpus uses fixed synthesized voices and clean audio. Real speakers,
microphone distance, background noise, accents, and longer scripts should be
added to future regression runs. The off-script control reduces the risk of
selecting an obviously over-biased configuration but cannot cover every
possible deviation from a script.
