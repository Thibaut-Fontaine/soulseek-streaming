package com.soulstream.app.auto

/**
 * Pure browse-tree model for Android Auto (feature 8).
 *
 * Kept free of Android imports so the tree and command mapping can be tested
 * on the JVM. The MediaBrowserService only converts these nodes to MediaItems.
 */
data class AutoNode(
    val id: String,
    val title: String,
    val artist: String? = null,
    val album: String? = null,
    val durationMs: Long = 0,
    val artworkUri: String? = null,
    val folder: Boolean = false,
    val children: List<AutoNode> = emptyList(),
) {
    fun find(targetId: String): AutoNode? {
        if (id == targetId) return this
        for (child in children) {
            child.find(targetId)?.let { return it }
        }
        return null
    }

    fun childrenOf(parentId: String): List<AutoNode> = find(parentId)?.children ?: emptyList()
}

enum class AutoAction(val wire: String) {
    PLAY_FROM_ID("play_from_id"),
    PLAY("play"),
    PAUSE("pause"),
    NEXT("next"),
    PREVIOUS("previous"),
    SEEK("seek"),
    STOP("stop");

    companion object {
        fun fromWire(value: String?): AutoAction? = entries.firstOrNull { it.wire == value }
    }
}

data class AutoCommand(
    val action: AutoAction,
    val mediaId: String? = null,
    val positionMs: Long = 0,
)
