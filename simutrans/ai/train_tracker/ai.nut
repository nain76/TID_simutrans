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
    // Export interval in game ticks (approximately 30 seconds)
    export_interval_ticks = 600,

    // Output file path (relative to simutrans directory)
    output_file = "train_positions.json",

    // Debug mode - print extra information
    debug = true
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
 * @param pl Player object for this AI
 */
function start(pl) {
    persistent.ai_player = pl

    print("[Train Tracker AI] Started for player: " + pl.get_name())
    print("[Train Tracker AI] Export interval: ~" + (config.export_interval_ticks / 20) + " seconds")
    print("[Train Tracker AI] Output file: " + config.output_file)

    // Do initial export
    export_train_data()
}

/**
 * Resume from saved game
 * @param pl Player object for this AI
 */
function resume_game(pl) {
    persistent.ai_player = pl

    print("[Train Tracker AI] Resuming from saved game")
    print("[Train Tracker AI] Previous exports: " + persistent.export_count)

    // Do initial export after resume
    export_train_data()
}

/**
 * Called every game month
 * We use this to trigger exports at regular intervals
 */
function new_month() {
    check_and_export()
}

/**
 * Called every game tick (optional)
 * We check the tick counter here for more precise timing
 */
function step() {
    check_and_export()
}

/**
 * Check if it's time to export and do so if needed
 */
function check_and_export() {
    local current_time = world.get_time()
    local current_ticks = current_time.ticks

    // Check if enough ticks have passed
    local ticks_since_last = current_ticks - persistent.last_export_ticks

    if (ticks_since_last >= config.export_interval_ticks) {
        export_train_data()
        persistent.last_export_ticks = current_ticks
    }
}

/**
 * Main export function - collects train data and writes JSON
 */
function export_train_data() {
    try {
        local trains = []
        local convoy_list = world.get_convoy_list()

        if (config.debug) {
            print("[Train Tracker AI] Collecting data from " + convoy_list.get_count() + " convoys")
        }

        // Iterate through all convoys
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

            // Get schedule information
            local schedule = convoy.get_schedule()
            if (schedule) {
                extract_schedule_info(train_data, schedule, convoy)
            } else {
                train_data.current_halt <- null
                train_data.next_halt <- null
            }

            trains.append(train_data)
        }

        // Build JSON
        local game_time = world.get_time()
        local json_string = build_train_json(trains, game_time)

        // Write to file
        write_json_file(json_string)

        persistent.export_count++

        if (config.debug) {
            print("[Train Tracker AI] Exported " + trains.len() + " trains (total exports: " + persistent.export_count + ")")
        }

    } catch (e) {
        print("[Train Tracker AI] ERROR during export: " + e)
    }
}

/**
 * Extract schedule information (current and next halt)
 * @param train_data Train data table to populate
 * @param schedule Schedule object
 * @param convoy Convoy object
 */
function extract_schedule_info(train_data, schedule, convoy) {
    try {
        local entries = schedule.entries
        if (!entries || entries.len() == 0) {
            train_data.current_halt <- null
            train_data.next_halt <- null
            return
        }

        // Get current schedule index
        local current_entry = 0
        if ("get_current_entry" in schedule) {
            current_entry = schedule.get_current_entry()
        }

        // Get current halt name
        if (current_entry < entries.len()) {
            local entry = entries[current_entry]
            local halt = halt_x.get_halt(world, entry, convoy.get_owner())
            if (halt && halt.is_valid()) {
                train_data.current_halt <- halt.get_name()
            } else {
                train_data.current_halt <- "座標: " + entry.x + "," + entry.y
            }
        } else {
            train_data.current_halt <- null
        }

        // Get next halt name
        local next_entry = (current_entry + 1) % entries.len()
        if (next_entry < entries.len()) {
            local entry = entries[next_entry]
            local halt = halt_x.get_halt(world, entry, convoy.get_owner())
            if (halt && halt.is_valid()) {
                train_data.next_halt <- halt.get_name()
            } else {
                train_data.next_halt <- "座標: " + entry.x + "," + entry.y
            }
        } else {
            train_data.next_halt <- null
        }

    } catch (e) {
        if (config.debug) {
            print("[Train Tracker AI] Warning: Could not extract schedule info: " + e)
        }
        train_data.current_halt <- null
        train_data.next_halt <- null
    }
}

/**
 * Write JSON string to file
 * @param json_string JSON string to write
 */
function write_json_file(json_string) {
    try {
        local f = file(config.output_file, "w")
        if (f) {
            f.writestr(json_string)
            f.close()
        } else {
            print("[Train Tracker AI] ERROR: Cannot open output file: " + config.output_file)
        }
    } catch (e) {
        print("[Train Tracker AI] ERROR writing file: " + e)
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
