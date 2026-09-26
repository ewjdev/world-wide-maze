SELECT
    properties.visit AS visit,
    max(properties.identity) AS identity,
    sum(toFloat(properties.active_ms)) / 1000 AS active_seconds,
    sum(toFloat(properties.play_ms)) / 1000 AS play_seconds,
    max(timestamp) AS last_seen
FROM events
WHERE event = 'engagement'
  AND timestamp > now() - INTERVAL 30 DAY
  AND properties.environment = 'production'
  AND properties.surface = 'host'
GROUP BY visit
ORDER BY play_seconds DESC
