// Chỉ enforce rule cứng của project (CLAUDE.md) — không dùng config-standard
// để tránh noise stylistic.

const NO_BACKDROP_BLUR = {
  'backdrop-filter': [/blur/],
  '-webkit-backdrop-filter': [/blur/],
};

export default {
  rules: {
    // Cấm blur nền popup/overlay — chỉ tối màu bằng rgba(...) (CLAUDE.md)
    'declaration-property-value-disallowed-list': [NO_BACKDROP_BLUR, {
      message: 'No backdrop-filter: blur() — overlay backgrounds must only be darkened using background: rgba(...).',
    }],
    // Màu phải dùng token var(--...) — token khai báo trong tokens.css
    'color-no-hex': [true, {
      severity: 'warning',
      message: 'Use color token var(--...) instead of hex — tokens are declared in tokens.css.',
    }],
  },
  overrides: [
    {
      // Nơi định nghĩa token — hex hợp lệ
      files: ['src/styles/tokens.css'],
      rules: { 'color-no-hex': null },
    },
  ],
};
