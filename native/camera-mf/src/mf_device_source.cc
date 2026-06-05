#include "mf_device_source.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <mfapi.h>
#include <mfidl.h>

#include <cstdio>
#include <string>

bool CreateMfDeviceSource(const std::wstring& symbolic_link, IMFMediaSource** out_source, std::string& error_out) {
  error_out.clear();
  if (!out_source || symbolic_link.empty()) {
    error_out = "invalid device source parameters";
    return false;
  }
  *out_source = nullptr;

  IMFAttributes* attrs = nullptr;
  HRESULT hr = MFCreateAttributes(&attrs, 2);
  if (FAILED(hr) || !attrs) {
    char buf[96];
    std::snprintf(buf, sizeof(buf), "MFCreateAttributes failed: 0x%08lx", static_cast<unsigned long>(hr));
    error_out = buf;
    return false;
  }
  attrs->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);
  attrs->SetString(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, symbolic_link.c_str());

  IMFMediaSource* source = nullptr;
  hr = MFCreateDeviceSource(attrs, &source);
  attrs->Release();

  if (FAILED(hr) || !source) {
    char buf[128];
    std::snprintf(buf, sizeof(buf), "MFCreateDeviceSource failed: 0x%08lx", static_cast<unsigned long>(hr));
    error_out = buf;
    std::fprintf(stderr, "[camera_mf] %s\n", error_out.c_str());
    return false;
  }

  *out_source = source;
  return true;
}
