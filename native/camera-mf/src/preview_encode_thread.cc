#include "preview_encode_thread.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <objbase.h>

#include <condition_variable>
#include <cstdio>
#include <functional>
#include <mutex>
#include <queue>
#include <thread>

namespace {

std::mutex g_mu;
std::condition_variable g_cv;
std::queue<std::function<void()>> g_tasks;
std::thread g_thread;
bool g_running = false;

void PreviewEncodeThreadMain() {
  const HRESULT co_hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  for (;;) {
    std::function<void()> task;
    {
      std::unique_lock<std::mutex> lock(g_mu);
      g_cv.wait(lock, [] { return !g_running || !g_tasks.empty(); });
      if (!g_running && g_tasks.empty()) {
        break;
      }
      task = std::move(g_tasks.front());
      g_tasks.pop();
    }
    if (task) {
      task();
    }
  }
  if (SUCCEEDED(co_hr)) {
    CoUninitialize();
  }
}

}  // namespace

void EnsurePreviewEncodeThread() {
  std::lock_guard<std::mutex> lock(g_mu);
  if (g_running) {
    return;
  }
  g_running = true;
  g_thread = std::thread(PreviewEncodeThreadMain);
}

void ShutdownPreviewEncodeThread() {
  {
    std::lock_guard<std::mutex> lock(g_mu);
    if (!g_running) {
      return;
    }
    g_running = false;
  }
  g_cv.notify_all();
  if (g_thread.joinable()) {
    g_thread.join();
  }
  std::lock_guard<std::mutex> lock(g_mu);
  while (!g_tasks.empty()) {
    g_tasks.pop();
  }
}

void QueuePreviewEncodeWork(std::function<void()> task) {
  EnsurePreviewEncodeThread();
  {
    std::lock_guard<std::mutex> lock(g_mu);
    // Keep only the latest downscale job so a slow worker does not drain stale frames.
    std::queue<std::function<void()>> discard;
    std::swap(g_tasks, discard);
    g_tasks.push(std::move(task));
  }
  g_cv.notify_one();
}
