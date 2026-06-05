#include "addon_shared.h"
#include "camera_thread.h"
#include "mf_camera.h"
#include "mf_capture_control.h"
#include "mf_controls.h"

#include <cstdio>

struct StartCaptureAsyncWork {
  napi_deferred deferred = nullptr;
  napi_async_work work = nullptr;
  std::string device_id;
  int32_t live_max = 960;
  int32_t cap_max = 960;
  std::string error;
};

static void ExecuteStartCaptureAsync(napi_env env, void* data) {
  (void)env;
  auto* w = static_cast<StartCaptureAsyncWork*>(data);
  ClearCaptureAbort();
  const bool ran = RunOnCameraThreadWithTimeout(
      [&]() {
        MfCamera& cam = GetMfCamera();
        if (!cam.Open(w->device_id, w->live_max, w->cap_max)) {
          w->error = cam.LastError().empty() ? "MF Open failed (no detail — check terminal [camera_mf] logs)"
                                             : cam.LastError();
          std::fprintf(stderr, "[camera_mf] Open failed: %s\n", w->error.c_str());
        }
      },
      25000, "startCaptureAsync");
  if (!ran) {
    w->error = "camera thread open timed out";
    RequestCaptureAbort();
  }
}

static void CompleteStartCaptureAsync(napi_env env, napi_status status, void* data) {
  auto* w = static_cast<StartCaptureAsyncWork*>(data);
  if (status != napi_ok) {
    w->error = "Async worker failed";
  }
  if (!w->error.empty()) {
    napi_value err = nullptr;
    napi_create_string_utf8(env, w->error.c_str(), NAPI_AUTO_LENGTH, &err);
    napi_reject_deferred(env, w->deferred, err);
  } else {
    const MfCaptureProfile profile = GetMfCamera().GetCaptureProfile();
    napi_value profile_obj = nullptr;
    if (!BuildCaptureProfileObject(env, profile.width, profile.height, profile.subtype_data1, profile.pixel_area,
                                   &profile_obj)) {
      napi_value err = nullptr;
      napi_create_string_utf8(env, "capture profile object", NAPI_AUTO_LENGTH, &err);
      napi_reject_deferred(env, w->deferred, err);
    } else {
      napi_resolve_deferred(env, w->deferred, profile_obj);
    }
  }
  napi_delete_async_work(env, w->work);
  delete w;
}

napi_value StartCaptureAsync(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    ThrowErr(env, "deviceId or options object required");
    return nullptr;
  }

  auto* w = new StartCaptureAsyncWork();
  napi_valuetype t0;
  if (napi_typeof(env, args[0], &t0) != napi_ok) {
    delete w;
    ThrowErr(env, "invalid argument");
    return nullptr;
  }
  if (t0 == napi_string) {
    w->device_id = ArgUtf8(env, args[0]);
  } else if (t0 == napi_object) {
    napi_value dev = nullptr;
    if (napi_get_named_property(env, args[0], "deviceId", &dev) != napi_ok) {
      delete w;
      ThrowErr(env, "deviceId required");
      return nullptr;
    }
    w->device_id = ArgUtf8(env, dev);
    w->live_max = ParseBoundedIntProperty(env, args[0], "livePreviewMaxLongEdge", 960, 320, 1920);
    w->cap_max = ParseBoundedIntProperty(env, args[0], "capturePreviewMaxLongEdge", 960, 320, 1920);
  } else {
    delete w;
    ThrowErr(env, "deviceId string or options object required");
    return nullptr;
  }
  if (w->device_id.empty()) {
    delete w;
    ThrowErr(env, "deviceId required");
    return nullptr;
  }

  napi_value promise = nullptr;
  if (napi_create_promise(env, &w->deferred, &promise) != napi_ok) {
    delete w;
    ThrowErr(env, "create promise");
    return nullptr;
  }
  napi_value name = nullptr;
  napi_create_string_utf8(env, "startCaptureAsync", NAPI_AUTO_LENGTH, &name);
  if (napi_create_async_work(env, nullptr, name, ExecuteStartCaptureAsync, CompleteStartCaptureAsync, w, &w->work) !=
      napi_ok) {
    delete w;
    ThrowErr(env, "create async work");
    return nullptr;
  }
  napi_queue_async_work(env, w->work);
  return promise;
}

struct PreviewAsyncWork {
  napi_deferred deferred = nullptr;
  napi_async_work work = nullptr;
  std::vector<uint8_t> jpeg;
  bool has_frame = false;
  std::string error;
};

static void ExecuteGetPreviewJpegAsync(napi_env env, void* data) {
  (void)env;
  auto* w = static_cast<PreviewAsyncWork*>(data);
  MfCamera& cam = GetMfCamera();
  if (!cam.IsOpen()) {
    return;
  }
  // Async pump fills the cache on the camera thread; copying it does not require that thread.
  if (cam.CopyPreviewJpeg(w->jpeg)) {
    w->has_frame = true;
    return;
  }
  if (cam.IsOpen()) {
    QueueOnCameraThread([&]() {
      if (cam.IsOpen()) {
        cam.RequestPreviewEncode();
        cam.KickAsyncPreviewRead();
      }
    });
  }
}

static void CompleteGetPreviewJpegAsync(napi_env env, napi_status status, void* data) {
  auto* w = static_cast<PreviewAsyncWork*>(data);
  if (status != napi_ok) {
    w->error = "Async worker failed";
  }
  if (!w->error.empty()) {
    napi_value err = nullptr;
    napi_create_string_utf8(env, w->error.c_str(), NAPI_AUTO_LENGTH, &err);
    napi_reject_deferred(env, w->deferred, err);
  } else if (!w->has_frame) {
    napi_value nil = nullptr;
    napi_get_null(env, &nil);
    napi_resolve_deferred(env, w->deferred, nil);
  } else {
    napi_value buf = nullptr;
    void* copy = nullptr;
    napi_create_buffer_copy(env, w->jpeg.size(), w->jpeg.data(), &copy, &buf);
    napi_resolve_deferred(env, w->deferred, buf);
  }
  napi_delete_async_work(env, w->work);
  delete w;
}

napi_value GetPreviewJpegAsync(napi_env env, napi_callback_info info) {
  (void)info;
  auto* w = new PreviewAsyncWork();
  napi_value promise = nullptr;
  if (napi_create_promise(env, &w->deferred, &promise) != napi_ok) {
    delete w;
    ThrowErr(env, "create promise");
    return nullptr;
  }
  napi_value name = nullptr;
  napi_create_string_utf8(env, "getPreviewJpegAsync", NAPI_AUTO_LENGTH, &name);
  if (napi_create_async_work(env, nullptr, name, ExecuteGetPreviewJpegAsync, CompleteGetPreviewJpegAsync, w, &w->work) !=
      napi_ok) {
    delete w;
    ThrowErr(env, "create async work");
    return nullptr;
  }
  napi_queue_async_work(env, w->work);
  return promise;
}

napi_value ListDevices(napi_env env, napi_callback_info info) {
  (void)info;
  std::vector<CameraDevice> list;
  EnsureCameraThread();
  list = ListMfCameraDevices();
  return DevicesToJs(env, list);
}

napi_value StopCapture(napi_env env, napi_callback_info info) {
  (void)info;
  RequestCaptureAbort();
  RunOnCameraThreadWithTimeout([&]() { GetMfCamera().ReleaseResources(); }, 8000, "stopCapture");
  napi_value u = nullptr;
  napi_get_undefined(env, &u);
  return u;
}

napi_value IsCaptureOpen(napi_env env, napi_callback_info info) {
  (void)info;
  const bool open = GetMfCamera().IsOpen();
  napi_value result = nullptr;
  napi_get_boolean(env, open, &result);
  return result;
}

napi_value GetPreviewFrameGeneration(napi_env env, napi_callback_info info) {
  (void)info;
  const uint64_t generation = GetMfCamera().PreviewFrameGeneration();
  napi_value result = nullptr;
  napi_create_double(env, static_cast<double>(generation), &result);
  return result;
}

napi_value GetRawFrameGeneration(napi_env env, napi_callback_info info) {
  (void)info;
  const uint64_t generation = GetMfCamera().RawFrameGeneration();
  napi_value result = nullptr;
  napi_create_double(env, static_cast<double>(generation), &result);
  return result;
}

struct GrabFrameAsyncWork {
  napi_deferred deferred = nullptr;
  napi_async_work work = nullptr;
  std::string mode;
  int32_t grab_preview_max = 960;
  std::vector<uint8_t> preview;
  std::vector<uint8_t> source;
  bool source_is_png = false;
  int source_width = 0;
  int source_height = 0;
  bool has_frame = false;
  std::string error;
};

static void ExecuteGrabFrameAsync(napi_env env, void* data) {
  (void)env;
  auto* w = static_cast<GrabFrameAsyncWork*>(data);
  RunOnCameraThreadWithTimeout(
      [&]() {
        MfCamera& cam = GetMfCamera();
        if (!cam.IsOpen()) {
          w->error = "camera_not_open";
          return;
        }
        if (cam.GrabStill(w->mode, w->preview, w->source, w->source_is_png, w->grab_preview_max, w->source_width,
                          w->source_height) &&
            !w->preview.empty() && !w->source.empty()) {
          w->has_frame = true;
        } else if (w->error.empty()) {
          w->error = cam.LastError().empty() ? "grab_failed" : cam.LastError();
        }
      },
      10000, "grabFrameAsync");
}

static void CompleteGrabFrameAsync(napi_env env, napi_status status, void* data) {
  auto* w = static_cast<GrabFrameAsyncWork*>(data);
  if (status != napi_ok) {
    w->error = "Async worker failed";
  }
  if (!w->error.empty()) {
    napi_value err = nullptr;
    napi_create_string_utf8(env, w->error.c_str(), NAPI_AUTO_LENGTH, &err);
    napi_reject_deferred(env, w->deferred, err);
  } else if (!w->has_frame) {
    const std::string detail = w->error.empty() ? "grab_failed" : w->error;
    napi_value err = nullptr;
    napi_create_string_utf8(env, detail.c_str(), NAPI_AUTO_LENGTH, &err);
    napi_reject_deferred(env, w->deferred, err);
  } else {
    std::fprintf(stderr, "[camera_mf] grabFrameAsync: delivering preview=%zu source=%zu bytes (%dx%d)\n",
                 w->preview.size(), w->source.size(), w->source_width, w->source_height);
    napi_value out = nullptr;
    if (!BuildGrabResultObject(env, w->preview, w->source, w->source_is_png, w->source_width, w->source_height, &out)) {
      napi_value err = nullptr;
      napi_create_string_utf8(env, "grab result", NAPI_AUTO_LENGTH, &err);
      napi_reject_deferred(env, w->deferred, err);
    } else {
      napi_resolve_deferred(env, w->deferred, out);
    }
  }
  napi_delete_async_work(env, w->work);
  delete w;
}

napi_value GrabFrameAsync(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  auto* w = new GrabFrameAsyncWork();
  if (argc >= 1) {
    w->mode = ArgUtf8(env, args[0]);
  }
  if (argc >= 2) {
    w->grab_preview_max = static_cast<int32_t>(ParseBoundedIntProperty(env, args[1], "capturePreviewMaxLongEdge", 960, 320, 1920));
  }
  napi_value promise = nullptr;
  if (napi_create_promise(env, &w->deferred, &promise) != napi_ok) {
    delete w;
    ThrowErr(env, "create promise");
    return nullptr;
  }
  napi_value name = nullptr;
  napi_create_string_utf8(env, "grabFrameAsync", NAPI_AUTO_LENGTH, &name);
  if (napi_create_async_work(env, nullptr, name, ExecuteGrabFrameAsync, CompleteGrabFrameAsync, w, &w->work) != napi_ok) {
    delete w;
    ThrowErr(env, "create async work");
    return nullptr;
  }
  napi_queue_async_work(env, w->work);
  return promise;
}

napi_value GetCameraCapabilities(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value out = nullptr;
  if (napi_create_object(env, &out) != napi_ok) {
    ThrowErr(env, "caps object");
    return nullptr;
  }
  std::map<std::string, CameraNumCap> caps;
  RunOnCameraThreadWithTimeout(
      [&]() {
        MfCamera& cam = GetMfCamera();
        if (cam.IsOpen()) {
          cam.GetCapabilities(caps);
        }
      },
      3000, "getCapabilities");
  for (const auto& kv : caps) {
    if (!SetNumCapOnObject(env, out, kv.first.c_str(), std::get<0>(kv.second), std::get<1>(kv.second),
                           std::get<2>(kv.second))) {
      ThrowErr(env, "cap entry");
      return nullptr;
    }
  }
  return out;
}

napi_value GetCameraControls(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value out = nullptr;
  if (napi_create_object(env, &out) != napi_ok) {
    ThrowErr(env, "controls object");
    return nullptr;
  }
  std::map<std::string, double> vals;
  RunOnCameraThreadWithTimeout(
      [&]() {
        MfCamera& cam = GetMfCamera();
        if (cam.IsOpen()) {
          cam.GetControlValues(vals);
        }
      },
      3000, "getControls");
  for (const auto& kv : vals) {
    napi_value k = nullptr;
    napi_value v = nullptr;
    if (napi_create_string_utf8(env, kv.first.c_str(), NAPI_AUTO_LENGTH, &k) != napi_ok ||
        napi_create_double(env, kv.second, &v) != napi_ok) {
      ThrowErr(env, "control entry");
      return nullptr;
    }
    napi_set_property(env, out, k, v);
  }
  return out;
}

napi_value SetCameraControls(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1 || args[0] == nullptr) {
    ThrowErr(env, "partial object required");
    return nullptr;
  }
  napi_valuetype t;
  if (napi_typeof(env, args[0], &t) != napi_ok || t != napi_object) {
    ThrowErr(env, "partial must be object");
    return nullptr;
  }
  napi_value names = nullptr;
  if (napi_get_property_names(env, args[0], &names) != napi_ok) {
    ThrowErr(env, "property names");
    return nullptr;
  }
  uint32_t n = 0;
  if (napi_get_array_length(env, names, &n) != napi_ok) {
    ThrowErr(env, "array length");
    return nullptr;
  }
  std::map<std::string, double> partial;
  for (uint32_t i = 0; i < n; i++) {
    napi_value key = nullptr;
    napi_value val = nullptr;
    if (napi_get_element(env, names, i, &key) != napi_ok || napi_get_property(env, args[0], key, &val) != napi_ok) {
      continue;
    }
    const std::string k = ArgUtf8(env, key);
    if (k.empty()) {
      continue;
    }
    double d = 0;
    if (napi_get_value_double(env, val, &d) != napi_ok) {
      continue;
    }
    partial[k] = d;
  }
  napi_value result = nullptr;
  if (napi_create_object(env, &result) != napi_ok) {
    ThrowErr(env, "result");
    return nullptr;
  }
  CameraControlApplyResult apply;
  RunOnCameraThreadWithTimeout(
      [&]() {
        MfCamera& cam = GetMfCamera();
        if (cam.IsOpen()) {
          apply = cam.SetControlValues(partial);
        }
      },
      5000, "setControls");
  napi_value applied = nullptr;
  napi_value failed = nullptr;
  napi_value ignored = nullptr;
  napi_value unsupported = nullptr;
  napi_create_array_with_length(env, apply.applied.size(), &applied);
  napi_create_object(env, &failed);
  napi_create_array_with_length(env, apply.ignoredUnknown.size(), &ignored);
  napi_create_array_with_length(env, apply.unsupported.size(), &unsupported);
  for (size_t i = 0; i < apply.applied.size(); i++) {
    napi_value v = nullptr;
    napi_create_string_utf8(env, apply.applied[i].c_str(), NAPI_AUTO_LENGTH, &v);
    napi_set_element(env, applied, static_cast<uint32_t>(i), v);
  }
  for (const auto& kv : apply.failed) {
    napi_value msg = nullptr;
    napi_create_string_utf8(env, kv.second.c_str(), NAPI_AUTO_LENGTH, &msg);
    napi_set_named_property(env, failed, kv.first.c_str(), msg);
  }
  for (size_t i = 0; i < apply.ignoredUnknown.size(); i++) {
    napi_value v = nullptr;
    napi_create_string_utf8(env, apply.ignoredUnknown[i].c_str(), NAPI_AUTO_LENGTH, &v);
    napi_set_element(env, ignored, static_cast<uint32_t>(i), v);
  }
  for (size_t i = 0; i < apply.unsupported.size(); i++) {
    napi_value v = nullptr;
    napi_create_string_utf8(env, apply.unsupported[i].c_str(), NAPI_AUTO_LENGTH, &v);
    napi_set_element(env, unsupported, static_cast<uint32_t>(i), v);
  }
  napi_set_named_property(env, result, "applied", applied);
  napi_set_named_property(env, result, "failed", failed);
  napi_set_named_property(env, result, "ignoredUnknown", ignored);
  napi_set_named_property(env, result, "unsupported", unsupported);
  return result;
}
