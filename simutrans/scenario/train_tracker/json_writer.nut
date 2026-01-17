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
 * Format current real-world timestamp
 * @return ISO 8601 timestamp string (approximation)
 */
function format_timestamp() {
    // Squirrel doesn't have date/time functions, so we use ticks
    // This is a placeholder - the actual timestamp will be approximate
    local time = world.get_time()
    return format("simutrans-%04d-%02d", time.year, time.month + 1)
}
