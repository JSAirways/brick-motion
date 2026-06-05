#include "mf_hotplug.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <cfgmgr32.h>

#include <mutex>

// {E5323777-F976-4f6b-9B55-B9479C4779BF}
static const GUID kVideoCaptureInterfaceGuid = {
    0xe5323777,
    0xf976,
    0x4f6b,
    {0x9b, 0x55, 0xb9, 0x47, 0x9c, 0x47, 0x79, 0xbf}};

namespace {

std::mutex g_mu;
MfHotplugListener g_listener;
MfHotplugListener g_invalidate_listener;
HCMNOTIFICATION g_cookie = nullptr;
bool g_registered = false;

DWORD CALLBACK DeviceNotifyCallback(HCMNOTIFICATION /*notify*/,
                                    PVOID /*context*/,
                                    CM_NOTIFY_ACTION action,
                                    PCM_NOTIFY_EVENT_DATA /*event_data*/,
                                    DWORD /*event_data_size*/) {
  if (action != CM_NOTIFY_ACTION_DEVICEINTERFACEARRIVAL &&
      action != CM_NOTIFY_ACTION_DEVICEINTERFACEREMOVAL) {
    return ERROR_SUCCESS;
  }
  MfHotplugListener listener;
  {
    std::lock_guard<std::mutex> lock(g_mu);
    listener = g_listener;
  }
  if (listener) {
    listener();
  }
  return ERROR_SUCCESS;
}

}  // namespace

void StartMfHotplug(MfHotplugListener listener) {
  std::lock_guard<std::mutex> lock(g_mu);
  g_listener = std::move(listener);
  if (g_registered) {
    return;
  }
  CM_NOTIFY_FILTER filter = {};
  filter.cbSize = sizeof(filter);
  filter.FilterType = CM_NOTIFY_FILTER_TYPE_DEVICEINTERFACE;
  filter.u.DeviceInterface.ClassGuid = kVideoCaptureInterfaceGuid;
  const CONFIGRET cr =
      CM_Register_Notification(&filter, nullptr, DeviceNotifyCallback, &g_cookie);
  g_registered = (cr == CR_SUCCESS && g_cookie != nullptr);
}

void StopMfHotplug() {
  std::lock_guard<std::mutex> lock(g_mu);
  g_listener = nullptr;
  g_invalidate_listener = nullptr;
  if (g_registered && g_cookie != nullptr) {
    CM_Unregister_Notification(g_cookie);
    g_cookie = nullptr;
    g_registered = false;
  }
}

void SetMfDeviceInvalidatedListener(MfHotplugListener listener) {
  std::lock_guard<std::mutex> lock(g_mu);
  g_invalidate_listener = std::move(listener);
}

void NotifyMfDeviceInvalidated() {
  MfHotplugListener listener;
  {
    std::lock_guard<std::mutex> lock(g_mu);
    listener = g_invalidate_listener;
  }
  if (listener) {
    listener();
  }
}
