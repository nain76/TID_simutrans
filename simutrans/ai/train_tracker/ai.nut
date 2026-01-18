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
    ai_player = null  // Store AI player reference
}

/**
 * AI initialization
 * Called when AI is first started
 * @param pl_nr Player number (integer)
 */
function start(pl_nr) {
    // Convert player number to player object
    persistent.ai_player = player_x(pl_nr)
    // No output to save time - export will happen at next month
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
 * Alternates between train data (even months) and station data (odd months)
 * to avoid resource conflicts
 */
function new_month() {
    local game_time = world.get_time()
    local month = game_time.month  // 0-11 (0=January, 11=December)

    if (month % 2 == 0) {
        // Even months (0,2,4,6,8,10): Export train data
        export_train_data()
    } else {
        // Odd months (1,3,5,7,9,11): Export station data
        export_station_data()
    }
}

/**
 * Main export function - collects train data and writes JSON
 */
function export_train_data() {
    try {
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

        // Build JSON
        local game_time = world.get_time()
        local json_string = build_train_json(trains, game_time)

        // Write to file
        write_json_file(json_string)

        persistent.export_count++

        // No debug print to save time

    } catch (e) {
        // Silent error handling to save time
    }
}

/**
 * Export station data for all rail/tram lines
 * Called once per year
 */
function export_station_data() {
    try {
        local lines_data = []
        local line_list = world.get_line_list()

        // Convert line_list to array for generator
        local line_array = []
        for (local i = 0; i < line_list.get_count(); i++) {
            line_array.append(line_list[i])
        }

        // Iterate through all lines with yield for timeout prevention
        foreach (line in _step_generator(line_array)) {
            if (!line.is_valid()) continue

            // Filter: only track rail and tram lines
            local wt = line.get_waytype()
            if (!should_track_waytype(wt)) continue

            // Get line schedule
            local schedule = line.get_schedule()
            if (!schedule || !schedule.is_valid()) continue

            local stations = []

            // Use generator for schedule entries too
            foreach (entry in _step_generator(schedule.entries)) {
                local pos = entry.get_halt(null)

                if (pos) {
                    local halt = halt_x.get_halt(world, pos)
                    if (halt && halt.is_valid()) {
                        local station_data = {
                            name = halt.get_name(),
                            x = pos.x,
                            y = pos.y,
                            z = pos.z
                        }
                        stations.append(station_data)
                    }
                }
            }

            // Only add line if it has stations
            if (stations.len() > 0) {
                local line_data = {
                    name = line.get_name(),
                    waytype = get_waytype_en(wt),
                    waytype_ja = get_waytype_ja(wt),
                    stations = stations
                }
                lines_data.append(line_data)
            }
        }

        // Build JSON
        local json_string = build_station_json(lines_data)

        // Write to file
        write_station_file(json_string)

    } catch (e) {
        // Silent error handling
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
           "ai_player = null }"
}
