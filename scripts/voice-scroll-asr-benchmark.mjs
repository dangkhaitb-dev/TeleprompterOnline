#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222/json';
const AUDIO_BASE = process.env.AUDIO_BASE || 'http://127.0.0.1:8765/';
const MAX_PHRASES = 48;

const CORPUS = Object.freeze([
  {
    id: 'en',
    locale: 'en-US',
    text: 'Today we are testing the Zephyron QuantaMesh controller. The Aurelix protocol synchronizes every camera while PostgreSQL stores the recording metadata.',
    offscriptText: 'I changed the subject and will discuss the weather, music, and weekend plans instead.',
    terms: ['Zephyron', 'QuantaMesh', 'Aurelix', 'PostgreSQL'],
  },
  {
    id: 'vi',
    locale: 'vi-VN',
    text: 'Hôm nay chúng ta thử nghiệm bộ điều khiển Zephyron QuantaMesh. Giao thức Aurelix đồng bộ mọi máy quay trong khi PostgreSQL lưu dữ liệu bản ghi.',
    offscriptText: 'Tôi đổi chủ đề và sẽ nói về thời tiết, âm nhạc cùng kế hoạch cuối tuần.',
    terms: ['Zephyron', 'QuantaMesh', 'Aurelix', 'PostgreSQL'],
  },
  {
    id: 'ja',
    locale: 'ja-JP',
    text: '今日はゼフィロン・クアンタメッシュ制御装置をテストします。オーレリックス通信規約がすべてのカメラを同期し、ポストグレスキューエルが録画情報を保存します。',
    offscriptText: '話題を変えて、天気と音楽と週末の予定について話します。',
    terms: ['ゼフィロン', 'クアンタメッシュ', 'オーレリックス', 'ポストグレスキューエル'],
  },
  {
    id: 'ko',
    locale: 'ko-KR',
    text: '오늘은 제피론 퀀타메시 제어 장치를 시험합니다. 오렐릭스 프로토콜이 모든 카메라를 동기화하고 포스트그레스큐엘이 녹화 정보를 저장합니다.',
    offscriptText: '주제를 바꾸고 날씨와 음악 그리고 주말 계획에 대해 이야기하겠습니다.',
    terms: ['제피론', '퀀타메시', '오렐릭스', '포스트그레스큐엘'],
  },
  {
    id: 'es',
    locale: 'es-ES',
    text: 'Hoy probamos el controlador Zephyron QuantaMesh. El protocolo Aurelix sincroniza todas las cámaras mientras PostgreSQL guarda los metadatos de la grabación.',
    offscriptText: 'Cambio de tema y hablaré del tiempo, la música y los planes para el fin de semana.',
    terms: ['Zephyron', 'QuantaMesh', 'Aurelix', 'PostgreSQL'],
  },
]);

const LENGTH_CONFIGS = Object.freeze([
  { id: 'none', min: 0, max: 0, stride: 0, boost: 0 },
  { id: 'uni-b2.5', min: 1, max: 1, stride: 1, boost: 2.5 },
  { id: '2-6-b1', min: 2, max: 6, stride: 3, boost: 1 },
  { id: '2-6-b2', min: 2, max: 6, stride: 3, boost: 2 },
  { id: '2-4-b2.5', min: 2, max: 4, stride: 2, boost: 2.5 },
  { id: '2-6-b2.5', min: 2, max: 6, stride: 3, boost: 2.5 },
  { id: '2-6-b4', min: 2, max: 6, stride: 3, boost: 4 },
  { id: '2-6-b6', min: 2, max: 6, stride: 3, boost: 6 },
  { id: '2-6-b8', min: 2, max: 6, stride: 3, boost: 8 },
  { id: '4-8-b2.5', min: 4, max: 8, stride: 4, boost: 2.5 },
  { id: '6-10-b2.5', min: 6, max: 10, stride: 5, boost: 2.5 },
]);

function normalizeChars(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function wordTokens(text, locale) {
  const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  return [...segmenter.segment(text)]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment);
}

function buildHints(text, locale, config) {
  if (!config.max) return [];
  const tokens = wordTokens(text, locale);
  // Match the production teleprompter: Intl.Segmenter word tokens are joined
  // with spaces for every locale before constructing SpeechRecognitionPhrase.
  const joiner = ' ';
  const phrases = [];
  for (let start = 0; start < tokens.length; start += config.stride) {
    const phraseTokens = tokens.slice(start, start + config.max);
    if (phraseTokens.length < config.min) break;
    phrases.push({
      phrase: phraseTokens.join(joiner),
      boost: config.boost,
    });
    if (start + config.max >= tokens.length) break;
  }
  return phrases.slice(0, MAX_PHRASES);
}

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function score(reference, transcript, locale, terms) {
  const refChars = [...normalizeChars(reference)];
  const hypChars = [...normalizeChars(transcript)];
  const refWords = wordTokens(reference, locale).map(normalizeChars);
  const hypWords = wordTokens(transcript, locale).map(normalizeChars);
  const recognizedTerms = terms.filter((term) => (
    normalizeChars(transcript).includes(normalizeChars(term))
  ));
  return {
    cer: editDistance(refChars, hypChars) / Math.max(1, refChars.length),
    wer: editDistance(refWords, hypWords) / Math.max(1, refWords.length),
    termRecall: recognizedTerms.length / terms.length,
    recognizedTerms,
  };
}

async function connect() {
  const [target] = await (await fetch(CDP_URL)).json();
  if (!target?.webSocketDebuggerUrl) throw new Error('No Chrome DevTools page target');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    pending.get(message.id)(message);
    pending.delete(message.id);
  };
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const messageId = ++id;
    pending.set(messageId, resolve);
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });
  return { socket, send };
}

const HARNESS_SOURCE = String.raw`
  window.__probeVoiceScrollASR = async function probeVoiceScrollASR(locales) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const qualities = ['command', 'dictation', 'conversation'];
    const availability = {};
    for (const locale of locales) {
      availability[locale] = {};
      for (const quality of qualities) {
        try {
          availability[locale][quality] = await SR.available({
            langs: [locale],
            processLocally: true,
            quality,
          });
        } catch (error) {
          availability[locale][quality] = 'probe-error:' + error.message;
        }
      }
    }
    return {
      origin: location.origin,
      secureContext: isSecureContext,
      speechRecognition: Boolean(SR),
      speechRecognitionPhrase: Boolean(window.SpeechRecognitionPhrase),
      availability,
    };
  };

  window.__runVoiceScrollASRCase = async function runVoiceScrollASRCase(input) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const response = await fetch(input.audioUrl);
    const encoded = await response.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(encoded);
    const destination = audioContext.createMediaStreamDestination();
    const track = destination.stream.getAudioTracks()[0];
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(destination);

    const recognition = new SR();
    recognition.lang = input.locale;
    recognition.processLocally = input.processLocally;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    if (input.hints.length) {
      recognition.phrases = input.hints.map(
        (hint) => new SpeechRecognitionPhrase(hint.phrase, hint.boost)
      );
    }

    const startedAt = performance.now();
    let sourceStarted = false;
    let latestInterim = '';
    const finals = new Map();
    let error = '';
    let errorMessage = '';
    const events = [];
    let resultCount = 0;
    let timeoutId;
    let stopTimer;

    const startSource = () => {
      if (sourceStarted) return;
      sourceStarted = true;
      source.start();
    };

    const done = new Promise((resolve) => {
      recognition.onstart = () => {
        events.push('start');
        setTimeout(startSource, 100);
      };
      recognition.onaudiostart = () => events.push('audiostart');
      recognition.onsoundstart = () => events.push('soundstart');
      recognition.onspeechstart = () => events.push('speechstart');
      recognition.onresult = (event) => {
        resultCount += 1;
        latestInterim = '';
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result?.[0]?.transcript || '';
          if (result.isFinal) finals.set(i, text);
          else latestInterim += ' ' + text;
        }
      };
      recognition.onerror = (event) => {
        events.push('error:' + event.error);
        error = event.error || 'unknown';
        errorMessage = event.message || '';
      };
      recognition.onend = () => {
        events.push('end');
        resolve();
      };
      source.onended = () => {
        stopTimer = setTimeout(() => {
          try { recognition.stop(); } catch {}
        }, 1400);
      };
      timeoutId = setTimeout(() => {
        error = error || 'benchmark-timeout';
        try { recognition.abort(); } catch {}
        resolve();
      }, Math.ceil(audioBuffer.duration * 1000) + 8000);
    });

    recognition.start(track);
    setTimeout(startSource, 400);
    await done;
    clearTimeout(timeoutId);
    clearTimeout(stopTimer);
    const finalText = [...finals.entries()]
      .sort((a, b) => a[0] - b[0])
      .map((entry) => entry[1])
      .join(' ')
      .trim();
    track.stop();
    await audioContext.close();
    return {
      transcript: finalText || latestInterim.trim(),
      finalText,
      latestInterim: latestInterim.trim(),
      error,
      errorMessage,
      events,
      resultCount,
      recognitionState: {
        lang: recognition.lang,
        processLocally: recognition.processLocally,
        continuous: recognition.continuous,
      },
      elapsedMs: Math.round(performance.now() - startedAt),
      durationMs: Math.round(audioBuffer.duration * 1000),
      hintCount: input.hints.length,
    };
  };
`;

async function main() {
  const variantsArg = process.argv.find((arg) => arg.startsWith('--variants='));
  const variants = variantsArg
    ? variantsArg.slice('--variants='.length).split(',')
    : ['clean'];
  const configsArg = process.argv.find((arg) => arg.startsWith('--configs='));
  const selectedConfigIds = configsArg
    ? new Set(configsArg.slice('--configs='.length).split(','))
    : null;
  const configs = selectedConfigIds
    ? LENGTH_CONFIGS.filter((config) => selectedConfigIds.has(config.id))
    : LENGTH_CONFIGS;
  const languagesArg = process.argv.find((arg) => arg.startsWith('--languages='));
  const selectedLanguages = languagesArg
    ? new Set(languagesArg.slice('--languages='.length).split(','))
    : null;
  const corpus = selectedLanguages
    ? CORPUS.filter((sample) => selectedLanguages.has(sample.id))
    : CORPUS;
  const processLocally = !process.argv.includes('--cloud');
  const trialsArg = process.argv.find((arg) => arg.startsWith('--trials='));
  const trials = Math.max(1, Number(trialsArg?.slice('--trials='.length)) || 1);
  const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
  const outputPath = outputArg?.slice('--output='.length) || '';

  const { socket, send } = await connect();
  const versionResponse = await send('Browser.getVersion');
  const chrome = versionResponse.result?.product || 'unknown';
  await send('Page.navigate', { url: AUDIO_BASE });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const installed = await send('Runtime.evaluate', {
    expression: HARNESS_SOURCE,
    returnByValue: true,
  });
  if (installed.result?.exceptionDetails) {
    throw new Error(installed.result.exceptionDetails.text);
  }
  const locales = corpus.map((sample) => sample.locale);
  if (process.argv.includes('--install')) {
    for (const locale of locales) {
      process.stderr.write(`Installing on-device command pack for ${locale}\n`);
      const installResponse = await send('Runtime.evaluate', {
        expression: `(async () => {
          const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
          return SR.install({
            langs: [${JSON.stringify(locale)}],
            processLocally: true,
            quality: 'command',
          });
        })()`,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      const installedPack = installResponse.result?.result?.value;
      if (installedPack !== true) {
        process.stderr.write(
          `Installation result for ${locale}: ${JSON.stringify(installResponse)}\n`
        );
      }
    }
  }
  const probeResponse = await send('Runtime.evaluate', {
    expression: `window.__probeVoiceScrollASR(${JSON.stringify(locales)})`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  const probe = probeResponse.result?.result?.value || {
    error: probeResponse.result?.exceptionDetails?.text || 'probe-failed',
  };
  if (process.argv.includes('--probe')) {
    socket.close();
    console.log(JSON.stringify(probe, null, 2));
    return;
  }

  const results = [];
  for (const sample of corpus) {
    for (const variant of variants) {
      for (const config of configs) {
        for (let trial = 1; trial <= trials; trial++) {
          const hints = buildHints(sample.text, sample.locale, config);
          const input = {
            locale: sample.locale,
            audioUrl: `${AUDIO_BASE}${sample.id}-${variant}.wav?run=${Date.now()}-${config.id}-${trial}`,
            hints,
            processLocally,
          };
          process.stderr.write(
            `${sample.locale} ${variant} ${config.id} trial ${trial}/${trials} `
              + `(${hints.length} hints)\n`
          );
          const response = await send('Runtime.evaluate', {
            expression: `window.__runVoiceScrollASRCase(${JSON.stringify(input)})`,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true,
          });
          const raw = response.result?.result?.value || {
            error: response.result?.exceptionDetails?.exception?.description
              || response.result?.exceptionDetails?.text
              || 'cdp-error',
            transcript: '',
            cdpException: response.result?.exceptionDetails || null,
          };
          if (!raw.transcript && !raw.error) {
            process.stderr.write(`Empty CDP result: ${JSON.stringify(response)}\n`);
          }
          results.push({
            language: sample.id,
            locale: sample.locale,
            variant,
            config: config.id,
            trial,
            ...raw,
            ...score(
              variant === 'offscript' ? sample.offscriptText : sample.text,
              raw.transcript,
              sample.locale,
              sample.terms
            ),
          });
        }
      }
    }
  }
  socket.close();
  const report = {
    chrome,
    generatedAt: new Date().toISOString(),
    processLocally,
    probe,
    variants,
    trials,
    configs: configs.map((config) => config.id),
    results,
  };
  const reportJson = JSON.stringify(report, null, 2);
  if (outputPath) {
    await writeFile(outputPath, `${reportJson}\n`, 'utf8');
    process.stderr.write(`Saved ${results.length} cases to ${outputPath}\n`);
  } else {
    console.log(reportJson);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
