#include "mf_capture_control.h"

#include <atomic>
#include <cstdio>

namespace {

std::atomic<bool> g_abort_capture{false};

}  // namespace

void RequestCaptureAbort() {
  g_abort_capture.store(true, std::memory_order_release);
}

void ClearCaptureAbort() {
  g_abort_capture.store(false, std::memory_order_release);
}

bool ShouldAbortCapture() {
  return g_abort_capture.load(std::memory_order_acquire);
}

int GetOpenDeadlineMs() {
  return 12000;
}

void LogMfStep(const char* step) {
  if (step) {
    std::fprintf(stderr, "[camera_mf] %s\n", step);
  }
}
