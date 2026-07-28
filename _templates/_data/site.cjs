const languages = require('./languages.cjs');

module.exports = {
  name: 'SolPrompter',
  url: process.env.SITE_URL || 'https://solprompter.com',
  assetVersion: '1',
  description: 'A minimal, fast teleprompter for the web.',
  defaultLang: (languages.find((l) => l.isDefault) || languages[0]).code,
  languages,
};
