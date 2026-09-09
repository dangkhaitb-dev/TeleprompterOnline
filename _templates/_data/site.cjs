const languages = require('./languages.cjs');

module.exports = {
  name: 'SolPrompter',
  url: process.env.SITE_URL || 'https://solprompter.com',
  assetVersion: '1',
  description: 'A minimal, fast teleprompter for the web.',
  socialImage: {
    path: '/og-solprompter.png',
    width: 1536,
    height: 1024,
    type: 'image/png',
    alt: 'SolPrompter online teleprompter and recording studio',
  },
  social: [
    {
      key: 'x',
      label: 'X',
      handle: '@SolPrompter',
      url: 'https://x.com/SolPrompter',
      ariaLabel: 'SolPrompter on X',
    },
    {
      key: 'instagram',
      label: 'Instagram',
      handle: '@contact.solplatform',
      url: 'https://www.instagram.com/contact.solplatform/',
      ariaLabel: 'SolPrompter on Instagram',
    },
    {
      key: 'youtube',
      label: 'YouTube',
      handle: '@SolPrompter',
      url: 'https://www.youtube.com/@SolPrompter',
      ariaLabel: 'SolPrompter on YouTube',
    },
  ],
  defaultLang: (languages.find((l) => l.isDefault) || languages[0]).code,
  languages,
};
