SELECT event AS milestone,
    uniq(properties.visit) AS visits,
    uniqIf(properties.attempt, properties.attempt IS NOT NULL) AS attempts,
    count() AS events,
    round(avgIf(toFloat(properties.duration_ms), event = 'stage_loaded') / 1000, 2) AS load_seconds
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
  AND properties.environment = 'production'
  AND properties.surface = 'host'
  AND event IN ('$pageview', 'start_clicked', 'pairing_started', 'paired', 'pairing_failed', 'build_started', 'stage_loaded', 'build_failed', 'build_cancelled', 'played', 'finished', 'ended', 'stage_restarted', 'controller_disconnected', 'client_error')
GROUP BY milestone
ORDER BY visits DESC
