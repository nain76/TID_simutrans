/**
 * Train Position Tracker AI for Simutrans OTRP
 *
 * This AI script tracks train positions and exports them to JSON
 * for web-based visualization.
 *
 * Usage:
 * 1. Start or load a game
 * 2. Add a new AI player
 * 3. Select "train_tracker" as the AI script
 * 4. The AI will automatically export train data every in-game day
 *
 * Author: Claude Code
 * Version: 1.1
 */

// Include utility scripts
include("waytype_translator")
include("json_writer")

/**
 * Generator function to yield items one by one
 * This prevents timeout by giving control back to game engine
 * @param iteratable Array or list to iterate
 */
function _step_generator(iteratable) {
    foreach (obj in iteratable) {
        yield obj
    }
}

/**
 * Debug logging function
 * Writes debug messages to a log file
 */
function debug_log(message) {
    try {
        local f = file("train_tracker_debug.log", "a")
        if (f) {
            local game_time = world.get_time()
            f.writestr("[" + game_time.year + "-" + (game_time.month + 1) + "-" + get_current_day() + "] " + message + "\n")
            f.close()
        }
    } catch (e) {
        // Ignore logging errors
    }
}

// Configuration
config <- {
    // Output file path (relative to simutrans directory)
    output_file = "train_positions.json",
    station_file = "station_data.json",
    // Ticks per month (default Simutrans setting)
    ticks_per_month = 1048576,
    // Days per month (Simutrans default)
    days_per_month = 30
}

// Persistent data (survives save/load)
persistent <- {
    last_export_day = -1,  // Track last export day (-1 means never exported)
    export_count = 0,
    ai_player = null  // Store AI player reference
}

/**
 * Calculate current day number (total days since game start)
 * @return Total days elapsed in game
 */
function get_total_days() {
    local game_time = world.get_time()

    // Calculate total days from years and months
    local total_days = game_time.year * 12 * config.days_per_month
    total_days += game_time.month * config.days_per_month

    // Add days within current month based on ticks
    local ticks_per_day = config.ticks_per_month / config.days_per_month
    local current_day_in_month = game_time.ticks / ticks_per_day
    total_days += current_day_in_month

    return total_days
}

/**
 * Get current day within month (1-30)
 * @return Current day of month
 */
function get_current_day() {
    local game_time = world.get_time()
    local ticks_per_day = config.ticks_per_month / config.days_per_month
    local day = (game_time.ticks / ticks_per_day) + 1
    if (day > config.days_per_month) day = config.days_per_month
    return day
}

/**
 * AI initialization
 * Called when AI is first started
 * @param pl_nr Player number (integer)
 */
function start(pl_nr) {
    // Convert player number to player object
    persistent.ai_player = player_x(pl_nr)
    debug_log("AI started")
}

/**
 * Resume from saved game
 * @param pl_nr Player number (integer)
 */
function resume_game(pl_nr) {
    // Convert player number to player object
    persistent.ai_player = player_x(pl_nr)
    debug_log("AI resumed from save")
}

/**
 * Called regularly by Simutrans AI framework
 * This is the main entry point that enables periodic updates
 */
function step() {
    // Iterate through work() generator to execute it
    // The foreach loop resumes the generator and handles yields
    foreach (dummy in work()) {}
}

/**
 * Main work function - called periodically by step()
 * Exports data every in-game day
 * Generator function to handle yields properly
 */
function work() {
    local current_day = get_total_days()

    // Check if a day has passed since last export
    if (current_day > persistent.last_export_day) {
        debug_log("New day detected (day=" + current_day + "), starting export")

        // Execute export_train_data generator
        foreach (dummy in export_train_data()) {}

        yield null  // YIELD POINT: Between exports

        // Execute export_station_data generator
        foreach (dummy in export_station_data()) {}

        persistent.last_export_day = current_day
        debug_log("Export complete (count=" + persistent.export_count + ")")
    }

    yield null  // Always yield to prevent blocking
}

/**
 * Main export function - collects train data and writes JSON
 */
function export_train_data() {
    try {
        debug_log("export_train_data: starting")
        local trains = []
        local convoy_list = world.get_convoy_list()

        // Convert convoy_list to array for generator
        local convoy_array = []
        for (local i = 0; i < convoy_list.get_count(); i++) {
            convoy_array.append({idx = i, convoy = convoy_list[i]})
        }

        // Iterate through all convoys with yield for timeout prevention
        foreach (item in _step_generator(convoy_array)) {
            local convoy = item.convoy
            local i = item.idx

            if (!convoy.is_valid()) continue

            // Get waytype
            local wt = convoy.get_waytype()

            // Filter: only track rail and tram
            if (!should_track_waytype(wt)) continue

            // Build train data
            local train_data = {
                id = i,
                name = convoy.get_name(),
                waytype = get_waytype_en(wt),
                waytype_ja = get_waytype_ja(wt),
                speed_kmh = convoy.get_speed(),
                is_loading = convoy.is_loading()
            }

            // Get position
            local pos = convoy.get_pos()
            train_data.position <- {
                x = pos.x,
                y = pos.y,
                z = pos.z
            }

            // Get line information
            local line = convoy.get_line()
            if (line && line.is_valid()) {
                train_data.line <- line.get_name()
            } else {
                train_data.line <- "無所属"
            }

            // Skip schedule information to avoid timeout
            train_data.current_halt <- null
            train_data.next_halt <- null

            trains.append(train_data)
        }

        yield null  // YIELD POINT: After convoy processing

        debug_log("export_train_data: collected " + trains.len() + " trains")

        // Build JSON
        local game_time = world.get_time()
        local json_string = build_train_json(trains, game_time)

        debug_log("export_train_data: JSON built, size=" + json_string.len())

        yield null  // YIELD POINT: After JSON building

        // Write to file
        write_json_file(json_string)
        debug_log("export_train_data: file written")

        yield null  // YIELD POINT: After file writing

        persistent.export_count++

    } catch (e) {
        debug_log("export_train_data: ERROR - " + e)
    }
}

/**
 * Export station data for all rail/tram lines
 * Extracts lines from all convoys in the world (all players)
 */
function export_station_data() {
    try {
        local lines_data = []
        local unique_lines = {}  // Track unique lines by name to avoid duplicates

        // Get convoy list (same approach as export_train_data)
        local convoy_list = world.get_convoy_list()
        debug_log("export_station_data: found " + convoy_list.get_count() + " convoys")

        // Convert convoy_list to array for generator
        local convoy_array = []
        for (local i = 0; i < convoy_list.get_count(); i++) {
            convoy_array.append(convoy_list[i])
        }

        // First pass: collect unique lines from convoys
        foreach (convoy in _step_generator(convoy_array)) {
            if (!convoy.is_valid()) continue

            // Get waytype and filter
            local wt = convoy.get_waytype()
            if (!should_track_waytype(wt)) continue

            // Get line from convoy
            local line = convoy.get_line()
            if (!line || !line.is_valid()) continue

            // Track unique lines by name
            local line_name = line.get_name()
            if (!(line_name in unique_lines)) {
                unique_lines[line_name] <- {
                    line = line,
                    waytype = wt
                }
            }
        }

        debug_log("export_station_data: found " + unique_lines.len() + " unique lines from convoys")

        yield null  // YIELD POINT: After collecting unique lines

        // Convert unique_lines table to array for generator
        local lines_array = []
        foreach (line_name, line_info in unique_lines) {
            lines_array.append({
                name = line_name,
                line = line_info.line,
                waytype = line_info.waytype
            })
        }

        // Second pass: process each unique line to extract stations with yield
        local processed = 0
        foreach (line_obj in _step_generator(lines_array)) {
            local line_name = line_obj.name
            local line = line_obj.line
            local wt = line_obj.waytype

            // Get line schedule
            local schedule = line.get_schedule()
            if (!schedule) continue

            local stations = []

            // Extract stations from schedule entries with yield
            foreach (entry in _step_generator(schedule.entries)) {
                // Get halt from tile at entry coordinates (all players)
                local halt = tile_x(entry.x, entry.y, entry.z).get_halt()

                if (halt && halt.is_valid()) {
                    local station_data = {
                        name = halt.get_name(),
                        x = entry.x,
                        y = entry.y,
                        z = entry.z
                    }
                    stations.append(station_data)
                }
            }

            // Only add line if it has stations
            if (stations.len() > 0) {
                local line_data = {
                    name = line_name,
                    waytype = get_waytype_en(wt),
                    waytype_ja = get_waytype_ja(wt),
                    stations = stations
                }
                lines_data.append(line_data)
                processed++
            }
        }

        debug_log("export_station_data: processed=" + processed + " total_lines=" + lines_data.len())

        yield null  // YIELD POINT: After line processing

        // Build JSON and write to file
        local json_string = build_station_json(lines_data)
        debug_log("export_station_data: JSON built, size=" + json_string.len())

        yield null  // YIELD POINT: After JSON building

        write_station_file(json_string)
        debug_log("export_station_data: file written")

        yield null  // YIELD POINT: After file writing

    } catch (e) {
        debug_log("Error in export_station_data: " + e)
    }
}

/**
 * Write JSON string to file
 * @param json_string JSON string to write
 */
function write_json_file(json_string) {
    local f = file(config.output_file, "w")
    if (f) {
        f.writestr(json_string)
        f.close()
    }
}

/**
 * Write station JSON string to file
 * @param json_string JSON string to write
 */
function write_station_file(json_string) {
    local f = file(config.station_file, "w")
    if (f) {
        f.writestr(json_string)
        f.close()
    }
}

/**
 * Save persistent data
 * Called when game is saved
 */
function save() {
    return "persistent <- { " +
           "last_export_day = " + persistent.last_export_day + ", " +
           "export_count = " + persistent.export_count + ", " +
           "ai_player = null }"
}
