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
  // "Launched on StartupBase" badge — rendered in the home footer only.
  // Artwork is a 300x80 SVG served from their CDN; we scale it to 55px tall
  // and declare both dimensions so the footer never shifts while it loads.
  launchBadge: {
    url: 'https://startupbase.io/products/solprompter?utm_source=startupbase&utm_medium=badge&utm_campaign=launch-badge-light',
    imageSrc: 'https://statics.startupbase.io/site/badges/launched-on-sb.svg',
    alt: 'Launched on StartupBase',
    width: 206,
    height: 55,
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
