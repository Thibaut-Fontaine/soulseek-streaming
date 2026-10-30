package com.soulstream.app.auto

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.media.MediaBrowserServiceCompat

/**
 * Android Auto media browser (feature 8).
 *
 * Android Auto asks this service for a browse tree; the tree and the current
 * title are pushed by JavaScript (src/services/androidAuto.ts). Transport
 * callbacks are forwarded to the same JS player instead of starting a second
 * playback engine here.
 */
class SoulStreamMediaService : MediaBrowserServiceCompat() {

    private lateinit var session: MediaSessionCompat

    override fun onCreate() {
        super.onCreate()
        instance = this

        session = MediaSessionCompat(this, "SoulStreamAuto").apply {
            setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                    MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS,
            )
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    AutoBridge.command(AutoCommand(AutoAction.PLAY))
                }

                override fun onPause() {
                    AutoBridge.command(AutoCommand(AutoAction.PAUSE))
                }

                override fun onStop() {
                    AutoBridge.command(AutoCommand(AutoAction.STOP))
                }

                override fun onSkipToNext() {
                    AutoBridge.command(AutoCommand(AutoAction.NEXT))
                }

                override fun onSkipToPrevious() {
                    AutoBridge.command(AutoCommand(AutoAction.PREVIOUS))
                }

                override fun onSeekTo(pos: Long) {
                    AutoBridge.command(AutoCommand(AutoAction.SEEK, positionMs = pos))
                }

                override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) {
                    if (mediaId != null) {
                        AutoBridge.command(AutoCommand(AutoAction.PLAY_FROM_ID, mediaId = mediaId))
                    }
                }
            })
            isActive = true
        }
        sessionToken = session.sessionToken
        updateSession()
    }

    override fun onGetRoot(
        clientPackageName: String,
        clientUid: Int,
        rootHints: Bundle?,
    ): BrowserRoot = BrowserRoot(AUTO_ROOT_ID, null)

    override fun onLoadChildren(
        parentId: String,
        result: Result<List<MediaBrowserCompat.MediaItem>>,
    ) {
        val tree = AutoSnapshot.loadTree(this)
        result.sendResult(tree?.childrenOf(parentId)?.map { it.toMediaItem() } ?: emptyList())
    }

    override fun onDestroy() {
        instance = null
        session.release()
        super.onDestroy()
    }

    private fun updateSession() {
        val playback = AutoSnapshot.loadPlayback(this)
        val state = PlaybackStateCompat.Builder()
            .setActions(ACTIONS)
            .setState(
                if (playback.playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                playback.positionMs,
                if (playback.playing) 1f else 0f,
            )
            .build()
        session.setPlaybackState(state)

        if (playback.title.isNotEmpty()) {
            val metadata = MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, playback.title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, playback.artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, playback.album)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, playback.durationMs)
                .apply {
                    playback.artworkUri?.let {
                        putString(MediaMetadataCompat.METADATA_KEY_ART_URI, it)
                        putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, it)
                    }
                }
                .build()
            session.setMetadata(metadata)
        }
    }

    private fun AutoNode.toMediaItem(): MediaBrowserCompat.MediaItem {
        val description = MediaDescriptionCompat.Builder()
            .setMediaId(id)
            .setTitle(title)
            .setSubtitle(artist)
            .setExtras(Bundle().apply {
                putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
            })
            .apply { artworkUri?.let { setIconUri(Uri.parse(it)) } }
            .build()
        val flags = if (folder) {
            MediaBrowserCompat.MediaItem.FLAG_BROWSABLE
        } else {
            MediaBrowserCompat.MediaItem.FLAG_PLAYABLE
        }
        return MediaBrowserCompat.MediaItem(description, flags)
    }

    companion object {
        const val AUTO_ROOT_ID = "root"
        private const val ACTIONS =
            PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_STOP or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_SEEK_TO

        @Volatile
        private var instance: SoulStreamMediaService? = null

        /** Called by AutoModule after JavaScript pushes a new snapshot. */
        fun refresh(context: Context) {
            instance?.updateSession()
        }
    }
}
