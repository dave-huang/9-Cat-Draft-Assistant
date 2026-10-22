---
name: Trade outlook
description: User intent and temporal scope for reasonable fantasy trade recommendations.
---

The user requires trades that improve their team overall and are “reasonable trades that another team manager would actually seriously consider.” Improving only the user's side is not sufficient.

**Why:** The user explicitly emphasized the other manager's willingness to consider an offer. Existing no-punt intent still applies to their team.

**How to apply:** Keep a bilateral benefit requirement and an independent fairness check; do not manufacture offers simply to avoid an empty result. Explain costs as well as gains, without acceptance guarantees.

Trade outlook uses season forecasts independently of Weekly's chosen actual-average basis.

**Why:** This request concerns overall team quality, whereas Weekly is a specific matchup forecast. One or two actual games are not sufficient evidence to reprice stars as long-term trade assets. This is an intentional modeling decision, not a user request to change their saved Weekly choice.

**How to apply:** Do not silently wire the Weekly toggle into trade valuation. Any later actuals-based trade model needs an explicit sample/reliability policy. Allow a team to give up an above-average category surplus while retaining that strength; a flat loss cap can otherwise reject legitimate balanced trades.
