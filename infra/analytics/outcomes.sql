SELECT properties.run AS run,
    uniqIf(properties.attempt, event = 'played') AS attempts_started,
    uniqIf(properties.attempt, event = 'finished') AS attempts_finished,
    uniqIf(properties.attempt, event = 'ended' AND properties.reason = 'gameover') AS attempts_game_over,
    uniqIf(properties.attempt, event = 'ended' AND properties.reason = 'timeup') AS attempts_timed_out
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
  AND properties.environment = 'production'
  AND event IN ('played', 'finished', 'ended')
GROUP BY run
