// Canonical language registry — single source of truth for i18n.
//
// Consumed by:
//   - site.cjs          → site.languages / site.defaultLang
//   - indexPages.cjs    → per-language index permalinks (pagination)
//   - home-base.njk     → <html dir>, hreflang alternates, language switcher
//   - eleventy.config.cjs → langDir() filter
//
// Order here defines display order in the language switcher.
// `homePath` is the clean, production URL of each language's home page:
//   '/'         for the default language (root index.html)
//   '/<code>/'  for every other language (dist/<code>/index.html)
//
// To add a language: add a row + create _data/pages/index/<code>.json.
// To remove one: delete the row + its JSON file.

// [code, English name, endonym, dir, isDefault]
const rows = [
  ['en', 'English', 'English', 'ltr', true],
  ['es', 'Spanish', 'Español', 'ltr'],
  ['pt', 'Portuguese', 'Português', 'ltr'],
  ['fr', 'French', 'Français', 'ltr'],
  ['de', 'German', 'Deutsch', 'ltr'],
  ['it', 'Italian', 'Italiano', 'ltr'],
  ['nl', 'Dutch', 'Nederlands', 'ltr'],
  ['pl', 'Polish', 'Polski', 'ltr'],
  ['ru', 'Russian', 'Русский', 'ltr'],
  ['uk', 'Ukrainian', 'Українська', 'ltr'],
  ['tr', 'Turkish', 'Türkçe', 'ltr'],
  ['vi', 'Vietnamese', 'Tiếng Việt', 'ltr'],
  ['th', 'Thai', 'ไทย', 'ltr'],
  ['id', 'Indonesian', 'Bahasa Indonesia', 'ltr'],
  ['ms', 'Malay', 'Bahasa Melayu', 'ltr'],
  ['fil', 'Filipino', 'Filipino', 'ltr'],
  ['ja', 'Japanese', '日本語', 'ltr'],
  ['ko', 'Korean', '한국어', 'ltr'],
  ['zh', 'Chinese (Simplified)', '简体中文', 'ltr'],
  ['zh-Hant', 'Chinese (Traditional)', '繁體中文', 'ltr'],
  ['hi', 'Hindi', 'हिन्दी', 'ltr'],
  ['bn', 'Bengali', 'বাংলা', 'ltr'],
  ['ar', 'Arabic', 'العربية', 'rtl'],
  ['fa', 'Persian', 'فارسی', 'rtl'],
];

module.exports = rows.map(([code, name, endonym, dir, isDefault]) => ({
  code,
  name,
  endonym,
  dir,
  isDefault: Boolean(isDefault),
  homePath: isDefault ? '/' : `/${code}/`,
}));
