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
 * 4. The AI will automatically export train data every ~30 seconds
 *
 * Author: Claude Code
 * Version: 1.0
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
        local f = file("station_export_debug.log", "a")
        if (f) {
            local game_time = world.get_time()
            f.writestr("[" + game_time.year + "-" + (game_time.month + 1) + "] " + message + "\n")
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
    station_file = "station_data.json"
}

// Persistent data (survives save/load)
persistent <- {
    last_export_ticks = 0,
    export_count = 0,
    ai_player = null,  // Store AI player reference
    initial_export_done = false,  // Track if initial export completed
    last_export_hours = 0  // Track last export time in game hours
}

/**
 * AI initialization
 * Called when AI is first started
 * @param pl_nr Player number (integer)
 */
function start(pl_nr) {
    // Convert player number to player object
    persistent.ai_player = player_x(pl_nr)
    // Export will happen at next month
}

/**
 * Resume from saved game
 * @param pl_nr Player number (integer)
 */
function resume_game(pl_nr) {
    // Convert player number to player object
    persistent.ai_player = player_x(pl_nr)
    // No output to save time - export will happen at next month
}

/**
 * Called every game month
 * Exports both train and station data every month
 * Uses yield to prevent timeout with large datasets
 */
function new_month() {
    // Export both files every month
    // Yield mechanism prevents timeout issues
    foreach (dummy in export_train_data()) {}
    yield null
    foreach (dummy in export_station_data()) {}
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
 * Called periodically by step() function
 * Exports data every 12 game hours
 * Generator function to handle yields properly
 */
function work() {
    local game_time = world.get_time()

    // Calculate total game hours
    // Approximation: 18.2 hours per month (default game speed)
    local hours_per_month = 18
    local total_hours = (game_time.year * 12 + game_time.month) * hours_per_month

    // Add hours within current month based on ticks
    // Assuming ~1048576 ticks per month, ~57755 ticks per hour
    if (game_time.ticks > 0) {
        local hours_in_month = game_time.ticks / 57755
        total_hours += hours_in_month
    }

    // Export every 24 game hours (1 game day)
    if (total_hours - persistent.last_export_hours >= 24) {
        debug_log("24 hours passed, exporting (total_hours=" + total_hours + ")")

        // Execute export_train_data generator
        foreach (dummy in export_train_data()) {}

        yield null  // YIELD POINT: Between exports

        // Execute export_station_data generator
        foreach (dummy in export_station_data()) {}

        persistent.last_export_hours = total_hours
    }
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

            // Get owner information
            local owner = convoy.get_owner()
            local owner_name = "Unknown"
            if (owner && owner.is_valid()) {
                owner_name = owner.get_name()
            }

            // Build train data
            local train_data = {
                id = i,
                name = convoy.get_name(),
                owner = owner_name,
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

        yield null  // YIELD POINT 1: After convoy processing

        debug_log("export_train_data: collected " + trains.len() + " trains")

        // Build JSON incrementally with batching
        local batch_size = 50
        local game_time = world.get_time()

        // Build header
        local json = "{\"timestamp\":\"" + format_timestamp() + "\","
        json += "\"game_time\":{\"year\":" + game_time.year
        json += ",\"month\":" + game_time.month
        json += ",\"ticks\":" + game_time.ticks + "},"
        json += "\"trains\":["

        debug_log("export_train_data: building JSON for " + trains.len() + " trains")

        // Process trains in batches
        for (local i = 0; i < trains.len(); i++) {
            if (i > 0) json += ","
            json += to_json(trains[i])  // Single train is OK

            // Yield every 50 trains
            if ((i + 1) % batch_size == 0) {
                debug_log("export_train_data: processed " + (i + 1) + "/" + trains.len())
                yield null
            }
        }

        // Build footer
        json += "]}"

        debug_log("export_train_data: JSON complete, size=" + json.len())
        yield null  // YIELD POINT: After JSON building

        // Write to file
        debug_log("export_train_data: starting file write")
        write_json_file(json)
        debug_log("export_train_data: file write complete")

        yield null  // YIELD POINT 3: After file writing

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
                // Get line owner
                local owner = line.get_owner()
                local owner_name = "Unknown"
                if (owner && owner.is_valid()) {
                    owner_name = owner.get_name()
                }

                unique_lines[line_name] <- {
                    line = line,
                    waytype = wt,
                    owner = owner_name
                }
            }
        }

        debug_log("export_station_data: found " + unique_lines.len() + " unique lines from convoys")

        // Convert unique_lines table to array for generator
        local lines_array = []
        foreach (line_name, line_info in unique_lines) {
            lines_array.append({
                name = line_name,
                line = line_info.line,
                waytype = line_info.waytype,
                owner = line_info.owner
            })
        }

        // Second pass: process each unique line to extract stations with yield after each line
        local processed = 0
        foreach (line_obj in lines_array) {
            local line_name = line_obj.name
            local line = line_obj.line
            local wt = line_obj.waytype
            local owner_name = line_obj.owner

            // Get line schedule
            local schedule = line.get_schedule()
            if (!schedule) {
                yield null  // YIELD POINT: Even if no schedule, yield to prevent timeout
                continue
            }

            local stations = []

            // Extract stations from schedule entries
            foreach (entry in schedule.entries) {
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
                    owner = owner_name,
                    waytype = get_waytype_en(wt),
                    waytype_ja = get_waytype_ja(wt),
                    stations = stations
                }
                lines_data.append(line_data)
                processed++
            }

            yield null  // YIELD POINT: After processing each line
        }

        yield null  // YIELD POINT 1: After line processing

        debug_log("export_station_data: processed=" + processed + " total_lines=" + lines_data.len())

        // Build JSON incrementally with batching
        local batch_size = 20
        local game_time = world.get_time()

        // Build header
        local json = "{\"timestamp\":\"" + format_timestamp() + "\","
        json += "\"game_time\":{\"year\":" + game_time.year
        json += ",\"month\":" + game_time.month
        json += ",\"ticks\":" + game_time.ticks + "},"
        json += "\"lines\":["

        debug_log("export_station_data: building JSON for " + lines_data.len() + " lines")

        // Process lines in batches
        for (local i = 0; i < lines_data.len(); i++) {
            if (i > 0) json += ","
            json += to_json(lines_data[i])  // Single line is OK

            // Yield every 20 lines
            if ((i + 1) % batch_size == 0) {
                debug_log("export_station_data: processed " + (i + 1) + "/" + lines_data.len())
                yield null
            }
        }

        // Build footer
        json += "]}"

        debug_log("export_station_data: JSON complete, size=" + json.len())
        yield null  // YIELD POINT: After JSON building

        debug_log("export_station_data: starting file write")
        write_station_file(json)

        debug_log("export_station_data: file write complete")
        yield null  // YIELD POINT 3: After file writing

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
           "last_export_ticks = " + persistent.last_export_ticks + ", " +
           "export_count = " + persistent.export_count + ", " +
           "ai_player = null, " +
           "initial_export_done = " + (persistent.initial_export_done ? "true" : "false") + ", " +
           "last_export_hours = " + persistent.last_export_hours + " }"
}
