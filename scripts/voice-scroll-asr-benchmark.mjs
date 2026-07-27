#!/usr/bin/env node

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222/json';
const AUDIO_BASE = process.env.AUDIO_BASE || 'http://127.0.0.1:8765/';

const CORPUS = Object.freeze([
  {
    id: 'en',
    locale: 'en-US',
    text: 'Today we are testing the Zephyron QuantaMesh controller. The Aurelix protocol synchronizes every camera while PostgreSQL stores the recording metadata.',
    terms: ['Zephyron', 'QuantaMesh', 'Aurelix', 'PostgreSQL'],
  },
  {
    id: 'vi',
    locale: 'vi-VN',
    text: 'Hôm nay chúng ta thử nghiệm bộ điều khiển Zephyron QuantaMesh. Giao thức Aurelix đồng bộ mọi máy quay trong khi PostgreSQL lưu dữ liệu bản ghi.',
    terms: ['Zephyron', 'QuantaMesh', 'Aurelix', 'PostgreSQL'],
  },
  {
    id: 'ja',
    locale: 'ja-JP',
    text: '今日はゼフィロン・クアンタメッシュ制御装置をテストします。オーレリックス通信規約がすべてのカメラを同期し、ポストグレスキューエルが録画情報を保存します。',
    terms: ['ゼフィロン', 'クアンタメッシュ', 'オーレリックス', 'ポストグレスキューエル'],
  },
  {
    id: 'ko',
    locale: 'ko-KR',
    text: '오늘은 제피론 퀀타메시 제어 장치를 시험합니다. 오렐릭스 프로토콜이 모든 카메라를 동기화하고 포스트그레스큐엘이 녹화 정보를 저장합니다.',
    terms: ['제피론', '퀀타메시', '오렐릭스', '포스트그레스큐엘'],
  },
  {
    id: 'es',
    locale: 'es-ES',
    text: 'Hoy probamos el controlador Zephyron QuantaMesh. El protocolo Aurelix sincroniza todas las cámaras mientras PostgreSQL guarda los metadatos de la grabación.',
    terms: ['Zephyron', 'QuantaMesh', 'Aurelix', 'PostgreSQL'],
  },
]);

const LENGTH_CONFIGS = Object.freeze([
  { id: 'none', min: 0, max: 0, stride: 0, boost: 0 },
  { id: 'uni-b2.5', min: 1, max: 1, stride: 1, boost: 2.5 },
  { id: '2-4-b2.5', min: 2, max: 4, stride: 2, boost: 2.5 },
  { id: '2-6-b2.5', min: 2, max: 6, stride: 3, boost: 2.5 },
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
  const joiner = locale.startsWith('ja') || locale.startsWith('zh') ? '' : ' ';
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
  return phrases.slice(0, 96);
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
    recognition.processLocally = true;
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
    let timeoutId;
    let stopTimer;

    const startSource = () => {
      if (sourceStarted) return;
      sourceStarted = true;
      source.start();
    };

    const done = new Promise((resolve) => {
      recognition.onstart = () => {
        setTimeout(startSource, 100);
      };
      recognition.onresult = (event) => {
        latestInterim = '';
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result?.[0]?.transcript || '';
          if (result.isFinal) finals.set(i, text);
          else latestInterim += ' ' + text;
        }
      };
      recognition.onerror = (event) => {
        error = event.error || 'unknown';
      };
      recognition.onend = () => resolve();
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

  const { socket, send } = await connect();
  await send('Page.navigate', { url: AUDIO_BASE });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const installed = await send('Runtime.evaluate', {
    expression: HARNESS_SOURCE,
    returnByValue: true,
  });
  if (installed.result?.exceptionDetails) {
    throw new Error(installed.result.exceptionDetails.text);
  }

  const results = [];
  for (const sample of corpus) {
    for (const variant of variants) {
      for (const config of configs) {
        const hints = buildHints(sample.text, sample.locale, config);
        const input = {
          locale: sample.locale,
          audioUrl: `${AUDIO_BASE}${sample.id}-${variant}.aiff`,
          hints,
        };
        process.stderr.write(
          `${sample.locale} ${variant} ${config.id} (${hints.length} hints)\n`
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
          ...raw,
          ...score(sample.text, raw.transcript, sample.locale, sample.terms),
        });
      }
    }
  }
  socket.close();
  console.log(JSON.stringify({
    chrome: '150.0.7871.184',
    generatedAt: new Date().toISOString(),
    variants,
    configs: configs.map((config) => config.id),
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
