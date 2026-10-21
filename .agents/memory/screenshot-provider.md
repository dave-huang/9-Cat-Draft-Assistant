---
name: Screenshot recognition provider choice
description: The user's explicit provider and credential preference for lineup screenshots.
---

Use Gemini with the user's own API key for lineup screenshot recognition, not OpenAI or automatically provisioned AI billing.

**Why:** The user explicitly said, “I want to use Gemini for this and my own API key.”

**How to apply:** Preserve this provider/credential choice when improving screenshot recognition. Do not switch to another provider or managed billing without asking.

Treat direct-key Gemini access separately from the managed integration's model catalog; a listed model is not proof the user's key can use it. Keep provider verification separate from UI verification.

**Why:** The screenshot review and lineup-save flow passed with supplied recognition results while direct provider requests remained unavailable or timed out.

**How to apply:** Verify a real image response before declaring recognition ready after provider/model changes. A mocked browser pass only verifies the import workflow, not live recognition.
