# 2026–27 projection source audit

Research date: October 2, 2026 (America/New_York).
Intended NBA season: 2026–27, confirmed by the user.
Status: a complete, authorized export is still needed. No current-season projection CSV has been created or loaded. The app's illustrative demo data and all-nine-category no-punt scoring remain unchanged.

## Sources examined

| Source | Forecast date / season | Public coverage | Required-field limitations |
| --- | --- | --- | --- |
| [Hashtag Basketball projections](https://hashtagbasketball.com/fantasy-basketball-projections) | Page says updated October 2, 2026; 2026–27 rest-of-season forecasts | Top 30 only; full pool requires membership | Public rows include projected GP, per-game counting stats, FG/FT makes and attempts in parentheses, positions and ADP. A Yahoo selector exists, but the selected platform must be confirmed in an authorized export. Rounded display values can produce small inconsistencies. |
| [FanScout projections](https://fanscout.pro/projections) | 2026–27; no forecast date visible in the extracted public table | Top 20 only; full access requires upgrade | Public table includes GP, counting stats, percentages and attempts, but not FGM/FTM. Do not reconstruct missing makes from rounded percentages. Yahoo-specific eligibility and ADP are not established. |
| [FantasyPros season projections](https://www.fantasypros.com/nba/projections/overall.php) | Consensus last updated September 19, 2026; page labels season as “2026” | Large public table | Displayed totals, GP and shooting percentages are insufficient: FGM/FGA/FTM/FTA are absent. Do not infer volumes, borrow historical volumes, or assume generic positions are Yahoo eligibility. |
| [Basketball Monster](https://basketballmonster.com/membership.aspx) | Membership page explicitly says 2026–27; individual forecast date unavailable without the dataset | Full-season forecasts are a membership feature; listed price US$69.95 | Its public 2026–27 forum confirms Projections-page Excel/CSV export controls. Exact required columns, Yahoo fields and permission to use the export in this app must still be confirmed before purchase; no member data accessed. |
| [RotoWire projections](https://www.rotowire.com/basketball/projections.php) | Page title says 2026–27 | Table was not available in the extracted page | Could not establish required fields or a usable export. Search snippets are not sufficient to certify a dataset. |
| [ESPN projections](https://fantasy.espn.com/basketball/players/projections) | Search results say 2026–27 | Fetch returned support/navigation rather than projection rows | No complete dataset verified. Do not substitute ESPN eligibility for Yahoo eligibility. |

The [Hashtag homepage](https://hashtagbasketball.com/) also explicitly labels the free projection tool “Top 30.” Its [premium information](https://hashtagbasketball.com/premium/) advertises full projections. The older [user guide](https://hashtagbasketball.com/user-guide) describing “free projections” does not establish unrestricted current access. A public “All” filter is not evidence that all rows are available for free.

No protected endpoint, membership session, or paywall bypass was used. No provider export capability or redistribution permission is assumed.

## Recommended export source

**Basketball Monster is the strongest export-workflow candidate**, subject to confirming the required columns and personal-use permission before purchase. Its [2026–27 season-opening forum](https://basketballmonster.com/MessageTopic.aspx?topic=24603) contains August 15–17 discussion of per-game statistics exported from Projections, Excel and CSV export controls, and administrator replies. This verifies an export feature, not a complete sample of its current column schema. One member reported that the CSV button produced an XLS file; preserve the downloaded file and inspect its actual format rather than renaming it.

**Hashtag Basketball is the budget alternative**, advertising US$2.50/month membership on its [premium page](https://hashtagbasketball.com/premium/). The required raw shooting volumes are visible in the free preview, but a permitted full-data export feature was not verified. Do not buy it specifically for this app until that is confirmed.

Ask the provider before buying: “Does your 2026–27 full-season export include projected GP, PTS, total REB, AST, STL, BLK, made threes, TO, FGM, FGA, FTM and FTA for the complete player pool, with Yahoo positions and Yahoo ADP if available? May I use that downloaded file in my private draft assistant? What is the forecast update date?”

We need the raw forecast stats, not the provider's ranking, fantasy points or DURANT values. Its preferred punt strategy does not change this app's all-nine-category no-punt scoring.

## Obtaining a usable file

1. If you already subscribe to a provider, use its permitted personal export. Do not share account passwords, cookies, or tokens.
2. Before purchasing, confirm the provider permits exporting the full 2026–27 player pool for personal use and includes **projected GP, FGM, FGA, FTM and FTA**, plus the seven counting categories. Membership access alone does not prove export availability.
3. Select preseason/full-season forecasts, per-game averages, and Yahoo positions/ADP if offered. Avoid historical “rankings,” daily/weekly forecasts and blends of forecasts with actual results.
4. Export the complete draftable pool rather than a top-30/top-50 preview. The default 12-team, 13-slot league needs at least 156 draftable players and additional alternatives.
5. Keep the source name, forecast date, season, selected platform, units and forecast horizon alongside the file. Upload the CSV/XLSX or another provider-permitted export for conversion. If export is unavailable, ask the provider for a permitted file rather than scraping member-only data.

## Exact app CSV contract

```csv
name,team,positions,games,points,rebounds,assists,steals,blocks,threes,turnovers,fgm,fga,ftm,fta,adp,note
```

- Required: all columns except `adp` and `note`. No required value may be blank.
- `games`: projected season games, 1–82; never last season's games played or an invented 82.
- Counting stats and shooting makes/attempts: projected per-game averages, not totals. Explicit forecast totals may be divided by the source's projected GP with the conversion documented; this does not supply an absent forecast stat.
- `threes`: made three-pointers; `rebounds`: total rebounds; `turnovers`: turnovers.
- `positions`: one or more of `PG`, `SG`, `SF`, `PF`, `C`, e.g. `PG/SG`. Verify Yahoo eligibility; do not expand `G` or `F` into assumed positions.
- `adp`: optional positive Yahoo ADP; leave blank if absent. Rank, auction value and blended-platform ADP are not Yahoo ADP.
- `note`: source, season, forecast date, eligibility/ADP source and dated availability caveats; at most 1,000 characters. The app's source label and season are also entered during import.
- Do not infer FGM/FTM from rounded percentages, derive missing attempts, silently fill missing values with zero, or mix historical actuals into forecasts.
- The actual parser in `src/lib/projections.ts` must validate the converted CSV: unique names, legal positions, finite/nonnegative stats, games bounds, and makes not exceeding attempts.
- Structural validation does not verify forecast accuracy, licensing, season, eligibility, or coverage.

## Dated availability review

This is a preliminary check, not a full-player injury review: no full dataset has been supplied yet.

**Tyrese Haliburton:** [ESPN, September 28, 2026](https://www.espn.com/nba/story/_/id/50053467/tyrese-haliburton-no-restrictions-return-achilles-tear) reports that he says he is healthy and expects no restrictions after his Achilles recovery. Rick Carlisle is more cautious: decisions will be made with the training staff at the correct pace. Hashtag's public forecast lists 60 GP. Clearance does not establish a specific GP forecast, so retain provider GP and flag the uncertainty; do not revise GP from this article.

After receiving the full export, review players with low projected games, known injuries, return-from-surgery assumptions and notable source disagreements against dated team announcements, NBA.com, AP/ESPN or comparable reliable reporting. Preserve source GP unless an explicit revised forecast is supplied; distinguish medical news from statistical projections. Recheck close to draft time because preseason news changes.

## Import safely

When conversion is complete, validate using the app's existing parser and deliver the final CSV with a provenance/limitations companion. In the app, open League Settings, enter the source (with forecast date) and `2026–27`, then import the validated file. Replacing projections after picks requires an explicit reset; export a JSON draft backup first. Import replaces the player pool, not just rows with matching names. Do not import a partial preview for a real draft.