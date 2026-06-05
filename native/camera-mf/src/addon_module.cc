#include "addon_shared.h"
#include "mf_camera.h"

NAPI_MODULE_INIT() {
  napi_property_descriptor props[] = {
      {"listDevices", nullptr, ListDevices, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"listDevicesAsync", nullptr, ListDevicesAsync, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"startCaptureAsync", nullptr, StartCaptureAsync, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"stopCapture", nullptr, StopCapture, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"isCaptureOpen", nullptr, IsCaptureOpen, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getPreviewFrameGeneration", nullptr, GetPreviewFrameGeneration, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"getRawFrameGeneration", nullptr, GetRawFrameGeneration, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"stopCaptureAsync", nullptr, StopCaptureAsync, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getPreviewJpegAsync", nullptr, GetPreviewJpegAsync, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"grabFrameAsync", nullptr, GrabFrameAsync, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getCapabilities", nullptr, GetCameraCapabilities, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getCapabilitiesAsync", nullptr, GetCameraCapabilitiesAsync, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getControls", nullptr, GetCameraControls, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getControlsAsync", nullptr, GetCameraControlsAsync, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setControls", nullptr, SetCameraControls, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setControlsAsync", nullptr, SetCameraControlsAsync, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"subscribeDevicesChanged", nullptr, SubscribeDevicesChanged, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"unsubscribeDevicesChanged", nullptr, UnsubscribeDevicesChanged, nullptr, nullptr, nullptr, napi_default,
       nullptr},
  };
  napi_add_env_cleanup_hook(env, CleanupAddon, nullptr);
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

void CleanupAddon(void* data) {
  (void)data;
  ShutdownHotplugAddon();
  ShutdownMfCamera();
}
