#pragma once

#include <functional>

void EnsureCameraThread();
void ShutdownCameraThread();
void RunOnCameraThread(const std::function<void()>& task);
/** Enqueue without blocking the caller (used for startCapture so the libuv pool is not wedged). */
void QueueOnCameraThread(const std::function<void()>& task);
/** Blocks the caller until the task finishes or times out (use from libuv pool, not Node main). */
bool RunOnCameraThreadWithTimeout(const std::function<void()>& task, int timeout_ms, const char* label);
/** Sets abort flag and runs task on the camera thread (used for stop while open may be stuck). */
void RunOnCameraThreadUrgent(const std::function<void()>& task, int wait_ms);
