/**
 * JSON Writer Utility for Train Tracker
 * Builds JSON strings from Squirrel data structures
 */

/**
 * Escape string for JSON
 * @param str String to escape
 * @return Escaped string
 */
function json_escape(str) {
    if (str == null) return "null"

    local result = ""
    for (local i = 0; i < str.len(); i++) {
        local ch = str.slice(i, i + 1)
        if (ch == "\"") {
            result += "\\\""
        } else if (ch == "\\") {
            result += "\\\\"
        } else if (ch == "\n") {
            result += "\\n"
        } else if (ch == "\r") {
            result += "\\r"
        } else if (ch == "\t") {
            result += "\\t"
        } else {
            result += ch
        }
    }
    return result
}

/**
 * Convert value to JSON string
 * @param value Value to convert (string, number, bool, null, array, table)
 * @return JSON string representation
 */
function to_json(value) {
    local value_type = typeof(value)

    if (value == null) {
        return "null"
    } else if (value_type == "bool") {
        return value ? "true" : "false"
    } else if (value_type == "integer" || value_type == "float") {
        return value.tostring()
    } else if (value_type == "string") {
        return "\"" + json_escape(value) + "\""
    } else if (value_type == "array") {
        local items = []
        foreach (item in value) {
            items.append(to_json(item))
        }
        return "[" + join_array(items, ",") + "]"
    } else if (value_type == "table") {
        local items = []
        foreach (key, val in value) {
            items.append("\"" + json_escape(key.tostring()) + "\":" + to_json(val))
        }
        return "{" + join_array(items, ",") + "}"
    } else {
        // For objects with tostring()
        return "\"" + json_escape(value.tostring()) + "\""
    }
}

/**
 * Join array elements with separator
 * @param arr Array of strings
 * @param sep Separator string
 * @return Joined string
 */
function join_array(arr, sep) {
    if (arr.len() == 0) return ""

    local result = arr[0]
    for (local i = 1; i < arr.len(); i++) {
        result += sep + arr[i]
    }
    return result
}

/**
 * Build train data JSON
 * @param trains Array of train data tables
 * @param game_time Current game time
 * @return JSON string
 */
function build_train_json(trains, game_time) {
    local timestamp = format_timestamp()

    local root = {
        timestamp = timestamp,
        game_time = {
            year = game_time.year,
            month = game_time.month,
            ticks = game_time.ticks
        },
        trains = trains
    }

    return to_json(root)
}

/**
 * Build station data JSON
 * @param lines_data Array of line data tables with stations
 * @return JSON string
 */
function build_station_json(lines_data) {
    local timestamp = format_timestamp()
    local game_time = world.get_time()

    local root = {
        timestamp = timestamp,
        game_time = {
            year = game_time.year,
            month = game_time.month,
            ticks = game_time.ticks
        },
        lines = lines_data
    }

    return to_json(root)
}

/**
 * Format current real-world timestamp
 * @return ISO 8601 timestamp string (approximation)
 */
function format_timestamp() {
    // Squirrel doesn't have date/time functions, so we use ticks
    // This is a placeholder - the actual timestamp will be approximate
    local time = world.get_time()
    return format("simutrans-%04d-%02d", time.year, time.month + 1)
}

/**
 * Create a JSON builder with state for chunked building
 * @return Builder state table
 */
function create_json_builder() {
    return {
        parts = [],           // Accumulated JSON string parts
        chunk_size = 20       // Items to process before yielding
    }
}

/**
 * Build JSON for array with yield points (generator)
 * Processes array in chunks, yielding every chunk_size items
 * @param builder Builder state table
 * @param array_data Array to convert to JSON
 */
function json_build_array_chunked(builder, array_data) {
    builder.parts.append("[")

    local count = 0
    local first = true

    foreach (item in array_data) {
        if (!first) {
            builder.parts.append(",")
        }
        first = false

        // Use existing to_json() for individual items (they're small)
        builder.parts.append(to_json(item))
        count++

        // Yield every chunk_size items
        if (count % builder.chunk_size == 0) {
            yield null
        }
    }

    builder.parts.append("]")
}

/**
 * Get final JSON string from builder
 * @param builder Builder state table
 * @return Complete JSON string
 */
function json_builder_result(builder) {
    return join_array(builder.parts, "")
}

/**
 * Build train data JSON with yield points (generator)
 * @param trains Array of train data tables
 * @param game_time Current game time
 * @param builder Builder state (will be populated with result)
 */
function build_train_json_chunked(trains, game_time, builder) {
    // Build the root structure
    builder.parts.append("{")

    // Add timestamp
    local timestamp = format_timestamp()
    builder.parts.append("\"timestamp\":\"" + json_escape(timestamp) + "\",")

    // Add game_time
    builder.parts.append("\"game_time\":")
    builder.parts.append(to_json({
        year = game_time.year,
        month = game_time.month,
        ticks = game_time.ticks
    }))
    builder.parts.append(",")

    // Add trains array (with chunking)
    builder.parts.append("\"trains\":")
    foreach (dummy in json_build_array_chunked(builder, trains)) {
        yield null  // Propagate yields
    }

    builder.parts.append("}")
}

/**
 * Build station data JSON with yield points (generator)
 * @param lines_data Array of line data tables with stations
 * @param builder Builder state (will be populated with result)
 */
function build_station_json_chunked(lines_data, builder) {
    local timestamp = format_timestamp()
    local game_time = world.get_time()

    builder.parts.append("{")

    // Add timestamp
    builder.parts.append("\"timestamp\":\"" + json_escape(timestamp) + "\",")

    // Add game_time
    builder.parts.append("\"game_time\":")
    builder.parts.append(to_json({
        year = game_time.year,
        month = game_time.month,
        ticks = game_time.ticks
    }))
    builder.parts.append(",")

    // Add lines array (with chunking)
    builder.parts.append("\"lines\":")
    foreach (dummy in json_build_array_chunked(builder, lines_data)) {
        yield null  // Propagate yields
    }

    builder.parts.append("}")
}
