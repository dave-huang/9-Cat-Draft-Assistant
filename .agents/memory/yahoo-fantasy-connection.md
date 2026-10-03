---
name: Yahoo Fantasy connection
description: Avoid the misleading default domain in Yahoo connector setup for fantasy league access.
---

For Fantasy Sports access, enter `fantasysports.yahooapis.com` as the Yahoo connector's API Domain, with no scheme or trailing slash. The `api.login.yahoo.com` example shown in the connection form is for account identity, not fantasy leagues.

**Why:** The user was blocked by the unlabeled API-domain setup choice; the connector's notes distinguish the identity and Fantasy Sports hosts.

**How to apply:** When helping configure Yahoo, use the Fantasy Sports host and ensure the read grant includes `fspt-r`. Re-read current integration notes before changing setup. League/draft endpoints being exposed does not establish that picks update during live drafts; test freshness before promising automatic sync.