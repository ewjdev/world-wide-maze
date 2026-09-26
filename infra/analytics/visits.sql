SELECT
    properties.environment AS environment,
    properties.surface AS surface,
    properties.source AS source,
    properties.device AS device,
    uniq(properties.visit) AS visits,
    countIf(event = 'played') AS play_starts,
    countIf(event = 'finished') AS finishes
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
  AND properties.environment = 'production'
GROUP BY environment, surface, source, device
ORDER BY visits DESC
