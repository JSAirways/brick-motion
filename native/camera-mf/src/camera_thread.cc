#include "camera_thread.h"
#include "mf_capture_control.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <mfapi.h>

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <future>
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
bool g_mf_started = false;

void CameraThreadMain() {
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (SUCCEEDED(MFStartup(MF_VERSION, MFSTARTUP_LITE))) {
    g_mf_started = true;
  }
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
  if (g_mf_started) {
    MFShutdown();
    g_mf_started = false;
  }
  CoUninitialize();
}

}  // namespace

void EnsureCameraThread() {
  std::lock_guard<std::mutex> lock(g_mu);
  if (g_running) {
    return;
  }
  g_running = true;
  g_thread = std::thread(CameraThreadMain);
}

void ShutdownCameraThread() {
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
}

bool RunOnCameraThreadWithTimeout(const std::function<void()>& task, const int timeout_ms, const char* label) {
  std::mutex mu;
  std::condition_variable cv;
  bool finished = false;
  QueueOnCameraThread([&]() {
    task();
    {
      std::lock_guard<std::mutex> lock(mu);
      finished = true;
    }
    cv.notify_one();
  });
  std::unique_lock<std::mutex> lock(mu);
  if (!cv.wait_for(lock, std::chrono::milliseconds(timeout_ms > 0 ? timeout_ms : 25000),
                   [&]() { return finished; })) {
    std::fprintf(stderr, "[camera_mf] %s timed out after %d ms\n", label ? label : "camera task", timeout_ms);
    RequestCaptureAbort();
    return false;
  }
  return true;
}

void QueueOnCameraThread(const std::function<void()>& task) {
  EnsureCameraThread();
  {
    std::lock_guard<std::mutex> lock(g_mu);
    g_tasks.push(task);
  }
  g_cv.notify_one();
}

void RunOnCameraThread(const std::function<void()>& task) {
  EnsureCameraThread();
  std::promise<void> done;
  std::future<void> fut = done.get_future();
  {
    std::lock_guard<std::mutex> lock(g_mu);
    g_tasks.push([&]() {
      task();
      done.set_value();
    });
  }
  g_cv.notify_one();
  fut.wait();
}

void RunOnCameraThreadUrgent(const std::function<void()>& task, const int wait_ms) {
  EnsureCameraThread();
  std::promise<void> done;
  std::future<void> fut = done.get_future();
  {
    std::lock_guard<std::mutex> lock(g_mu);
    while (!g_tasks.empty()) {
      g_tasks.pop();
    }
    g_tasks.push([&]() {
      task();
      done.set_value();
    });
  }
  g_cv.notify_one();
  if (wait_ms > 0) {
    if (fut.wait_for(std::chrono::milliseconds(wait_ms)) == std::future_status::timeout) {
      std::fprintf(stderr, "[camera_mf] urgent camera thread task timed out after %d ms\n", wait_ms);
    }
  } else {
    fut.wait();
  }
}
