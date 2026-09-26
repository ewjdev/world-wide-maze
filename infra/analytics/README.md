# Saved analytics reports

Use the PostHog project from `docs/launch/analytics.md`. Reports use `environment = 'production'` by default; change only that literal to `development` for provider validation. `visit` is the counting unit for website sessions; `attempt` is the counting unit for stage play. Identity-dependent retention must filter `identity='browser'`.

SQL files are HogQL for PostHog SQL insights. The [manifest](manifest.md) records saved report links, executed-query results and interpretation limits. `qa.sql` is the intentionally separate development receipt report.
