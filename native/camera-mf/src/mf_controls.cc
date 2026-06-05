#include "mf_controls.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <mfidl.h>
#include <strmif.h>

#include <algorithm>
#include <cmath>
#include <map>

namespace {

double QuantizeToRange(double v, double mn, double mx, double step) {
  if (!(mx >= mn)) {
    return mn;
  }
  v = std::max(mn, std::min(mx, v));
  if (step > 0) {
    const double q = std::llround((v - mn) / step) * step + mn;
    v = std::max(mn, std::min(mx, q));
  }
  return v;
}

struct ProcAmpEntry {
  long prop;
  const char* key;
};

struct CamCtrlEntry {
  long prop;
  const char* key;
};

constexpr ProcAmpEntry kProcAmpMap[] = {
    {VideoProcAmp_Brightness, "brightness"},
    {VideoProcAmp_Contrast, "contrast"},
    {VideoProcAmp_Saturation, "saturation"},
    {VideoProcAmp_Sharpness, "sharpness"},
    {VideoProcAmp_WhiteBalance, "colorTemperature"},
    {VideoProcAmp_Gain, "gain"},
};

constexpr CamCtrlEntry kCamCtrlMap[] = {
    {CameraControl_Exposure, "exposureTime"},
    {CameraControl_Focus, "focusDistance"},
    {CameraControl_Zoom, "zoom"},
    {CameraControl_Pan, "pan"},
    {CameraControl_Tilt, "tilt"},
};

HRESULT TryGetProcAmpRange(IAMVideoProcAmp* pa, long prop, long& mn, long& mx, long& step, long& def, long& caps) {
  return pa->GetRange(prop, &mn, &mx, &step, &def, &caps);
}

HRESULT TryGetCamRange(IAMCameraControl* cc, long prop, long& mn, long& mx, long& step, long& def, long& caps) {
  return cc->GetRange(prop, &mn, &mx, &step, &def, &caps);
}

bool TrySetProcAmp(IAMVideoProcAmp* pa, long prop, long value) {
  long flags = 0;
  long cur = 0;
  if (FAILED(pa->Get(prop, &cur, &flags))) {
    flags = VideoProcAmp_Flags_Manual;
  }
  HRESULT hr = pa->Set(prop, value, VideoProcAmp_Flags_Manual);
  if (FAILED(hr)) {
    hr = pa->Set(prop, value, flags);
  }
  if (FAILED(hr)) {
    hr = pa->Set(prop, value, 0);
  }
  return SUCCEEDED(hr);
}

bool TrySetCameraControl(IAMCameraControl* cc, long prop, long value) {
  long flags = 0;
  long cur = 0;
  if (FAILED(cc->Get(prop, &cur, &flags))) {
    flags = CameraControl_Flags_Manual;
  }
  HRESULT hr = cc->Set(prop, value, CameraControl_Flags_Manual);
  if (FAILED(hr)) {
    hr = cc->Set(prop, value, flags);
  }
  if (FAILED(hr)) {
    hr = cc->Set(prop, value, 0);
  }
  return SUCCEEDED(hr);
}

void TryForceProcAmpManual(IAMVideoProcAmp* pa, long prop) {
  if (!pa) {
    return;
  }
  long value = 0;
  long flags = 0;
  if (FAILED(pa->Get(prop, &value, &flags))) {
    return;
  }
  HRESULT hr = pa->Set(prop, value, VideoProcAmp_Flags_Manual);
  if (FAILED(hr)) {
    pa->Set(prop, value, flags);
  }
}

void TryForceCameraControlManual(IAMCameraControl* cc, long prop) {
  if (!cc) {
    return;
  }
  long value = 0;
  long flags = 0;
  if (FAILED(cc->Get(prop, &value, &flags))) {
    return;
  }
  HRESULT hr = cc->Set(prop, value, CameraControl_Flags_Manual);
  if (FAILED(hr)) {
    cc->Set(prop, value, flags);
  }
}

bool QueryControlInterfaces(IMFMediaSource* source, IAMVideoProcAmp** pa, IAMCameraControl** cc) {
  if (!source) {
    return false;
  }
  *pa = nullptr;
  *cc = nullptr;
  source->QueryInterface(IID_IAMVideoProcAmp, reinterpret_cast<void**>(pa));
  source->QueryInterface(IID_IAMCameraControl, reinterpret_cast<void**>(cc));
  return *pa != nullptr || *cc != nullptr;
}

}  // namespace

void ForceManualCameraModes(IMFMediaSource* source) {
  IAMVideoProcAmp* pa = nullptr;
  IAMCameraControl* cc = nullptr;
  if (!QueryControlInterfaces(source, &pa, &cc)) {
    return;
  }
  if (pa) {
    TryForceProcAmpManual(pa, VideoProcAmp_WhiteBalance);
    TryForceProcAmpManual(pa, VideoProcAmp_Gain);
    TryForceProcAmpManual(pa, VideoProcAmp_BacklightCompensation);
    pa->Release();
  }
  if (cc) {
    TryForceCameraControlManual(cc, CameraControl_Exposure);
    TryForceCameraControlManual(cc, CameraControl_Focus);
    cc->Release();
  }
}

bool GetMfControlCapabilities(IMFMediaSource* source, std::map<std::string, CameraNumCap>& out) {
  out.clear();
  IAMVideoProcAmp* pa = nullptr;
  IAMCameraControl* cc = nullptr;
  if (!QueryControlInterfaces(source, &pa, &cc)) {
    return false;
  }
  if (pa) {
    for (const auto& e : kProcAmpMap) {
      long mn = 0;
      long mx = 0;
      long step = 0;
      long def = 0;
      long caps = 0;
      if (SUCCEEDED(TryGetProcAmpRange(pa, e.prop, mn, mx, step, def, caps))) {
        out[e.key] = CameraNumCap(static_cast<double>(mn), static_cast<double>(mx), static_cast<double>(step));
        if (e.prop == VideoProcAmp_Gain) {
          out["iso"] = out["gain"];
          out["sensitivity"] = out["gain"];
        }
      }
    }
    pa->Release();
  }
  if (cc) {
    for (const auto& e : kCamCtrlMap) {
      long mn = 0;
      long mx = 0;
      long step = 0;
      long def = 0;
      long caps = 0;
      if (SUCCEEDED(TryGetCamRange(cc, e.prop, mn, mx, step, def, caps))) {
        out[e.key] = CameraNumCap(static_cast<double>(mn), static_cast<double>(mx), static_cast<double>(step));
        if (e.prop == CameraControl_Exposure) {
          out["exposureCompensation"] = out[e.key];
        }
      }
    }
    cc->Release();
  }
  return true;
}

bool GetMfControlValues(IMFMediaSource* source, std::map<std::string, double>& out) {
  out.clear();
  IAMVideoProcAmp* pa = nullptr;
  IAMCameraControl* cc = nullptr;
  if (!QueryControlInterfaces(source, &pa, &cc)) {
    return false;
  }
  if (pa) {
    for (const auto& e : kProcAmpMap) {
      long v = 0;
      long flags = 0;
      if (SUCCEEDED(pa->Get(e.prop, &v, &flags))) {
        out[e.key] = static_cast<double>(v);
        if (e.prop == VideoProcAmp_Gain) {
          out["iso"] = static_cast<double>(v);
          out["sensitivity"] = static_cast<double>(v);
        }
      }
    }
    pa->Release();
  }
  if (cc) {
    for (const auto& e : kCamCtrlMap) {
      long v = 0;
      long flags = 0;
      if (SUCCEEDED(cc->Get(e.prop, &v, &flags))) {
        out[e.key] = static_cast<double>(v);
        if (e.prop == CameraControl_Exposure) {
          out["exposureCompensation"] = static_cast<double>(v);
        }
      }
    }
    cc->Release();
  }
  return true;
}

CameraControlApplyResult SetMfControlValues(IMFMediaSource* source, const std::map<std::string, double>& partial) {
  CameraControlApplyResult result;
  IAMVideoProcAmp* pa = nullptr;
  IAMCameraControl* cc = nullptr;
  if (!QueryControlInterfaces(source, &pa, &cc)) {
    result.failed["*"] = "media source controls not available";
    return result;
  }

  enum class Family { ProcAmp, CameraControl };
  struct ControlBinding {
    Family family;
    long prop;
  };
  static const std::map<std::string, ControlBinding> kBindings = {
      {"brightness", {Family::ProcAmp, VideoProcAmp_Brightness}},
      {"contrast", {Family::ProcAmp, VideoProcAmp_Contrast}},
      {"saturation", {Family::ProcAmp, VideoProcAmp_Saturation}},
      {"sharpness", {Family::ProcAmp, VideoProcAmp_Sharpness}},
      {"gain", {Family::ProcAmp, VideoProcAmp_Gain}},
      {"iso", {Family::ProcAmp, VideoProcAmp_Gain}},
      {"sensitivity", {Family::ProcAmp, VideoProcAmp_Gain}},
      {"colorTemperature", {Family::ProcAmp, VideoProcAmp_WhiteBalance}},
      {"whiteBalance", {Family::ProcAmp, VideoProcAmp_WhiteBalance}},
      {"exposureTime", {Family::CameraControl, CameraControl_Exposure}},
      {"exposureCompensation", {Family::CameraControl, CameraControl_Exposure}},
      {"focusDistance", {Family::CameraControl, CameraControl_Focus}},
      {"zoom", {Family::CameraControl, CameraControl_Zoom}},
      {"pan", {Family::CameraControl, CameraControl_Pan}},
      {"tilt", {Family::CameraControl, CameraControl_Tilt}},
  };

  auto applyProc = [&](const std::string& key, long prop, double req) {
    if (!pa) {
      result.unsupported.push_back(key);
      return;
    }
    long mn = 0;
    long mx = 0;
    long step = 0;
    long def = 0;
    long caps = 0;
    if (FAILED(TryGetProcAmpRange(pa, prop, mn, mx, step, def, caps))) {
      result.unsupported.push_back(key);
      return;
    }
    const double q = QuantizeToRange(req, static_cast<double>(mn), static_cast<double>(mx), static_cast<double>(step));
    if (!TrySetProcAmp(pa, prop, static_cast<long>(std::llround(q)))) {
      result.failed[key] = "driver rejected value";
      return;
    }
    result.applied.push_back(key);
  };

  auto applyCam = [&](const std::string& key, long prop, double req) {
    if (!cc) {
      result.unsupported.push_back(key);
      return;
    }
    long mn = 0;
    long mx = 0;
    long step = 0;
    long def = 0;
    long caps = 0;
    if (FAILED(TryGetCamRange(cc, prop, mn, mx, step, def, caps))) {
      result.unsupported.push_back(key);
      return;
    }
    const double q = QuantizeToRange(req, static_cast<double>(mn), static_cast<double>(mx), static_cast<double>(step));
    if (!TrySetCameraControl(cc, prop, static_cast<long>(std::llround(q)))) {
      result.failed[key] = "driver rejected value";
      return;
    }
    result.applied.push_back(key);
  };

  for (const auto& kv : partial) {
    const auto it = kBindings.find(kv.first);
    if (it == kBindings.end()) {
      result.ignoredUnknown.push_back(kv.first);
      continue;
    }
    if (it->second.family == Family::ProcAmp) {
      applyProc(kv.first, it->second.prop, kv.second);
    } else {
      applyCam(kv.first, it->second.prop, kv.second);
    }
  }

  if (pa) {
    pa->Release();
  }
  if (cc) {
    cc->Release();
  }
  return result;
}
