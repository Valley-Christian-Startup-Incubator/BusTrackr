# Valley Shuttle

Camera observations and estimates for the Fehren–Skyway shuttle.

## Language

**Camera event**: One timestamped observation that a bus entered the configured camera zone. It does not establish vehicle identity or travel direction.

**Arrival**: A physical bus visit to the checkpoint, potentially producing several camera events.

**Learned run**: A recurring checkpoint pass found in sighting history, with a time of day, spread and per-weekday likelihood. Seen on at least two days.

**Estimate**: A prediction anchored to a learned run or camera event, distinct from an observed position.

**Service date**: The local calendar date in America/Los_Angeles on which a learned run is expected.
