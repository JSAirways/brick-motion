#pragma once

#include <node_api.h>

#include <mutex>
#include <string>
#include <vector>

struct CameraDevice {
  std::string id;
  std::string label;
};

/** COM apartment helper for N-API entry points. MFStartup/MFShutdown live on the camera thread only. */
class ComScope {
 public:
  ComScope();
  ~ComScope();
  bool ok() const { return ok_; }

 private:
  bool ok_ = false;
  bool needs_uninit_ = false;
};

void ThrowErr(napi_env env, const char* msg);
std::string ArgUtf8(napi_env env, napi_value value);
int32_t ParseBoundedIntProperty(napi_env env, napi_value obj, const char* key, int32_t fallback, int32_t min, int32_t max);

bool BuildCaptureProfileObject(napi_env env, uint32_t width, uint32_t height, uint32_t subtype_data1,
                               uint64_t pixel_area, napi_value* out);
bool BuildGrabResultObject(napi_env env, const std::vector<uint8_t>& preview, const std::vector<uint8_t>& source,
                           bool source_is_png, int source_width, int source_height, napi_value* out);
bool SetNumCapOnObject(napi_env env, napi_value caps_obj, const char* key, double mn, double mx, double st);
napi_value DevicesToJs(napi_env env, const std::vector<CameraDevice>& devices);

void CleanupAddon(void* data);
void ShutdownHotplugAddon();

napi_value SubscribeDevicesChanged(napi_env env, napi_callback_info info);
napi_value UnsubscribeDevicesChanged(napi_env env, napi_callback_info info);

napi_value ListDevices(napi_env env, napi_callback_info info);
napi_value ListDevicesAsync(napi_env env, napi_callback_info info);
napi_value StopCaptureAsync(napi_env env, napi_callback_info info);
napi_value GetCameraCapabilitiesAsync(napi_env env, napi_callback_info info);
napi_value GetCameraControlsAsync(napi_env env, napi_callback_info info);
napi_value SetCameraControlsAsync(napi_env env, napi_callback_info info);
napi_value StartCaptureAsync(napi_env env, napi_callback_info info);
napi_value StopCapture(napi_env env, napi_callback_info info);
napi_value IsCaptureOpen(napi_env env, napi_callback_info info);
napi_value GetPreviewFrameGeneration(napi_env env, napi_callback_info info);
napi_value GetRawFrameGeneration(napi_env env, napi_callback_info info);
napi_value GetPreviewJpegAsync(napi_env env, napi_callback_info info);
napi_value GrabFrameAsync(napi_env env, napi_callback_info info);
napi_value GetCameraCapabilities(napi_env env, napi_callback_info info);
napi_value GetCameraControls(napi_env env, napi_callback_info info);
napi_value SetCameraControls(napi_env env, napi_callback_info info);
