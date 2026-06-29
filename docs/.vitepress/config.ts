import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'blobpipe',
  description: 'Provider-agnostic file storage for Node.js',
  base: '/blobpipe/',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'blobpipe' }],
    ['meta', { property: 'og:description', content: 'Provider-agnostic file storage for Node.js' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'blobpipe' }],
    ['meta', { name: 'twitter:description', content: 'Provider-agnostic file storage for Node.js' }],
  ],

  markdown: {
    lineNumbers: true,
  },

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'Drivers', link: '/drivers/', activeMatch: '/drivers/' },
      { text: 'Middleware', link: '/middleware/', activeMatch: '/middleware/' },
      { text: 'Advanced', link: '/advanced/decorators', activeMatch: '/advanced/' },
      { text: 'API', link: '/api/storage-client', activeMatch: '/api/' },
      {
        text: 'GitHub',
        link: 'https://github.com/ramirohococo/blobpipe',
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/guide/getting-started' },
            { text: 'Concepts', link: '/guide/concepts' },
            { text: 'TypeScript', link: '/guide/typescript' },
            { text: 'Error Handling', link: '/guide/error-handling' },
            { text: 'Cancellation', link: '/guide/cancellation' },
          ],
        },
      ],
      '/drivers/': [
        {
          text: 'Drivers',
          items: [
            { text: 'Overview', link: '/drivers/' },
            { text: 'S3', link: '/drivers/s3' },
            { text: 'Google Cloud Storage', link: '/drivers/gcs' },
            { text: 'Azure Blob Storage', link: '/drivers/azure-blob' },
            { text: 'Local', link: '/drivers/local' },
            { text: 'Memory', link: '/drivers/memory' },
          ],
        },
      ],
      '/middleware/': [
        {
          text: 'Middleware',
          items: [
            { text: 'How Middleware Works', link: '/middleware/' },
            { text: 'Built-in Middleware', link: '/middleware/built-in' },
            { text: 'Custom Middleware', link: '/middleware/custom' },
          ],
        },
      ],
      '/advanced/': [
        {
          text: 'Advanced',
          items: [
            { text: 'Decorators', link: '/advanced/decorators' },
            { text: 'Testing', link: '/advanced/testing' },
            { text: 'Custom Drivers', link: '/advanced/custom-drivers' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'StorageClient', link: '/api/storage-client' },
            { text: 'Errors', link: '/api/errors' },
          ],
        },
      ],
    },

    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/ramirohococo/blobpipe' },
    ],

    footer: {
      message: 'Released under the MIT License.',
    },
  },
})
