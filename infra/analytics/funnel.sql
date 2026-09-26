SELECT
    countIf(viewed > toDateTime(0)) AS visits,
    countIf(viewed > toDateTime(0) AND loaded >= viewed) AS reached_loaded,
    countIf(viewed > toDateTime(0) AND loaded >= viewed AND played >= loaded) AS reached_play,
    countIf(viewed > toDateTime(0) AND loaded >= viewed AND played >= loaded AND finished >= played) AS reached_finish
FROM (
    SELECT properties.visit AS visit,
        minIf(timestamp, event = '$pageview') AS viewed,
        minIf(timestamp, event = 'stage_loaded') AS loaded,
        minIf(timestamp, event = 'played') AS played,
        minIf(timestamp, event = 'finished') AS finished
    FROM events
    WHERE timestamp > now() - INTERVAL 30 DAY
      AND properties.environment = 'production'
      AND properties.surface = 'host'
    GROUP BY visit
)
