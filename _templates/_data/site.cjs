const languages = require('./languages.cjs');

module.exports = {
  name: 'SolPrompter',
  url: process.env.SITE_URL || 'https://solprompter.com',
  assetVersion: '1',
  description: 'A minimal, fast teleprompter for the web.',
  socialImage: {
    path: '/og-solprompter.jpg',
    width: 1200,
    height: 630,
    type: 'image/jpeg',
    alt: 'SolPrompter online teleprompter and recording studio',
  },
  defaultLang: (languages.find((l) => l.isDefault) || languages[0]).code,
  languages,
};
