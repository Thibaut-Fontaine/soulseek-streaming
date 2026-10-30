package com.soulstream.app.auto

/**
 * Commands from the car to JavaScript. If the React instance is not ready yet
 * (Android Auto can start the service on its own), keep a few commands so the
 * next attach can consume them instead of losing the user's tap.
 */
object AutoBridge {
    fun interface Listener {
        fun onCommand(command: AutoCommand)
    }

    private val pending = ArrayDeque<AutoCommand>()
    private var listener: Listener? = null

    @Synchronized
    fun setListener(next: Listener?) {
        listener = next
        while (next != null && pending.isNotEmpty()) {
            next.onCommand(pending.removeFirst())
        }
    }

    @Synchronized
    fun command(command: AutoCommand) {
        val current = listener
        if (current != null) {
            current.onCommand(command)
        } else if (pending.size < MAX_PENDING) {
            pending.addLast(command)
        }
    }

    private const val MAX_PENDING = 20
}
