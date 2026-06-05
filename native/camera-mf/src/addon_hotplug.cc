#include "addon_shared.h"
#include "mf_hotplug.h"

#include <atomic>
#include <mutex>

namespace {

std::mutex g_tsfn_mu;
napi_threadsafe_function g_tsfn = nullptr;
napi_threadsafe_function g_invalidate_tsfn = nullptr;
std::atomic<bool> g_hotplug_started{false};

void HotplugNativeEvent() {
  napi_threadsafe_function tsfn = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_tsfn_mu);
    tsfn = g_tsfn;
  }
  if (tsfn) {
    napi_call_threadsafe_function(tsfn, nullptr, napi_tsfn_nonblocking);
  }
}

void InvalidateNativeEvent() {
  napi_threadsafe_function tsfn = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_tsfn_mu);
    tsfn = g_invalidate_tsfn;
  }
  if (tsfn) {
    napi_call_threadsafe_function(tsfn, nullptr, napi_tsfn_nonblocking);
  }
}

void TsfnCallback(napi_env env, napi_value js_callback, void* /*context*/, void* /*data*/) {
  if (!env || !js_callback) {
    return;
  }
  napi_value undefined = nullptr;
  napi_get_undefined(env, &undefined);
  napi_value recv = nullptr;
  napi_get_undefined(env, &recv);
  napi_call_function(env, recv, js_callback, 0, nullptr, nullptr);
}

}  // namespace

void ShutdownHotplugAddon() {
  StopMfHotplug();
  g_hotplug_started.store(false);
  std::lock_guard<std::mutex> lock(g_tsfn_mu);
  if (g_tsfn) {
    napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
    g_tsfn = nullptr;
  }
  if (g_invalidate_tsfn) {
    napi_release_threadsafe_function(g_invalidate_tsfn, napi_tsfn_release);
    g_invalidate_tsfn = nullptr;
  }
}

static bool CreateDeviceTsfn(napi_env env, napi_value callback, const char* name, napi_threadsafe_function* out) {
  napi_value resource_name = nullptr;
  napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &resource_name);
  return napi_create_threadsafe_function(env, callback, nullptr, resource_name, 0, 1, nullptr, nullptr, nullptr,
                                       TsfnCallback, out) == napi_ok;
}

napi_value SubscribeDevicesChanged(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    ThrowErr(env, "callback required");
    return nullptr;
  }
  napi_valuetype t;
  if (napi_typeof(env, args[0], &t) != napi_ok || t != napi_function) {
    ThrowErr(env, "callback must be a function");
    return nullptr;
  }
  napi_value invalidate_cb = args[0];
  if (argc >= 2 && napi_typeof(env, args[1], &t) == napi_ok && t == napi_function) {
    invalidate_cb = args[1];
  }

  {
    std::lock_guard<std::mutex> lock(g_tsfn_mu);
    if (g_tsfn) {
      napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
      g_tsfn = nullptr;
    }
    if (g_invalidate_tsfn) {
      napi_release_threadsafe_function(g_invalidate_tsfn, napi_tsfn_release);
      g_invalidate_tsfn = nullptr;
    }
    if (!CreateDeviceTsfn(env, args[0], "camera_mf_devices_changed", &g_tsfn) ||
        !CreateDeviceTsfn(env, invalidate_cb, "camera_mf_device_invalidated", &g_invalidate_tsfn)) {
      ThrowErr(env, "create threadsafe function");
      return nullptr;
    }
  }

  if (!g_hotplug_started.exchange(true)) {
    StartMfHotplug([]() { HotplugNativeEvent(); });
    SetMfDeviceInvalidatedListener([]() { InvalidateNativeEvent(); });
  }

  napi_value undefined = nullptr;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value UnsubscribeDevicesChanged(napi_env env, napi_callback_info info) {
  (void)info;
  ShutdownHotplugAddon();
  napi_value undefined = nullptr;
  napi_get_undefined(env, &undefined);
  return undefined;
}
