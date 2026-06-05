#pragma once

#include <functional>

/** Dedicated STA worker for WIC preview JPEG (keeps MF ingest off this queue). */
void EnsurePreviewEncodeThread();
void ShutdownPreviewEncodeThread();
void QueuePreviewEncodeWork(std::function<void()> task);
