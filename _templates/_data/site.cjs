const languages = require('./languages.cjs');

module.exports = {
  name: 'VTeleprompter',
  url: process.env.SITE_URL || 'https://vteleprompter.com',
  assetVersion: '1',
  description: 'A minimal, fast teleprompter for the web.',
  defaultLang: (languages.find((l) => l.isDefault) || languages[0]).code,
  languages,
};
