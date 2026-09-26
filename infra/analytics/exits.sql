SELECT last_phase, count() AS visits
FROM (
    SELECT properties.visit AS visit,
        argMaxIf(properties.phase, timestamp, event = 'game_phase') AS last_phase,
        max(timestamp) AS last_seen
    FROM events
    WHERE timestamp > now() - INTERVAL 30 DAY
      AND properties.environment = 'production'
      AND properties.surface = 'host'
    GROUP BY visit
    HAVING last_seen < now() - INTERVAL 30 MINUTE
)
WHERE last_phase != ''
GROUP BY last_phase
ORDER BY visits DESC
