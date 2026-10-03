---
name: Yahoo Fantasy connection
description: Avoid the misleading default domain in Yahoo connector setup for fantasy league access.
---

For Fantasy Sports access, enter `fantasysports.yahooapis.com` as the Yahoo connector's API Domain, with no scheme or trailing slash. The `api.login.yahoo.com` example shown in the connection form is for account identity, not fantasy leagues.

The correct API Domain does not establish that Fantasy permissions were granted. Connector documentation lists `openid` as the default, while Fantasy reads require `fspt-r`. Do not diagnose a generic “Unauthorized” as a missing scope without knowing where it occurred.

**Why:** The user remained stuck at authorization despite using the correct Fantasy host. The host alone is not a verified fix, and the failing stage was not established.

**How to apply:** When helping configure Yahoo, use the Fantasy Sports host and ensure the read grant includes `fspt-r`. Re-read current integration notes before changing setup. Guide the setup, Yahoo sign-in, consent, and return-to-Replit stages distinctly; after authorization, verify an authenticated NBA-league read. League/draft endpoints being exposed does not establish that picks update during live drafts; test freshness before promising automatic sync.