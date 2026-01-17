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

// Configuration
config <- {
    // Output file path (relative to simutrans directory)
    output_file = "train_positions.json"
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
 * Export train data once per month
 */
function new_month() {
    export_train_data()
}

/**
 * Main export function - collects train data and writes JSON
 */
function export_train_data() {
    try {
        local trains = []
        local convoy_list = world.get_convoy_list()

        // Iterate through all convoys (no debug print to save time)
        for (local i = 0; i < convoy_list.get_count(); i++) {
            local convoy = convoy_list[i]

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
 * Save persistent data
 * Called when game is saved
 */
function save() {
    return "persistent <- { " +
           "last_export_ticks = " + persistent.last_export_ticks + ", " +
           "export_count = " + persistent.export_count + ", " +
           "ai_player = null }"
}
