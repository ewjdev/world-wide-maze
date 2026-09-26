SELECT event, properties.surface AS surface,
    count() AS received_events,
    uniq(properties.visit) AS visits,
    max(timestamp) AS last_received
FROM events
WHERE properties.environment = 'development'
  AND properties.release = 'analytics-qa-20260926'
GROUP BY event, surface
ORDER BY received_events DESC
