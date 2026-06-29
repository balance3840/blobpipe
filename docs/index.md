---
layout: home

hero:
  name: blobpipe
  text: Provider-agnostic file storage for Node.js
  tagline: One interface. S3, GCS, Azure, local disk, or in-memory. Swap providers without touching application code.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/balance3840/blobpipe

features:
  - icon: 🔌
    title: Provider-agnostic
    details: S3, Google Cloud Storage, Azure Blob Storage, local disk, and in-memory — all behind a single interface. Switch providers by changing one line.

  - icon: 🔒
    title: Type-safe
    details: Full TypeScript types with no SDK leakage. Your application code never imports AWS, Azure, or GCS SDK types.

  - icon: 🔗
    title: Middleware pipeline
    details: Compose validation, size limits, MIME sniffing, logging, and custom transforms as an ordered chain that runs on every upload.

  - icon: 🚨
    title: Normalized errors
    details: ObjectNotFoundError, AccessDeniedError, and friends — provider-specific error codes translated into a consistent hierarchy your catch blocks can handle once.

  - icon: ⏹️
    title: AbortSignal support
    details: Pass an AbortSignal to any operation. Plug straight into request lifecycle in Express, Fastify, or Next.js to cancel in-flight uploads when the client disconnects.

  - icon: 🌲
    title: Tree-shakeable
    details: Each driver ships as its own package. Install only what you need — no AWS SDK in a GCS-only project.
---
