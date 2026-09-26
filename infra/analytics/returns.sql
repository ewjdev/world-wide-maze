SELECT distinct_id AS browser,
    uniq(properties.visit) AS visits,
    count(DISTINCT toDate(timestamp)) AS active_days,
    min(timestamp) AS first_observed,
    max(timestamp) AS last_observed
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
  AND properties.environment = 'production'
  AND properties.identity = 'browser'
  AND properties.surface = 'host'
GROUP BY browser
ORDER BY active_days DESC
