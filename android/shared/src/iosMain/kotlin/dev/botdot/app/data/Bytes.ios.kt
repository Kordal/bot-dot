package dev.botdot.app.data

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import platform.Foundation.NSData
import platform.posix.memcpy

/** The bytes of [data] (a picked screenshot) as the shared layer takes them, copied at once. */
@OptIn(ExperimentalForeignApi::class)
fun bytesOf(data: NSData): ByteArray = ByteArray(data.length.toInt()).apply {
    if (isNotEmpty()) usePinned { memcpy(it.addressOf(0), data.bytes, data.length) }
}
