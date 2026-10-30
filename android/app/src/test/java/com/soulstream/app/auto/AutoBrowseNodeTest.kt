package com.soulstream.app.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AutoBrowseNodeTest {

    private val song = AutoNode(id = "device:peer:file.mp3", title = "One More Time", artist = "Daft Punk")
    private val album = AutoNode(id = "album", title = "Discovery", folder = true, children = listOf(song))
    private val root = AutoNode(
        id = "root",
        title = "SoulStream",
        folder = true,
        children = listOf(AutoNode(id = "library", title = "Bibliothèque", folder = true, children = listOf(album))),
    )

    @Test
    fun findsNodesAtEveryDepth() {
        assertEquals(root, root.find("root"))
        assertEquals(album, root.find("album"))
        assertEquals(song, root.find("device:peer:file.mp3"))
        assertNull(root.find("missing"))
    }

    @Test
    fun returnsChildrenOnlyForFolders() {
        assertEquals(1, root.childrenOf("root").size)
        assertEquals(listOf(song), root.childrenOf("album"))
        assertEquals(emptyList<AutoNode>(), root.childrenOf("device:peer:file.mp3"))
        assertEquals(emptyList<AutoNode>(), root.childrenOf("missing"))
    }

    @Test
    fun mapsCarActionsToTheWireContract() {
        for (action in AutoAction.entries) {
            assertEquals(action, AutoAction.fromWire(action.wire))
        }
        assertNull(AutoAction.fromWire("rewind"))
        assertNull(AutoAction.fromWire(null))
        assertEquals(
            AutoCommand(AutoAction.PLAY_FROM_ID, "device:peer:file.mp3", 0),
            AutoCommand(AutoAction.fromWire("play_from_id")!!, "device:peer:file.mp3"),
        )
    }
}
