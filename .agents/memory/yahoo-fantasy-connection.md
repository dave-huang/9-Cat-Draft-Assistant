---
name: Yahoo Fantasy connection
description: Avoid the misleading default domain in Yahoo connector setup for fantasy league access.
---

For Fantasy Sports access, enter `fantasysports.yahooapis.com` as the Yahoo connector's API Domain, with no scheme or trailing slash. The `api.login.yahoo.com` example shown in the connection form is for account identity, not fantasy leagues.

The correct API Domain does not establish that Fantasy permissions were granted. Connector documentation lists `openid` as the default, while Fantasy reads require `fspt-r`. Do not diagnose a generic “Unauthorized” as a missing scope without knowing where it occurred. An error inside Replit's API Domain setup before Yahoo sign-in is not evidence of a rejected Yahoo password or a missing grant on an already-authorized connection. A subsequent OAuth pop-up failure can be secondary to the setup error; it does not by itself prove a browser pop-up blocker caused the failure.

**Why:** Correct-host setup continued to fail before Yahoo sign-in, and a subsequent pop-up failure message still did not establish the root cause. Distinguishing the stages prevents unsupported password, scope, or browser diagnoses.

**How to apply:** When helping configure Yahoo, use the Fantasy Sports host and ensure the read grant includes `fspt-r`. Re-read current integration notes before changing setup. Guide the setup, Yahoo sign-in, consent, and return-to-Replit stages distinctly. For a pre-sign-in setup failure, distinguish session or workspace permission issues from connector configuration problems; do not keep reopening the identical failed flow or promise a scope change will fix it. After authorization, verify an authenticated NBA-league read. League/draft endpoints being exposed does not establish that picks update during live drafts; test freshness before promising automatic sync.