#include "addon_shared.h"
#include "camera_thread.h"
#include "mf_camera.h"
#include "mf_capture_control.h"
#include "mf_controls.h"

#include <map>

namespace {

napi_value BuildSetControlsResult(napi_env env, const CameraControlApplyResult& apply) {
  napi_value result = nullptr;
  napi_create_object(env, &result);
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

napi_value BuildCapabilitiesObject(napi_env env, const std::map<std::string, CameraNumCap>& caps) {
  napi_value out = nullptr;
  napi_create_object(env, &out);
  for (const auto& kv : caps) {
    if (!SetNumCapOnObject(env, out, kv.first.c_str(), std::get<0>(kv.second), std::get<1>(kv.second),
                           std::get<2>(kv.second))) {
      return nullptr;
    }
  }
  return out;
}

napi_value BuildControlsObject(napi_env env, const std::map<std::string, double>& vals) {
  napi_value out = nullptr;
  napi_create_object(env, &out);
  for (const auto& kv : vals) {
    napi_value k = nullptr;
    napi_value v = nullptr;
    if (napi_create_string_utf8(env, kv.first.c_str(), NAPI_AUTO_LENGTH, &k) != napi_ok ||
        napi_create_double(env, kv.second, &v) != napi_ok) {
      return nullptr;
    }
    napi_set_property(env, out, k, v);
  }
  return out;
}

struct ListDevicesAsyncWork {
  napi_deferred deferred = nullptr;
  napi_async_work work = nullptr;
  std::vector<CameraDevice> list;
  std::string error;
};

static void ExecuteListDevicesAsync(napi_env env, void* data) {
  (void)env;
  auto* w = static_cast<ListDevicesAsyncWork*>(data);
  EnsureCameraThread();
  w->list = ListMfCameraDevices();
}

static void CompleteListDevicesAsync(napi_env env, napi_status status, void* data) {
  auto* w = static_cast<ListDevicesAsyncWork*>(data);
  if (status != napi_ok) {
    w->error = "Async worker failed";
  }
  if (!w->error.empty()) {
    napi_value err = nullptr;
    napi_create_string_utf8(env, w->error.c_str(), NAPI_AUTO_LENGTH, &err);
    napi_reject_deferred(env, w->deferred, err);
  } else {
    napi_value arr = DevicesToJs(env, w->list);
    napi_resolve_deferred(env, w->deferred, arr);
  }
  napi_delete_async_work(env, w->work);
  delete w;
}

struct VoidAsyncWork {
  napi_deferred deferred = nullptr;
  napi_async_work work = nullptr;
  std::string error;
};

static void ExecuteStopCaptureAsync(napi_env env, void* data) {
  (void)env;
  auto* w = static_cast<VoidAsyncWork*>(data);
  (void)w;
  RequestCaptureAbort();
  if (!RunOnCameraThreadWithTimeout([&]() { GetMfCamera().ReleaseResources(); }, 8000, "stopCaptureAsync")) {
    w->error = "camera thread stop timed out";
  }
}

static void CompleteVoidAsync(napi_env env, napi_status status, void* data) {
  auto* w = static_cast<VoidAsyncWork*>(data);
  if (status != napi_ok) {
    w->error = "Async worker failed";
  }
  if (!w->error.empty()) {
    napi_value err = nullptr;
    napi_create_string_utf8(env, w->error.c_str(), NAPI_AUTO_LENGTH, &err);
    napi_reject_deferred(env, w->deferred, err);
  } else {
    napi_value u = nullptr;
    napi_get_undefined(env, &u);
    napi_resolve_deferred(env, w->deferred, u);
  }
  napi_delete_async_work(env, w->work);
  delete w;
}

struct CapsAsyncWork {
  napi_deferred deferred = nullptr;
  napi_async_work work = nullptr;
  std::map<std::string, CameraNumCap> caps;
  std::string error;
};

static void ExecuteGetCapabilitiesAsync(napi_env env, void* data) {
  (void)env;
  auto* w = static_cast<CapsAsyncWork*>(data);
  RunOnCameraThread([&]() {
    MfCamera& cam = GetMfCamera();
    if (cam.IsOpen()) {
      cam.GetCapabilities(w->caps);
    }
  });
}

static void CompleteGetCapabilitiesAsync(napi_env env, napi_status status, void* data) {
  auto* w = static_cast<CapsAsyncWork*>(data);
  if (status != napi_ok) {
    w->error = "Async worker failed";
  }
  if (!w->error.empty()) {
    napi_value err = nullptr;
    napi_create_string_utf8(env, w->error.c_str(), NAPI_AUTO_LENGTH, &err);
    napi_reject_deferred(env, w->deferred, err);
  } else {
    napi_value out = BuildCapabilitiesObject(env, w->caps);
    if (!out) {
      napi_value err = nullptr;
      napi_create_string_utf8(env, "caps object", NAPI_AUTO_LENGTH, &err);
      napi_reject_deferred(env, w->deferred, err);
    } else {
      napi_resolve_deferred(env, w->deferred, out);
    }
  }
  napi_delete_async_work(env, w->work);
  delete w;
}

struct ControlsAsyncWork {
  napi_deferred deferred = nullptr;
  napi_async_work work = nullptr;
  std::map<std::string, double> vals;
  std::string error;
};

static void ExecuteGetControlsAsync(napi_env env, void* data) {
  (void)env;
  auto* w = static_cast<ControlsAsyncWork*>(data);
  RunOnCameraThread([&]() {
    MfCamera& cam = GetMfCamera();
    if (cam.IsOpen()) {
      cam.GetControlValues(w->vals);
    }
  });
}

static void CompleteGetControlsAsync(napi_env env, napi_status status, void* data) {
  auto* w = static_cast<ControlsAsyncWork*>(data);
  if (status != napi_ok) {
    w->error = "Async worker failed";
  }
  if (!w->error.empty()) {
    napi_value err = nullptr;
    napi_create_string_utf8(env, w->error.c_str(), NAPI_AUTO_LENGTH, &err);
    napi_reject_deferred(env, w->deferred, err);
  } else {
    napi_value out = BuildControlsObject(env, w->vals);
    if (!out) {
      napi_value err = nullptr;
      napi_create_string_utf8(env, "controls object", NAPI_AUTO_LENGTH, &err);
      napi_reject_deferred(env, w->deferred, err);
    } else {
      napi_resolve_deferred(env, w->deferred, out);
    }
  }
  napi_delete_async_work(env, w->work);
  delete w;
}

struct SetControlsAsyncWork {
  napi_deferred deferred = nullptr;
  napi_async_work work = nullptr;
  std::map<std::string, double> partial;
  CameraControlApplyResult apply;
  std::string error;
};

static void ExecuteSetControlsAsync(napi_env env, void* data) {
  (void)env;
  auto* w = static_cast<SetControlsAsyncWork*>(data);
  RunOnCameraThread([&]() {
    MfCamera& cam = GetMfCamera();
    if (cam.IsOpen()) {
      w->apply = cam.SetControlValues(w->partial);
    }
  });
}

static void CompleteSetControlsAsync(napi_env env, napi_status status, void* data) {
  auto* w = static_cast<SetControlsAsyncWork*>(data);
  if (status != napi_ok) {
    w->error = "Async worker failed";
  }
  if (!w->error.empty()) {
    napi_value err = nullptr;
    napi_create_string_utf8(env, w->error.c_str(), NAPI_AUTO_LENGTH, &err);
    napi_reject_deferred(env, w->deferred, err);
  } else {
    napi_value out = BuildSetControlsResult(env, w->apply);
    napi_resolve_deferred(env, w->deferred, out);
  }
  napi_delete_async_work(env, w->work);
  delete w;
}

}  // namespace

napi_value ListDevicesAsync(napi_env env, napi_callback_info info) {
  (void)info;
  auto* w = new ListDevicesAsyncWork();
  napi_value promise = nullptr;
  if (napi_create_promise(env, &w->deferred, &promise) != napi_ok) {
    delete w;
    ThrowErr(env, "create promise");
    return nullptr;
  }
  napi_value name = nullptr;
  napi_create_string_utf8(env, "listDevicesAsync", NAPI_AUTO_LENGTH, &name);
  if (napi_create_async_work(env, nullptr, name, ExecuteListDevicesAsync, CompleteListDevicesAsync, w, &w->work) !=
      napi_ok) {
    delete w;
    ThrowErr(env, "create async work");
    return nullptr;
  }
  napi_queue_async_work(env, w->work);
  return promise;
}

napi_value StopCaptureAsync(napi_env env, napi_callback_info info) {
  (void)info;
  auto* w = new VoidAsyncWork();
  napi_value promise = nullptr;
  if (napi_create_promise(env, &w->deferred, &promise) != napi_ok) {
    delete w;
    ThrowErr(env, "create promise");
    return nullptr;
  }
  napi_value name = nullptr;
  napi_create_string_utf8(env, "stopCaptureAsync", NAPI_AUTO_LENGTH, &name);
  if (napi_create_async_work(env, nullptr, name, ExecuteStopCaptureAsync, CompleteVoidAsync, w, &w->work) != napi_ok) {
    delete w;
    ThrowErr(env, "create async work");
    return nullptr;
  }
  napi_queue_async_work(env, w->work);
  return promise;
}

napi_value GetCameraCapabilitiesAsync(napi_env env, napi_callback_info info) {
  (void)info;
  auto* w = new CapsAsyncWork();
  napi_value promise = nullptr;
  if (napi_create_promise(env, &w->deferred, &promise) != napi_ok) {
    delete w;
    ThrowErr(env, "create promise");
    return nullptr;
  }
  napi_value name = nullptr;
  napi_create_string_utf8(env, "getCapabilitiesAsync", NAPI_AUTO_LENGTH, &name);
  if (napi_create_async_work(env, nullptr, name, ExecuteGetCapabilitiesAsync, CompleteGetCapabilitiesAsync, w,
                             &w->work) != napi_ok) {
    delete w;
    ThrowErr(env, "create async work");
    return nullptr;
  }
  napi_queue_async_work(env, w->work);
  return promise;
}

napi_value GetCameraControlsAsync(napi_env env, napi_callback_info info) {
  (void)info;
  auto* w = new ControlsAsyncWork();
  napi_value promise = nullptr;
  if (napi_create_promise(env, &w->deferred, &promise) != napi_ok) {
    delete w;
    ThrowErr(env, "create promise");
    return nullptr;
  }
  napi_value name = nullptr;
  napi_create_string_utf8(env, "getControlsAsync", NAPI_AUTO_LENGTH, &name);
  if (napi_create_async_work(env, nullptr, name, ExecuteGetControlsAsync, CompleteGetControlsAsync, w, &w->work) !=
      napi_ok) {
    delete w;
    ThrowErr(env, "create async work");
    return nullptr;
  }
  napi_queue_async_work(env, w->work);
  return promise;
}

napi_value SetCameraControlsAsync(napi_env env, napi_callback_info info) {
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
  auto* w = new SetControlsAsyncWork();
  napi_value names = nullptr;
  if (napi_get_property_names(env, args[0], &names) != napi_ok) {
    delete w;
    ThrowErr(env, "property names");
    return nullptr;
  }
  uint32_t n = 0;
  if (napi_get_array_length(env, names, &n) != napi_ok) {
    delete w;
    ThrowErr(env, "array length");
    return nullptr;
  }
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
    w->partial[k] = d;
  }
  napi_value promise = nullptr;
  if (napi_create_promise(env, &w->deferred, &promise) != napi_ok) {
    delete w;
    ThrowErr(env, "create promise");
    return nullptr;
  }
  napi_value name = nullptr;
  napi_create_string_utf8(env, "setControlsAsync", NAPI_AUTO_LENGTH, &name);
  if (napi_create_async_work(env, nullptr, name, ExecuteSetControlsAsync, CompleteSetControlsAsync, w, &w->work) !=
      napi_ok) {
    delete w;
    ThrowErr(env, "create async work");
    return nullptr;
  }
  napi_queue_async_work(env, w->work);
  return promise;
}
