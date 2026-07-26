import js from '@eslint/js';
import globals from 'globals';
import { EVENTS } from './src/script/constants/events.js';

// Layer import direction (CLAUDE.md): constants → http → service → model → logic → ui.
// Rules below enforce that boundary plus the project's hard rules
// (no window.__ cross-module channels, no raw CustomEvent name literals,
// no direct localStorage/sessionStorage outside utils/).

const RULE_NO_WINDOW_UNDERSCORE = {
  selector: "MemberExpression[object.name='window'][property.name=/^__/]",
  message: 'Do not use window.__* as a cross-module communication channel — use static imports.',
};

// Cấm string literal tên CustomEvent — phải import hằng từ constants/events.js.
const EVENT_NAME_PATTERN = `^(${Object.values(EVENTS)
  .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')})$`;
const RULE_NO_EVENT_LITERAL = [
  {
    selector: `NewExpression[callee.name='CustomEvent'] > Literal[value=/${EVENT_NAME_PATTERN}/]`,
    message: 'Do not pass string literal event name to new CustomEvent — import EVENTS.* from constants/events.js.',
  },
  {
    selector: `CallExpression[callee.property.name=/^(add|remove)EventListener$/] > Literal[value=/${EVENT_NAME_PATTERN}/]`,
    message: 'Do not pass string literal event name to add/removeEventListener — import EVENTS.* from constants/events.js.',
  },
];

const RULE_NO_DIRECT_STORAGE = [
  { object: 'localStorage', message: 'Do not call localStorage in feature code — wrap in utils/, with key declared in utils/storage-keys.js.' },
  { object: 'sessionStorage', message: 'Do not call sessionStorage in feature code — wrap in utils/.' },
];

const RULE_NO_UI_IMPORT = {
  patterns: [{
    group: ['**/*.ui.js', '**/*.ui'],
    message: 'This layer cannot import .ui.js files (import order: service → model → logic → ui).',
  }],
};

const RULE_NO_SERVICE_IMPORT = {
  patterns: [{
    group: ['**/services/*'],
    message: 'UI layer (ui/component/entry) cannot import services directly — go through logic.',
  }],
};

const RULE_NO_DOM_GLOBALS = [
  { name: 'document', message: 'This layer cannot touch the DOM — move to a .ui.js file.' },
  { name: 'window', message: 'This layer cannot touch window (DOM/event) — move to a .ui.js file.' },
];

export default [
  {
    ignores: ['node_modules/**', 'dist/**', '_11ty-output/**', 'public/**', 'lib/**'],
  },

  // ---- Base: toàn bộ JS app ----
  {
    files: ['src/script/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-restricted-syntax': ['error', RULE_NO_WINDOW_UNDERSCORE, ...RULE_NO_EVENT_LITERAL],
      'no-restricted-properties': ['error', ...RULE_NO_DIRECT_STORAGE],
      'max-lines': ['warn', { max: 700, skipBlankLines: true, skipComments: true }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },

  // Shim chạy được cả node lẫn browser (guard bằng typeof)
  {
    files: ['src/script/lib/**/*.js'],
    languageOptions: { globals: { ...globals.browser, process: 'readonly' } },
  },

  // ---- Layer rules ----
  // ui / component / entry (*-main.js, main.js) không import service trực tiếp
  {
    files: [
      'src/script/**/*.ui.js',
      'src/script/features/**/components/**/*.js',
      'src/script/*-main.js',
      'src/script/main.js',
    ],
    rules: {
      'no-restricted-imports': ['error', RULE_NO_SERVICE_IMPORT],
    },
  },
  // service/model/logic không import ui, không đụng DOM
  {
    files: ['src/script/services/**/*.js', 'src/script/**/*.model.js', 'src/script/**/*.logic.js'],
    rules: {
      'no-restricted-imports': ['error', RULE_NO_UI_IMPORT],
      'no-restricted-globals': ['error', ...RULE_NO_DOM_GLOBALS],
    },
  },
  // http là layer thấp nhất (chỉ trên constants) — không import ui, không đụng DOM/window
  {
    files: ['src/script/http/**/*.js'],
    rules: {
      'no-restricted-imports': ['error', RULE_NO_UI_IMPORT],
      'no-restricted-globals': ['error', ...RULE_NO_DOM_GLOBALS],
    },
  },

  // ---- Wrapper layer được phép đụng storage ----
  {
    files: ['src/script/utils/**/*.js'],
    rules: { 'no-restricted-properties': 'off' },
  },
];
