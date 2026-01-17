/**
 * Waytype Translator for Train Tracker
 * Converts waytype enums to Japanese strings
 */

// Waytype to Japanese translation table
waytype_names_ja <- {
    [wt_rail] = "普通鉄道",
    [wt_monorail] = "モノレール",
    [wt_maglev] = "リニア",
    [wt_narrowgauge] = "ナローゲージ",
    [wt_tram] = "路面電車",
    [wt_road] = "道路",
    [wt_water] = "水路",
    [wt_air] = "航空"
}

// Waytype to English string (for JSON field)
waytype_names_en <- {
    [wt_rail] = "rail",
    [wt_monorail] = "monorail",
    [wt_maglev] = "maglev",
    [wt_narrowgauge] = "narrowgauge",
    [wt_tram] = "tram",
    [wt_road] = "road",
    [wt_water] = "water",
    [wt_air] = "air"
}

/**
 * Get Japanese name for waytype
 * @param wt Waytype enum value
 * @return Japanese string for the waytype
 */
function get_waytype_ja(wt) {
    if (wt in waytype_names_ja) {
        return waytype_names_ja[wt]
    }
    return "不明"
}

/**
 * Get English name for waytype (for JSON)
 * @param wt Waytype enum value
 * @return English string for the waytype
 */
function get_waytype_en(wt) {
    if (wt in waytype_names_en) {
        return waytype_names_en[wt]
    }
    return "unknown"
}

/**
 * Check if waytype should be tracked (rail and tram only)
 * @param wt Waytype enum value
 * @return true if should track, false otherwise
 */
function should_track_waytype(wt) {
    return wt == wt_rail || wt == wt_monorail || wt == wt_maglev ||
           wt == wt_narrowgauge || wt == wt_tram
}
