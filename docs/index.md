---
layout: home

hero:
  name: blobpipe
  text: Stop rewriting your upload code.
  tagline: One API for S3, GCS, Azure, local disk, and in-memory. Switch clouds without touching your features.
  actions:
    - theme: brand
      text: Get Started →
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/balance3840/blobpipe

features:
  - icon: 🔄
    title: Change clouds, not code
    details: Start on S3. Move to R2 next quarter. Swap one line — your features, tests, and error handling stay exactly the same.

  - icon: 🧱
    title: Upload rules that stack
    details: Validate file types, enforce size limits, detect MIME types, log every upload. Each rule is independent. Chain them in any order.

  - icon: 🧪
    title: Tests that don't need the cloud
    details: Drop in MemoryDriver and your tests run instantly — no Docker, no credentials, no network. Your test suite never knows the difference.

  - icon: 🎯
    title: One error type, any cloud
    details: ObjectNotFoundError is the same on S3, GCS, and Azure. Write your error handling once. It works everywhere, forever.

  - icon: ⚡
    title: Cancels when your user does
    details: Every operation accepts a signal. Pass req.signal and uploads stop the moment a client disconnects — no orphaned requests, no wasted bandwidth.

  - icon: 📦
    title: No excess baggage
    details: Using GCS? The AWS SDK never touches your project. Each driver is a separate install — keep your dependencies lean.
---
