---
name: Date-only API contracts
description: Orval Zod date coercion changes date-only response values into full ISO timestamps.
---

Represent calendar dates as validated YYYY-MM-DD strings with a string pattern when using this workspace's generated Zod response schemas; do not rely on OpenAPI `format: date` alone.

**Why:** Orval generates coercing Date schemas for date formats. Parsing a date-only response converted its strings into Date objects, which JSON serialized as full ISO timestamps. Type checks passed, but date-window equality and date-only UI handling no longer matched the API contract.

**How to apply:** Validate actual calendar dates and range limits at the server boundary, preserve date-only strings through response parsing, and test the serialized response shape. Date-time retrieval timestamps can still use ISO date-time formats. Use Eastern game dates for NBA schedule days rather than assuming the UTC date is the game date.
