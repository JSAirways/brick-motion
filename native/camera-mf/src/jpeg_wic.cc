#include "jpeg_wic.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <wincodec.h>

#include <algorithm>
#include <cmath>
#include <mutex>

namespace {
std::recursive_mutex& WicMutex() {
  static std::recursive_mutex mu;
  return mu;
}
}  // namespace

static IWICImagingFactory* WicFactory() {
  thread_local IWICImagingFactory* f = nullptr;
  if (!f) {
    CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_IWICImagingFactory,
                     reinterpret_cast<void**>(&f));
  }
  return f;
}

bool EncodeJpegWic(const uint8_t* bgr, int width, int height, int stride, std::vector<uint8_t>& out) {
  std::lock_guard<std::recursive_mutex> lock(WicMutex());
  IWICImagingFactory* fac = WicFactory();
  if (!fac || !bgr || width <= 0 || height <= 0) {
    return false;
  }
  IWICBitmap* bmp = nullptr;
  HRESULT hr = fac->CreateBitmapFromMemory(static_cast<UINT>(width), static_cast<UINT>(height),
                                           GUID_WICPixelFormat24bppBGR, static_cast<UINT>(stride),
                                           static_cast<UINT>(height * stride), const_cast<BYTE*>(bgr), &bmp);
  if (FAILED(hr) || !bmp) {
    return false;
  }
  HGLOBAL hg = GlobalAlloc(GMEM_MOVEABLE, 0);
  if (!hg) {
    bmp->Release();
    return false;
  }
  IStream* stream = nullptr;
  hr = CreateStreamOnHGlobal(hg, TRUE, &stream);
  if (FAILED(hr) || !stream) {
    GlobalFree(hg);
    bmp->Release();
    return false;
  }
  IWICBitmapEncoder* enc = nullptr;
  hr = fac->CreateEncoder(GUID_ContainerFormatJpeg, nullptr, &enc);
  if (FAILED(hr) || !enc) {
    stream->Release();
    bmp->Release();
    return false;
  }
  hr = enc->Initialize(stream, WICBitmapEncoderNoCache);
  if (FAILED(hr)) {
    enc->Release();
    stream->Release();
    bmp->Release();
    return false;
  }
  IWICBitmapFrameEncode* frame = nullptr;
  IPropertyBag2* props = nullptr;
  hr = enc->CreateNewFrame(&frame, &props);
  if (FAILED(hr) || !frame) {
    enc->Release();
    stream->Release();
    bmp->Release();
    return false;
  }
  if (props) {
    PROPBAG2 opt = {};
    opt.pstrName = const_cast<wchar_t*>(L"ImageQuality");
    VARIANT v;
    VariantInit(&v);
    v.vt = VT_R4;
    v.fltVal = 0.92f;
    props->Write(1, &opt, &v);
    props->Release();
  }
  hr = frame->Initialize(nullptr);
  if (FAILED(hr)) {
    frame->Release();
    enc->Release();
    stream->Release();
    bmp->Release();
    return false;
  }
  hr = frame->WriteSource(bmp, nullptr);
  bmp->Release();
  if (FAILED(hr)) {
    frame->Release();
    enc->Release();
    stream->Release();
    return false;
  }
  hr = frame->Commit();
  frame->Release();
  if (FAILED(hr)) {
    enc->Release();
    stream->Release();
    return false;
  }
  hr = enc->Commit();
  enc->Release();
  if (FAILED(hr)) {
    stream->Release();
    return false;
  }
  STATSTG st = {};
  hr = stream->Stat(&st, STATFLAG_NONAME);
  if (FAILED(hr) || st.cbSize.HighPart != 0) {
    stream->Release();
    return false;
  }
  out.resize(static_cast<size_t>(st.cbSize.LowPart));
  LARGE_INTEGER z{};
  hr = stream->Seek(z, STREAM_SEEK_SET, nullptr);
  if (FAILED(hr)) {
    stream->Release();
    return false;
  }
  ULONG rd = 0;
  hr = stream->Read(out.data(), static_cast<ULONG>(out.size()), &rd);
  stream->Release();
  return SUCCEEDED(hr) && rd == out.size();
}

bool EncodeJpegWicMaxLongEdge(const uint8_t* bgr, int width, int height, int stride, int max_long_edge,
                              std::vector<uint8_t>& out) {
  std::lock_guard<std::recursive_mutex> lock(WicMutex());
  if (!bgr || width <= 0 || height <= 0 || max_long_edge <= 0) {
    return EncodeJpegWic(bgr, width, height, stride, out);
  }
  const int cur = (std::max)(width, height);
  if (cur <= max_long_edge) {
    return EncodeJpegWic(bgr, width, height, stride, out);
  }
  const double scale = static_cast<double>(max_long_edge) / static_cast<double>(cur);
  const int nw = (std::max)(1, static_cast<int>(std::llround(width * scale)));
  const int nh = (std::max)(1, static_cast<int>(std::llround(height * scale)));
  const int dst_stride = ((nw * 3 + 3) & ~3);
  std::vector<uint8_t> buf(static_cast<size_t>(dst_stride * nh));
  for (int y = 0; y < nh; y++) {
    const int sy = (std::min)(height - 1, static_cast<int>((static_cast<double>(y) + 0.5) * height / nh));
    const uint8_t* src_row = bgr + sy * stride;
    uint8_t* dst_row = buf.data() + y * dst_stride;
    for (int x = 0; x < nw; x++) {
      const int sx = (std::min)(width - 1, static_cast<int>((static_cast<double>(x) + 0.5) * width / nw));
      dst_row[x * 3 + 0] = src_row[sx * 3 + 0];
      dst_row[x * 3 + 1] = src_row[sx * 3 + 1];
      dst_row[x * 3 + 2] = src_row[sx * 3 + 2];
    }
  }
  return EncodeJpegWic(buf.data(), nw, nh, dst_stride, out);
}

bool DownscaleJpegMaxLongEdge(const uint8_t* jpg, size_t jpg_len, int max_long_edge, std::vector<uint8_t>& out) {
  std::lock_guard<std::recursive_mutex> lock(WicMutex());
  IWICImagingFactory* fac = WicFactory();
  if (!fac || !jpg || jpg_len == 0 || max_long_edge <= 0) {
    return false;
  }
  IWICStream* stream = nullptr;
  HRESULT hr = fac->CreateStream(&stream);
  if (FAILED(hr) || !stream) {
    return false;
  }
  hr = stream->InitializeFromMemory(const_cast<uint8_t*>(jpg), static_cast<DWORD>(jpg_len));
  if (FAILED(hr)) {
    stream->Release();
    return false;
  }
  IWICBitmapDecoder* dec = nullptr;
  hr = fac->CreateDecoderFromStream(stream, nullptr, WICDecodeMetadataCacheOnDemand, &dec);
  stream->Release();
  if (FAILED(hr) || !dec) {
    return false;
  }
  IWICBitmapFrameDecode* frame = nullptr;
  hr = dec->GetFrame(0, &frame);
  dec->Release();
  if (FAILED(hr) || !frame) {
    return false;
  }
  UINT w = 0;
  UINT h = 0;
  frame->GetSize(&w, &h);
  const int width = static_cast<int>(w);
  const int height = static_cast<int>(h);
  IWICFormatConverter* conv = nullptr;
  hr = fac->CreateFormatConverter(&conv);
  if (FAILED(hr) || !conv) {
    frame->Release();
    return false;
  }
  hr = conv->Initialize(frame, GUID_WICPixelFormat24bppBGR, WICBitmapDitherTypeNone, nullptr, 0.0,
                      WICBitmapPaletteTypeMedianCut);
  frame->Release();
  if (FAILED(hr)) {
    conv->Release();
    return false;
  }
  const UINT stride = (w * 3u + 3u) & ~3u;
  std::vector<uint8_t> bgr(static_cast<size_t>(stride) * h);
  hr = conv->CopyPixels(nullptr, stride, static_cast<UINT>(bgr.size()), bgr.data());
  conv->Release();
  if (FAILED(hr)) {
    return false;
  }
  return EncodeJpegWicMaxLongEdge(bgr.data(), width, height, static_cast<int>(stride), max_long_edge, out);
}

bool DecodeJpegToRgbaWic(const uint8_t* jpg, size_t jpg_len, std::vector<uint8_t>& rgba, int& width, int& height) {
  std::lock_guard<std::recursive_mutex> lock(WicMutex());
  IWICImagingFactory* fac = WicFactory();
  if (!fac || !jpg || jpg_len == 0) {
    return false;
  }
  IWICStream* stream = nullptr;
  HRESULT hr = fac->CreateStream(&stream);
  if (FAILED(hr) || !stream) {
    return false;
  }
  hr = stream->InitializeFromMemory(const_cast<uint8_t*>(jpg), static_cast<DWORD>(jpg_len));
  if (FAILED(hr)) {
    stream->Release();
    return false;
  }
  IWICBitmapDecoder* dec = nullptr;
  hr = fac->CreateDecoderFromStream(stream, nullptr, WICDecodeMetadataCacheOnDemand, &dec);
  stream->Release();
  if (FAILED(hr) || !dec) {
    return false;
  }
  IWICBitmapFrameDecode* frame = nullptr;
  hr = dec->GetFrame(0, &frame);
  dec->Release();
  if (FAILED(hr) || !frame) {
    return false;
  }
  UINT w = 0;
  UINT h = 0;
  frame->GetSize(&w, &h);
  width = static_cast<int>(w);
  height = static_cast<int>(h);
  IWICFormatConverter* conv = nullptr;
  hr = fac->CreateFormatConverter(&conv);
  if (FAILED(hr) || !conv) {
    frame->Release();
    return false;
  }
  hr = conv->Initialize(frame, GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone, nullptr, 0.0,
                        WICBitmapPaletteTypeMedianCut);
  frame->Release();
  if (FAILED(hr)) {
    conv->Release();
    return false;
  }
  const UINT stride = w * 4;
  rgba.resize(static_cast<size_t>(stride * h));
  hr = conv->CopyPixels(nullptr, stride, static_cast<UINT>(rgba.size()), rgba.data());
  conv->Release();
  return SUCCEEDED(hr);
}

bool EncodePngRgbaWic(const uint8_t* rgba, int width, int height, std::vector<uint8_t>& out) {
  std::lock_guard<std::recursive_mutex> lock(WicMutex());
  IWICImagingFactory* fac = WicFactory();
  if (!fac || !rgba || width <= 0 || height <= 0) {
    return false;
  }
  IWICBitmap* bmp = nullptr;
  const UINT stride = static_cast<UINT>(width * 4);
  HRESULT hr = fac->CreateBitmapFromMemory(static_cast<UINT>(width), static_cast<UINT>(height),
                                           GUID_WICPixelFormat32bppBGRA, stride,
                                           static_cast<UINT>(height * stride), const_cast<BYTE*>(rgba), &bmp);
  if (FAILED(hr) || !bmp) {
    return false;
  }
  HGLOBAL hg = GlobalAlloc(GMEM_MOVEABLE, 0);
  if (!hg) {
    bmp->Release();
    return false;
  }
  IStream* stream = nullptr;
  hr = CreateStreamOnHGlobal(hg, TRUE, &stream);
  if (FAILED(hr) || !stream) {
    GlobalFree(hg);
    bmp->Release();
    return false;
  }
  IWICBitmapEncoder* enc = nullptr;
  hr = fac->CreateEncoder(GUID_ContainerFormatPng, nullptr, &enc);
  if (FAILED(hr) || !enc) {
    stream->Release();
    bmp->Release();
    return false;
  }
  hr = enc->Initialize(stream, WICBitmapEncoderNoCache);
  if (FAILED(hr)) {
    enc->Release();
    stream->Release();
    bmp->Release();
    return false;
  }
  IWICBitmapFrameEncode* frame = nullptr;
  hr = enc->CreateNewFrame(&frame, nullptr);
  if (FAILED(hr) || !frame) {
    enc->Release();
    stream->Release();
    bmp->Release();
    return false;
  }
  hr = frame->Initialize(nullptr);
  if (FAILED(hr)) {
    frame->Release();
    enc->Release();
    stream->Release();
    bmp->Release();
    return false;
  }
  hr = frame->WriteSource(bmp, nullptr);
  bmp->Release();
  if (FAILED(hr)) {
    frame->Release();
    enc->Release();
    stream->Release();
    return false;
  }
  hr = frame->Commit();
  frame->Release();
  if (FAILED(hr)) {
    enc->Release();
    stream->Release();
    return false;
  }
  hr = enc->Commit();
  enc->Release();
  if (FAILED(hr)) {
    stream->Release();
    return false;
  }
  STATSTG st = {};
  hr = stream->Stat(&st, STATFLAG_NONAME);
  if (FAILED(hr) || st.cbSize.HighPart != 0) {
    stream->Release();
    return false;
  }
  out.resize(static_cast<size_t>(st.cbSize.LowPart));
  LARGE_INTEGER z{};
  hr = stream->Seek(z, STREAM_SEEK_SET, nullptr);
  if (FAILED(hr)) {
    stream->Release();
    return false;
  }
  ULONG rd = 0;
  hr = stream->Read(out.data(), static_cast<ULONG>(out.size()), &rd);
  stream->Release();
  return SUCCEEDED(hr) && rd == out.size();
}
