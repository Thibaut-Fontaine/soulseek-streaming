package com.soulstream.app.auto

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Small snapshot exchanged with JavaScript: the browse tree and the current
 * playback state. Stored in SharedPreferences because the MediaBrowserService
 * can be started before (or without) a React context.
 */
data class AutoPlayback(
    val playing: Boolean = false,
    val positionMs: Long = 0,
    val title: String = "",
    val artist: String = "",
    val album: String = "",
    val artworkUri: String? = null,
    val durationMs: Long = 0,
)

object AutoSnapshot {
    private const val PREFS = "soulstream_auto"
    private const val KEY_TREE = "browse_tree"
    private const val KEY_PLAYBACK = "playback"

    @Volatile
    private var cachedTree: AutoNode? = null

    fun parseTree(json: String): AutoNode? = try {
        parseNode(JSONObject(json))
    } catch (_: Exception) {
        null
    }

    fun loadTree(context: Context): AutoNode? {
        cachedTree?.let { return it }
        val json = prefs(context).getString(KEY_TREE, null) ?: return null
        return parseTree(json)?.also { cachedTree = it }
    }

    fun save(context: Context, treeJson: String, playbackJson: String) {
        val tree = parseTree(treeJson) ?: return
        cachedTree = tree
        prefs(context).edit()
            .putString(KEY_TREE, treeJson)
            .putString(KEY_PLAYBACK, playbackJson)
            .apply()
    }

    fun loadPlayback(context: Context): AutoPlayback {
        val raw = prefs(context).getString(KEY_PLAYBACK, null) ?: return AutoPlayback()
        return try {
            val json = JSONObject(raw)
            AutoPlayback(
                playing = json.optBoolean("playing", false),
                positionMs = json.optLong("positionMs", 0),
                title = json.optString("title", ""),
                artist = json.optString("artist", ""),
                album = json.optString("album", ""),
                artworkUri = json.optString("artworkUri", "").ifEmpty { null },
                durationMs = json.optLong("durationMs", 0),
            )
        } catch (_: Exception) {
            AutoPlayback()
        }
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun parseNode(json: JSONObject): AutoNode {
        val childrenJson: JSONArray? = json.optJSONArray("children")
        val children = if (childrenJson == null) {
            emptyList()
        } else {
            (0 until childrenJson.length()).mapNotNull { index ->
                childrenJson.optJSONObject(index)?.let { parseNode(it) }
            }
        }

        return AutoNode(
            id = json.optString("id", ""),
            title = json.optString("title", ""),
            artist = json.optString("artist", "").ifEmpty { null },
            album = json.optString("album", "").ifEmpty { null },
            durationMs = (json.optDouble("durationSec", 0.0) * 1000).toLong(),
            artworkUri = json.optString("artworkUri", "").ifEmpty { null },
            folder = json.optBoolean("folder", false),
            children = children,
        )
    }
}
