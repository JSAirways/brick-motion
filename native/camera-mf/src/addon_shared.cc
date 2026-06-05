#include "addon_shared.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <objbase.h>

#include <cstdio>

void ThrowErr(napi_env env, const char* msg) {
  napi_value err = nullptr;
  napi_create_string_utf8(env, msg, NAPI_AUTO_LENGTH, &err);
  napi_throw(env, err);
}

std::string ArgUtf8(napi_env env, napi_value value) {
  size_t len = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &len);
  std::string out(len, '\0');
  size_t written = 0;
  napi_get_value_string_utf8(env, value, out.data(), len + 1, &written);
  out.resize(written);
  return out;
}

int32_t ParseBoundedIntProperty(napi_env env, napi_value obj, const char* key, int32_t fallback, int32_t min,
                                int32_t max) {
  napi_value prop = nullptr;
  if (napi_get_named_property(env, obj, key, &prop) != napi_ok) {
    return fallback;
  }
  napi_valuetype t;
  if (napi_typeof(env, prop, &t) != napi_ok || t != napi_number) {
    return fallback;
  }
  double v = fallback;
  napi_get_value_double(env, prop, &v);
  if (v < min) {
    return min;
  }
  if (v > max) {
    return max;
  }
  return static_cast<int32_t>(v);
}

ComScope::ComScope() {
  const HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (SUCCEEDED(hr)) {
    needs_uninit_ = true;
    ok_ = true;
  } else if (hr == RPC_E_CHANGED_MODE) {
    ok_ = true;
  } else {
    std::fprintf(stderr, "[camera_mf] CoInitializeEx failed: 0x%08lx\n", static_cast<unsigned long>(hr));
  }
}

ComScope::~ComScope() {
  if (needs_uninit_) {
    CoUninitialize();
  }
}

bool SetNumCapOnObject(napi_env env, napi_value caps_obj, const char* key, double mn, double mx, double st) {
  napi_value cap = nullptr;
  napi_create_object(env, &cap);
  napi_value vmin = nullptr;
  napi_value vmax = nullptr;
  napi_value vstep = nullptr;
  napi_create_double(env, mn, &vmin);
  napi_create_double(env, mx, &vmax);
  napi_create_double(env, st, &vstep);
  napi_set_named_property(env, cap, "min", vmin);
  napi_set_named_property(env, cap, "max", vmax);
  napi_set_named_property(env, cap, "step", vstep);
  return napi_set_named_property(env, caps_obj, key, cap) == napi_ok;
}

bool BuildCaptureProfileObject(napi_env env, const uint32_t width, const uint32_t height,
                               const uint32_t subtype_data1, const uint64_t pixel_area, napi_value* out) {
  napi_create_object(env, out);
  napi_value w = nullptr;
  napi_value h = nullptr;
  napi_value subtype = nullptr;
  napi_value area = nullptr;
  napi_create_uint32(env, width, &w);
  napi_create_uint32(env, height, &h);
  napi_create_uint32(env, subtype_data1, &subtype);
  napi_create_double(env, static_cast<double>(pixel_area), &area);
  napi_set_named_property(env, *out, "width", w);
  napi_set_named_property(env, *out, "height", h);
  napi_set_named_property(env, *out, "subtypeFourcc", subtype);
  napi_set_named_property(env, *out, "pixelArea", area);
  return true;
}

bool BuildGrabResultObject(napi_env env, const std::vector<uint8_t>& preview, const std::vector<uint8_t>& source,
                           const bool source_is_png, const int source_width, const int source_height, napi_value* out) {
  napi_create_object(env, out);
  napi_value preview_buf = nullptr;
  void* preview_data = nullptr;
  napi_create_buffer_copy(env, preview.size(), preview.data(), &preview_data, &preview_buf);
  napi_set_named_property(env, *out, "preview", preview_buf);
  napi_value source_buf = nullptr;
  void* source_data = nullptr;
  napi_create_buffer_copy(env, source.size(), source.data(), &source_data, &source_buf);
  napi_set_named_property(env, *out, "source", source_buf);
  napi_value png_flag = nullptr;
  napi_get_boolean(env, source_is_png, &png_flag);
  napi_set_named_property(env, *out, "sourceIsPng", png_flag);
  napi_value sw = nullptr;
  napi_value sh = nullptr;
  napi_create_int32(env, source_width, &sw);
  napi_create_int32(env, source_height, &sh);
  napi_set_named_property(env, *out, "sourceWidth", sw);
  napi_set_named_property(env, *out, "sourceHeight", sh);
  return true;
}

napi_value DevicesToJs(napi_env env, const std::vector<CameraDevice>& devices) {
  napi_value arr = nullptr;
  napi_create_array_with_length(env, devices.size(), &arr);
  for (size_t i = 0; i < devices.size(); ++i) {
    napi_value row = nullptr;
    napi_create_object(env, &row);
    napi_value id = nullptr;
    napi_value label = nullptr;
    napi_create_string_utf8(env, devices[i].id.c_str(), NAPI_AUTO_LENGTH, &id);
    napi_create_string_utf8(env, devices[i].label.c_str(), NAPI_AUTO_LENGTH, &label);
    napi_set_named_property(env, row, "id", id);
    napi_set_named_property(env, row, "label", label);
    napi_set_element(env, arr, static_cast<uint32_t>(i), row);
  }
  return arr;
}
