#include "mf_camera.h"

#include "camera_thread.h"
#include "preview_encode_thread.h"
#include "jpeg_wic.h"
#include "mf_capture_control.h"
#include "mf_controls.h"
#include "mf_device_source.h"
#include "mf_hotplug.h"
#include "mf_source_reader_callback.h"

#include "mf_capture_control.h"

#include <chrono>
#include <cstring>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <mferror.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfobjects.h>
#include <mfreadwrite.h>

#include <algorithm>
#include <cstdio>
#include <cstring>

namespace {

std::string WideToUtf8(const wchar_t* w) {
  if (!w || !*w) {
    return {};
  }
  const int needed = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
  if (needed <= 0) {
    return {};
  }
  std::string out(static_cast<size_t>(needed - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, w, -1, out.data(), needed, nullptr, nullptr);
  return out;
}

std::wstring Utf8ToWide(const std::string& s) {
  if (s.empty()) {
    return {};
  }
  const int needed = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
  if (needed <= 0) {
    return {};
  }
  std::wstring out(static_cast<size_t>(needed - 1), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, out.data(), needed);
  return out;
}

uint64_t PixelArea(const uint32_t width, const uint32_t height) {
  return static_cast<uint64_t>(width) * static_cast<uint64_t>(height);
}

int MjpegModeScore(const UINT32 width, const UINT32 height) {
  const UINT32 long_edge = (std::max)(width, height);
  if (long_edge == 0 || long_edge > 7680) {
    return -1;
  }
  const uint64_t area = PixelArea(width, height);
  constexpr int kMaxAreaScore = 0x7fffffff;
  return area > static_cast<uint64_t>(kMaxAreaScore) ? kMaxAreaScore : static_cast<int>(area);
}

void LogFormatSubtypeFourcc(const GUID& subtype) {
  const unsigned char* b = reinterpret_cast<const unsigned char*>(&subtype.Data1);
  std::fprintf(stderr, "%c%c%c%c", b[0], b[1], b[2], b[3]);
}

bool BufferLooksLikeJpeg(const std::vector<uint8_t>& buf) {
  return buf.size() >= 2 && buf[0] == 0xFF && buf[1] == 0xD8;
}

bool IsRgb32Subtype(const GUID& subtype) {
  return subtype == MFVideoFormat_RGB32 || subtype == MFVideoFormat_ARGB32;
}

void BgraToBgr(const std::vector<uint8_t>& bgra, std::vector<uint8_t>& bgr) {
  bgr.clear();
  if (bgra.size() < 4) {
    return;
  }
  const size_t px = bgra.size() / 4;
  bgr.resize(px * 3);
  for (size_t i = 0, j = 0; i + 3 < bgra.size(); i += 4, j += 3) {
    bgr[j + 0] = bgra[i + 0];
    bgr[j + 1] = bgra[i + 1];
    bgr[j + 2] = bgra[i + 2];
  }
}

}  // namespace

static MfCamera* g_camera = nullptr;
static std::mutex g_camera_mu;

// MF_SOURCE_READER_FIRST_VIDEO_STREAM — not MF_SOURCE_READER_MEDIASOURCE (0xFFFFFFFF).
static constexpr DWORD kVideoStreamIndex = 0xFFFFFFFEu;

MfCamera& GetMfCamera() {
  std::lock_guard<std::mutex> lock(g_camera_mu);
  if (!g_camera) {
    g_camera = new MfCamera();
  }
  return *g_camera;
}

void ShutdownMfCamera() {
  {
    std::lock_guard<std::mutex> lock(g_camera_mu);
    if (g_camera) {
      g_camera->Close();
      delete g_camera;
      g_camera = nullptr;
    }
  }
  ShutdownPreviewEncodeThread();
  ShutdownCameraThread();
}

std::vector<CameraDevice> ListMfCameraDevices() {
  std::vector<CameraDevice> out;
  IMFAttributes* attrs = nullptr;
  if (FAILED(MFCreateAttributes(&attrs, 1))) {
    return out;
  }
  attrs->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);
  IMFActivate** devices = nullptr;
  UINT32 count = 0;
  if (FAILED(MFEnumDeviceSources(attrs, &devices, &count))) {
    attrs->Release();
    return out;
  }
  for (UINT32 i = 0; i < count; ++i) {
    wchar_t* link = nullptr;
    UINT32 linkLen = 0;
    wchar_t* name = nullptr;
    UINT32 nameLen = 0;
    CameraDevice row;
    if (SUCCEEDED(devices[i]->GetAllocatedString(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, &link,
                                                 &linkLen)) &&
        link) {
      row.id = WideToUtf8(link);
      CoTaskMemFree(link);
    }
    if (SUCCEEDED(devices[i]->GetAllocatedString(MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME, &name, &nameLen)) && name) {
      row.label = WideToUtf8(name);
      CoTaskMemFree(name);
    }
    if (row.label.empty()) {
      row.label = row.id;
    }
    if (!row.id.empty()) {
      out.push_back(std::move(row));
    }
    devices[i]->Release();
  }
  CoTaskMemFree(devices);
  attrs->Release();
  return out;
}

void MfCamera::UpdateFrameInfoFromMediaType(IMFMediaType* type) {
  if (!type) {
    return;
  }
  if (FAILED(type->GetGUID(MF_MT_SUBTYPE, &frame_subtype_))) {
    frame_subtype_ = {};
  }
  UINT32 w = 0;
  UINT32 h = 0;
  MFGetAttributeSize(type, MF_MT_FRAME_SIZE, &w, &h);
  frame_width_ = static_cast<int>(w);
  frame_height_ = static_cast<int>(h);
}

bool MfCamera::ApplyPresentationProfile(IMFMediaSource* source, const MfFormatProfile& profile) {
  if (!source || profile.width == 0 || profile.height == 0) {
    return false;
  }
  IMFPresentationDescriptor* pd = nullptr;
  if (FAILED(source->CreatePresentationDescriptor(&pd)) || !pd) {
    return false;
  }
  BOOL selected = FALSE;
  IMFStreamDescriptor* sd = nullptr;
  HRESULT hr = pd->GetStreamDescriptorByIndex(profile.stream_index, &selected, &sd);
  if (FAILED(hr) || !sd) {
    pd->Release();
    return false;
  }
  IMFMediaTypeHandler* handler = nullptr;
  hr = sd->GetMediaTypeHandler(&handler);
  if (FAILED(hr) || !handler) {
    sd->Release();
    pd->Release();
    return false;
  }
  IMFMediaType* pick = nullptr;
  hr = handler->GetMediaTypeByIndex(profile.type_index, &pick);
  if (SUCCEEDED(hr) && pick) {
    hr = handler->SetCurrentMediaType(pick);
  }
  if (pick) {
    pick->Release();
  }
  IMFMediaType* current = nullptr;
  if (SUCCEEDED(hr)) {
    handler->GetCurrentMediaType(&current);
  }
  handler->Release();
  sd->Release();
  pd->Release();
  if (FAILED(hr)) {
    std::fprintf(stderr, "[camera_mf] presentation SetCurrentMediaType failed: 0x%08lx\n",
                 static_cast<unsigned long>(hr));
    if (current) {
      current->Release();
    }
    return false;
  }
  if (current) {
    UpdateFrameInfoFromMediaType(current);
    current->Release();
  }
  return true;
}

bool MfCamera::NegotiateFormatOnSource(IMFMediaSource* source, uint32_t& out_stream_index) {
  out_stream_index = 0;
  stream_profile_ = {};
  if (!source) {
    return false;
  }
  IMFPresentationDescriptor* pd = nullptr;
  if (FAILED(source->CreatePresentationDescriptor(&pd)) || !pd) {
    return false;
  }
  DWORD stream_count = 0;
  pd->GetStreamDescriptorCount(&stream_count);

  int best_mode_score = -1;
  DWORD modes_scored = 0;
  struct ScoredMode {
    int score;
    UINT32 w;
    UINT32 h;
    GUID subtype;
  };
  std::vector<ScoredMode> scored_modes;
  scored_modes.reserve(64);

  for (DWORD si = 0; si < stream_count; ++si) {
    BOOL selected = FALSE;
    IMFStreamDescriptor* sd = nullptr;
    if (FAILED(pd->GetStreamDescriptorByIndex(si, &selected, &sd)) || !sd) {
      continue;
    }
    IMFMediaTypeHandler* handler = nullptr;
    if (FAILED(sd->GetMediaTypeHandler(&handler)) || !handler) {
      sd->Release();
      continue;
    }
    GUID major = {};
    if (FAILED(handler->GetMajorType(&major)) || major != MFMediaType_Video) {
      handler->Release();
      sd->Release();
      continue;
    }
    DWORD type_count = 0;
    handler->GetMediaTypeCount(&type_count);
    for (DWORD ti = 0; ti < type_count; ++ti) {
      IMFMediaType* type = nullptr;
      if (FAILED(handler->GetMediaTypeByIndex(ti, &type)) || !type) {
        continue;
      }
      GUID subtype = {};
      UINT32 w = 0;
      UINT32 h = 0;
      if (FAILED(type->GetGUID(MF_MT_SUBTYPE, &subtype)) ||
          FAILED(MFGetAttributeSize(type, MF_MT_FRAME_SIZE, &w, &h))) {
        type->Release();
        continue;
      }
      if (subtype != MFVideoFormat_MJPG && !IsRgb32Subtype(subtype)) {
        type->Release();
        continue;
      }
      const int score = MjpegModeScore(w, h);
      if (score >= 0) {
        ++modes_scored;
        scored_modes.push_back({score, w, h, subtype});
      }
      if (score > best_mode_score) {
        best_mode_score = score;
        stream_profile_.stream_index = si;
        stream_profile_.type_index = ti;
        stream_profile_.width = w;
        stream_profile_.height = h;
        stream_profile_.subtype = subtype;
      }
      type->Release();
    }
    handler->Release();
    sd->Release();
  }
  pd->Release();

  if (best_mode_score < 0) {
    std::fprintf(stderr, "[camera_mf] presentation: %u supported mode(s) scored, none usable\n", modes_scored);
    last_error_ = "no_supported_mode";
    return false;
  }

  const int best_score = best_mode_score;

  std::sort(scored_modes.begin(), scored_modes.end(),
            [](const ScoredMode& a, const ScoredMode& b) { return a.score > b.score; });
  const size_t log_n = (std::min)(scored_modes.size(), static_cast<size_t>(8));
  if (log_n > 0) {
    std::fprintf(stderr, "[camera_mf] presentation top modes (by pixel area):\n");
    for (size_t i = 0; i < log_n; ++i) {
      const ScoredMode& m = scored_modes[i];
      std::fprintf(stderr, "[camera_mf]   #%zu %ux%u ", i + 1, m.w, m.h);
      LogFormatSubtypeFourcc(m.subtype);
      std::fprintf(stderr, " score=%d\n", m.score);
    }
  }
  std::fprintf(stderr, "[camera_mf] open: %ux%u ", stream_profile_.width, stream_profile_.height);
  LogFormatSubtypeFourcc(stream_profile_.subtype);
  std::fprintf(stderr, " (live preview + capture)\n");

  if (!ApplyPresentationProfile(source, stream_profile_)) {
    return false;
  }

  out_stream_index = stream_profile_.stream_index;
  std::fprintf(stderr,
               "[camera_mf] presentation: %u mode(s), active stream %lu %dx%d subtype=%08lx (score=%d)\n",
               modes_scored, static_cast<unsigned long>(stream_profile_.stream_index), frame_width_, frame_height_,
               static_cast<unsigned long>(frame_subtype_.Data1), best_score);
  return true;
}

bool MfCamera::ApplySourceFormatToReader(IMFMediaSource* source, const uint32_t stream_index) {
  if (!reader_ || !source) {
    return false;
  }
  IMFPresentationDescriptor* pd = nullptr;
  if (FAILED(source->CreatePresentationDescriptor(&pd)) || !pd) {
    return false;
  }
  BOOL selected = FALSE;
  IMFStreamDescriptor* sd = nullptr;
  HRESULT hr = pd->GetStreamDescriptorByIndex(stream_index, &selected, &sd);
  if (FAILED(hr) || !sd) {
    pd->Release();
    return false;
  }
  IMFMediaTypeHandler* handler = nullptr;
  hr = sd->GetMediaTypeHandler(&handler);
  if (FAILED(hr) || !handler) {
    sd->Release();
    pd->Release();
    return false;
  }
  IMFMediaType* type = nullptr;
  hr = handler->GetCurrentMediaType(&type);
  handler->Release();
  sd->Release();
  pd->Release();
  if (FAILED(hr) || !type) {
    if (type) {
      type->Release();
    }
    return false;
  }

  const DWORD try_streams[] = {stream_index, kVideoStreamIndex, 0u};
  bool applied = false;
  for (const DWORD s : try_streams) {
    const HRESULT set_hr = reader_->SetCurrentMediaType(s, nullptr, type);
    if (SUCCEEDED(set_hr)) {
      video_stream_index_ = s;
      UpdateFrameInfoFromMediaType(type);
      std::fprintf(stderr, "[camera_mf] reader synced: stream=0x%lx %dx%d subtype=%08lx\n",
                   static_cast<unsigned long>(s), frame_width_, frame_height_,
                   static_cast<unsigned long>(frame_subtype_.Data1));
      applied = true;
      break;
    }
  }
  type->Release();
  return applied;
}

bool MfCamera::ShouldChainPreviewRead() const {
  return is_open_.load(std::memory_order_acquire);
}

MfCaptureProfile MfCamera::GetCaptureProfile() const {
  MfCaptureProfile p;
  p.width = stream_profile_.width;
  p.height = stream_profile_.height;
  p.subtype_data1 = stream_profile_.subtype.Data1;
  p.pixel_area = PixelArea(stream_profile_.width, stream_profile_.height);
  return p;
}

void MfCamera::WaitForPreviewEncodeIdle(const int timeout_ms) {
  const int step_ms = 5;
  for (int waited = 0; waited < timeout_ms; waited += step_ms) {
    if (!preview_encode_in_progress_.load(std::memory_order_acquire)) {
      return;
    }
    Sleep(static_cast<DWORD>(step_ms));
  }
}

bool MfCamera::IngestSample(IMFSample* sample) {
  if (!sample || frame_width_ <= 0 || frame_height_ <= 0) {
    return false;
  }
  std::vector<uint8_t> raw;
  if (!ExtractRawBytesFromSample(sample, raw) || raw.empty()) {
    return false;
  }
  {
    std::lock_guard<std::mutex> lock(preview_mu_);
    latest_sample_bytes_ = std::move(raw);
  }
  raw_frame_generation_.fetch_add(1, std::memory_order_release);
  return true;
}

bool MfCamera::EncodePreviewJpegFromFrame(const std::vector<uint8_t>& frame_bytes, const int live_max_edge,
                                          std::vector<uint8_t>& preview_jpeg) const {
  preview_jpeg.clear();
  if (frame_bytes.empty()) {
    return false;
  }
  if (frame_subtype_ == MFVideoFormat_MJPG || BufferLooksLikeJpeg(frame_bytes)) {
    if (!DownscaleJpegMaxLongEdge(frame_bytes.data(), frame_bytes.size(), live_max_edge, preview_jpeg)) {
      preview_jpeg = frame_bytes;
    }
    return !preview_jpeg.empty();
  }
  if (IsRgb32Subtype(frame_subtype_)) {
    if (frame_width_ <= 0 || frame_height_ <= 0) {
      return false;
    }
    const size_t expected = static_cast<size_t>(frame_width_) * static_cast<size_t>(frame_height_) * 4u;
    if (frame_bytes.size() < expected) {
      return false;
    }
    std::vector<uint8_t> bgr;
    BgraToBgr(frame_bytes, bgr);
    if (bgr.empty()) {
      return false;
    }
    return EncodeJpegWicMaxLongEdge(bgr.data(), frame_width_, frame_height_, frame_width_ * 3, live_max_edge,
                                    preview_jpeg);
  }
  return false;
}

void MfCamera::SchedulePreviewEncodeFromCache() {
  if (!is_open_.load(std::memory_order_acquire)) {
    return;
  }
  const uint64_t raw_gen = raw_frame_generation_.load(std::memory_order_acquire);
  if (raw_gen == 0 || raw_gen == last_encoded_raw_generation_.load(std::memory_order_acquire)) {
    return;
  }
  if (preview_encode_in_progress_.load(std::memory_order_acquire)) {
    return;
  }

  std::vector<uint8_t> raw_snapshot;
  int live_max_edge = 0;
  {
    std::lock_guard<std::mutex> lock(preview_mu_);
    if (latest_sample_bytes_.empty()) {
      return;
    }
    raw_snapshot = latest_sample_bytes_;
    live_max_edge = live_max_;
  }

  preview_encode_in_progress_.store(true, std::memory_order_release);

  QueuePreviewEncodeWork([this, raw_snapshot = std::move(raw_snapshot), live_max_edge, raw_gen]() {
    std::vector<uint8_t> preview_jpeg;
    const bool ok = EncodePreviewJpegFromFrame(raw_snapshot, live_max_edge, preview_jpeg);
    const bool still_latest = raw_gen == raw_frame_generation_.load(std::memory_order_acquire);
    if (ok && still_latest && is_open_.load(std::memory_order_acquire)) {
      {
        std::lock_guard<std::mutex> lock(preview_mu_);
        latest_preview_jpeg_ = std::move(preview_jpeg);
      }
      preview_frame_generation_.fetch_add(1, std::memory_order_release);
      last_encoded_raw_generation_.store(raw_gen, std::memory_order_release);
    }
    preview_encode_in_progress_.store(false, std::memory_order_release);
    if (is_open_.load(std::memory_order_acquire) &&
        raw_gen != raw_frame_generation_.load(std::memory_order_acquire)) {
      SchedulePreviewEncodeFromCache();
    }
  });
}

bool MfCamera::ProbeBestNativeTypeOnStream(const uint32_t stream_index, IMFMediaType** out_type, int* out_score) {
  if (!reader_ || !out_type || !out_score) {
    return false;
  }
  *out_type = nullptr;
  *out_score = -1;
  IMFMediaType* best_type = nullptr;
  int best_score = -1;
  DWORD types_seen = 0;
  for (DWORD i = 0; i < 128; ++i) {
    if (ShouldAbortCapture()) {
      last_error_ = "open_cancelled";
      if (best_type) {
        best_type->Release();
      }
      return false;
    }
    IMFMediaType* type = nullptr;
    const HRESULT hr = reader_->GetNativeMediaType(stream_index, i, &type);
    if (hr == MF_E_NO_MORE_TYPES) {
      break;
    }
    if (FAILED(hr) || !type) {
      continue;
    }
    ++types_seen;
    GUID subtype = {};
    UINT32 width = 0;
    UINT32 height = 0;
    if (FAILED(type->GetGUID(MF_MT_SUBTYPE, &subtype)) ||
        FAILED(MFGetAttributeSize(type, MF_MT_FRAME_SIZE, &width, &height))) {
      type->Release();
      continue;
    }
    const int score = MjpegModeScore(width, height);
    if (score > best_score) {
      if (best_type) {
        best_type->Release();
      }
      best_type = type;
      best_score = score;
    } else {
      type->Release();
    }
  }
  if (!best_type || best_score < 0) {
    if (best_type) {
      best_type->Release();
    }
    std::fprintf(stderr, "[camera_mf] stream 0x%lx: %u native type(s), no supported mode scored\n",
                 static_cast<unsigned long>(stream_index), types_seen);
    return false;
  }
  *out_type = best_type;
  *out_score = best_score;
  return true;
}

bool MfCamera::NegotiateFormatFromReader() {
  if (!reader_) {
    last_error_ = "negotiation_failed: no reader";
    return false;
  }
  struct ReaderFormatCandidate {
    DWORD stream = 0;
    IMFMediaType* type = nullptr;
    int score = -1;
  };
  std::vector<ReaderFormatCandidate> candidates;
  candidates.reserve(32);
  const DWORD streams[] = {kVideoStreamIndex, 0u, 1u, 2u, 3u};
  for (const DWORD stream : streams) {
    for (DWORD i = 0; i < 128; ++i) {
      if (ShouldAbortCapture()) {
        last_error_ = "open_cancelled";
        for (const ReaderFormatCandidate& c : candidates) {
          if (c.type) {
            c.type->Release();
          }
        }
        return false;
      }
      IMFMediaType* type = nullptr;
      const HRESULT hr = reader_->GetNativeMediaType(stream, i, &type);
      if (hr == MF_E_NO_MORE_TYPES) {
        break;
      }
      if (FAILED(hr) || !type) {
        continue;
      }
      UINT32 width = 0;
      UINT32 height = 0;
      if (FAILED(MFGetAttributeSize(type, MF_MT_FRAME_SIZE, &width, &height))) {
        type->Release();
        continue;
      }
      const int score = MjpegModeScore(width, height);
      if (score < 0) {
        type->Release();
        continue;
      }
      candidates.push_back({stream, type, score});
    }
  }
  if (candidates.empty()) {
    last_error_ = "format_negotiation_failed: no suitable mode";
    std::fprintf(stderr, "[camera_mf] %s\n", last_error_.c_str());
    return false;
  }
  std::sort(candidates.begin(), candidates.end(),
            [](const ReaderFormatCandidate& a, const ReaderFormatCandidate& b) { return a.score > b.score; });

  constexpr size_t kMaxAttempts = 8;
  const size_t attempt_limit = (std::min)(candidates.size(), kMaxAttempts);
  for (size_t attempt = 0; attempt < attempt_limit; ++attempt) {
    const ReaderFormatCandidate& candidate = candidates[attempt];
    GUID chosen_subtype = {};
    candidate.type->GetGUID(MF_MT_SUBTYPE, &chosen_subtype);
    IMFMediaType* chosen_type = candidate.type;
    IMFMediaType* converted_type = nullptr;
    if (chosen_subtype != MFVideoFormat_MJPG && !IsRgb32Subtype(chosen_subtype)) {
      UINT32 req_w = 0;
      UINT32 req_h = 0;
      MFGetAttributeSize(candidate.type, MF_MT_FRAME_SIZE, &req_w, &req_h);
      if (req_w > 0 && req_h > 0 && SUCCEEDED(MFCreateMediaType(&converted_type)) && converted_type) {
        converted_type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
        converted_type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
        MFSetAttributeSize(converted_type, MF_MT_FRAME_SIZE, req_w, req_h);
        chosen_type = converted_type;
      }
    }
    const HRESULT setHr = reader_->SetCurrentMediaType(candidate.stream, nullptr, chosen_type);
    if (FAILED(setHr)) {
      if (converted_type) {
        converted_type->Release();
      }
      std::fprintf(stderr,
                   "[camera_mf] SetCurrentMediaType failed: 0x%08lx stream=0x%lx attempt=%zu score=%d\n",
                   static_cast<unsigned long>(setHr), static_cast<unsigned long>(candidate.stream), attempt + 1,
                   candidate.score);
      continue;
    }
    UpdateFrameInfoFromMediaType(chosen_type);
    UINT32 w = 0;
    UINT32 h = 0;
    GUID subtype = {};
    chosen_type->GetGUID(MF_MT_SUBTYPE, &subtype);
    MFGetAttributeSize(chosen_type, MF_MT_FRAME_SIZE, &w, &h);
    stream_profile_.stream_index = candidate.stream;
    stream_profile_.width = w;
    stream_profile_.height = h;
    stream_profile_.subtype = subtype;
    video_stream_index_ = candidate.stream;
    if (converted_type) {
      converted_type->Release();
    }
    for (size_t i = 0; i < candidates.size(); ++i) {
      if (candidates[i].type) {
        candidates[i].type->Release();
        candidates[i].type = nullptr;
      }
    }
    if (attempt == 0) {
      std::fprintf(stderr, "[camera_mf] format ok: stream=0x%lx %dx%d subtype=%08lx (score=%d)\n",
                   static_cast<unsigned long>(candidate.stream), frame_width_, frame_height_,
                   static_cast<unsigned long>(frame_subtype_.Data1), candidate.score);
    } else {
      std::fprintf(stderr,
                   "[camera_mf] format ok (fallback attempt %zu): stream=0x%lx %dx%d subtype=%08lx (score=%d)\n",
                   attempt + 1, static_cast<unsigned long>(candidate.stream), frame_width_, frame_height_,
                   static_cast<unsigned long>(frame_subtype_.Data1), candidate.score);
    }
    return true;
  }

  for (const ReaderFormatCandidate& c : candidates) {
    if (c.type) {
      c.type->Release();
    }
  }
  last_error_ = "format_negotiation_failed: SetCurrentMediaType failed for all candidate modes";
  std::fprintf(stderr, "[camera_mf] %s\n", last_error_.c_str());
  return false;
}

bool MfCamera::ExtractRawBytesFromSample(IMFSample* sample, std::vector<uint8_t>& out) const {
  out.clear();
  if (!sample) {
    return false;
  }
  IMFMediaBuffer* contiguous = nullptr;
  if (FAILED(sample->ConvertToContiguousBuffer(&contiguous)) || !contiguous) {
    return false;
  }
  BYTE* data = nullptr;
  DWORD max_len = 0;
  DWORD cur_len = 0;
  if (FAILED(contiguous->Lock(&data, &max_len, &cur_len)) || !data || cur_len == 0) {
    contiguous->Release();
    return false;
  }
  out.assign(data, data + cur_len);
  contiguous->Unlock();
  contiguous->Release();
  return !out.empty();
}

bool MfCamera::ShouldAbortReader() const {
  return ShouldAbortCapture();
}

void MfCamera::OnReaderInvalidated() {
  last_error_ = "device_invalidated";
  QueueOnCameraThread([this]() {
    is_open_.store(false, std::memory_order_release);
    preview_frame_generation_.store(0, std::memory_order_release);
    raw_frame_generation_.store(0, std::memory_order_release);
    {
      std::lock_guard<std::mutex> lock(preview_mu_);
      latest_preview_jpeg_.clear();
      latest_sample_bytes_.clear();
    }
    if (reader_callback_) {
      reader_callback_->Detach();
    }
    NotifyMfDeviceInvalidated();
  });
}

void MfCamera::OnReaderSample(IMFSample* sample, const uint32_t stream_flags) {
  if (ShouldAbortCapture() || !is_open_) {
    return;
  }
  if ((stream_flags & MF_SOURCE_READERF_ERROR) != 0) {
    return;
  }
  if (!sample) {
    return;
  }

  if (!manual_modes_forced_ && source_) {
    ForceManualCameraModes(source_);
    manual_modes_forced_ = true;
  }
  if (!IngestSample(sample)) {
    return;
  }
  const uint64_t raw_gen = raw_frame_generation_.load(std::memory_order_acquire);
  bool mjpeg_passthrough = frame_subtype_ == MFVideoFormat_MJPG;
  if (!mjpeg_passthrough) {
    std::lock_guard<std::mutex> lock(preview_mu_);
    mjpeg_passthrough = BufferLooksLikeJpeg(latest_sample_bytes_);
  }
  if (mjpeg_passthrough) {
    std::lock_guard<std::mutex> lock(preview_mu_);
    if (!latest_sample_bytes_.empty()) {
      latest_preview_jpeg_ = latest_sample_bytes_;
      preview_frame_generation_.fetch_add(1, std::memory_order_release);
      last_encoded_raw_generation_.store(raw_gen, std::memory_order_release);
    }
    return;
  }
  SchedulePreviewEncodeFromCache();
}

void MfCamera::KickAsyncPreviewRead() {
  if (!reader_callback_ || !is_open_) {
    return;
  }
  if (!ShouldChainPreviewRead()) {
    return;
  }
  reader_callback_->RequestSample();
}

void MfCamera::RequestPreviewEncode() {
  SchedulePreviewEncodeFromCache();
}

bool MfCamera::Open(const std::string& device_id, int live_preview_max_long_edge, int capture_preview_max_long_edge) {
  if (is_open_ && open_device_id_ == device_id && reader_ && source_) {
    LogMfStep("Open: already active");
    return true;
  }
  ClearCaptureAbort();
  const auto deadline =
      std::chrono::steady_clock::now() + std::chrono::milliseconds(GetOpenDeadlineMs());
  const auto should_stop = [&]() {
    return ShouldAbortCapture() || std::chrono::steady_clock::now() >= deadline;
  };

  ReleaseResources();
  last_error_.clear();
  live_max_ = live_preview_max_long_edge;
  capture_max_ = capture_preview_max_long_edge;
  if (live_max_ < 320) {
    live_max_ = 320;
  }
  if (live_max_ > 1920) {
    live_max_ = 1920;
  }
  if (capture_max_ < 320) {
    capture_max_ = 320;
  }
  if (capture_max_ > 1920) {
    capture_max_ = 1920;
  }

  if (device_id.empty()) {
    last_error_ = "deviceId required";
    return false;
  }

  const std::wstring link = Utf8ToWide(device_id);
  if (link.empty()) {
    last_error_ = "deviceId encoding failed";
    return false;
  }

  if (should_stop()) {
    last_error_ = ShouldAbortCapture() ? "open_cancelled" : "open_timeout";
    return false;
  }

  LogMfStep("Open: creating device source…");
  IMFMediaSource* source = nullptr;
  std::string source_err;
  if (!CreateMfDeviceSource(link, &source, source_err)) {
    last_error_ = source_err.empty() ? "MFCreateDeviceSource failed" : source_err;
    return false;
  }

  if (should_stop()) {
    source->Shutdown();
    source->Release();
    last_error_ = ShouldAbortCapture() ? "open_cancelled" : "open_timeout";
    return false;
  }

  LogMfStep("Open: creating source reader…");
  if (reader_callback_) {
    reader_callback_->Detach();
    reader_callback_->Release();
    reader_callback_ = nullptr;
  }
  const HRESULT cb_hr = MfSourceReaderCallback::Create(this, &reader_callback_);
  if (FAILED(cb_hr) || !reader_callback_) {
    source->Shutdown();
    source->Release();
    last_error_ = "IMFSourceReaderCallback create failed";
    return false;
  }

  uint32_t presentation_stream = 0;
  const bool presentation_ok = NegotiateFormatOnSource(source, presentation_stream);

  IMFAttributes* reader_attrs = nullptr;
  MFCreateAttributes(&reader_attrs, 4);
  if (reader_attrs) {
    reader_attrs->SetUINT32(MF_SOURCE_READER_DISCONNECT_MEDIASOURCE_ON_SHUTDOWN, TRUE);
    reader_attrs->SetUnknown(MF_SOURCE_READER_ASYNC_CALLBACK, reader_callback_);
    reader_attrs->SetUINT32(MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, TRUE);
  }

  IMFSourceReader* reader = nullptr;
  HRESULT hr = MFCreateSourceReaderFromMediaSource(source, reader_attrs, &reader);
  if (reader_attrs) {
    reader_attrs->Release();
  }
  if (FAILED(hr) || !reader) {
    reader_callback_->Detach();
    reader_callback_->Release();
    reader_callback_ = nullptr;
    source->Shutdown();
    source->Release();
    char buf[128];
    std::snprintf(buf, sizeof(buf), "MFCreateSourceReaderFromMediaSource failed: 0x%08lx",
                  static_cast<unsigned long>(hr));
    last_error_ = buf;
    std::fprintf(stderr, "[camera_mf] %s\n", last_error_.c_str());
    return false;
  }

  source_ = source;
  reader_ = reader;

  if (should_stop()) {
    ReleaseResources();
    last_error_ = ShouldAbortCapture() ? "open_cancelled" : "open_timeout";
    return false;
  }

  LogMfStep("Open: negotiating format…");
  bool format_ok = false;
  if (presentation_ok) {
    format_ok = ApplySourceFormatToReader(source, presentation_stream);
  }
  if (!format_ok && NegotiateFormatFromReader()) {
    format_ok = true;
  }
  if (!format_ok) {
    const std::string err = last_error_;
    ReleaseResources();
    last_error_ = err.empty() ? "format_negotiation_failed" : err;
    return false;
  }

  reader_callback_->AttachReader(reader_, static_cast<DWORD>(video_stream_index_));
  EnsurePreviewEncodeThread();
  raw_frame_generation_.store(0, std::memory_order_release);
  preview_frame_generation_.store(0, std::memory_order_release);
  last_encoded_raw_generation_.store(0, std::memory_order_release);
  preview_encode_in_progress_.store(false, std::memory_order_release);
  manual_modes_forced_ = false;
  is_open_.store(true, std::memory_order_release);
  open_device_id_ = device_id;
  last_error_.clear();
  KickAsyncPreviewRead();
  LogMfStep("Open: ready (preview via pump)");
  return true;
}

void MfCamera::ReleaseResources() {
  WaitForPreviewEncodeIdle(3000);
  if (reader_callback_) {
    reader_callback_->Detach();
    reader_callback_->Release();
    reader_callback_ = nullptr;
  }
  preview_frame_generation_.store(0, std::memory_order_release);
  raw_frame_generation_.store(0, std::memory_order_release);
  last_encoded_raw_generation_.store(0, std::memory_order_release);
  preview_encode_in_progress_.store(false, std::memory_order_release);
  {
    std::lock_guard<std::mutex> lock(preview_mu_);
    latest_preview_jpeg_.clear();
    latest_sample_bytes_.clear();
  }
  frame_width_ = 0;
  frame_height_ = 0;
  frame_subtype_ = {};
  stream_profile_ = {};
  if (reader_) {
    reader_->Flush(static_cast<DWORD>(video_stream_index_));
    reader_->Release();
    reader_ = nullptr;
  }
  if (source_) {
    source_->Shutdown();
    source_->Release();
    source_ = nullptr;
  }
  is_open_.store(false, std::memory_order_release);
  manual_modes_forced_ = false;
  open_device_id_.clear();
}

void MfCamera::Close() {
  RequestCaptureAbort();
  ReleaseResources();
  last_error_.clear();
}

bool MfCamera::CopyPreviewJpeg(std::vector<uint8_t>& out) {
  std::lock_guard<std::mutex> lock(preview_mu_);
  if (!is_open_ || latest_preview_jpeg_.empty()) {
    return false;
  }
  out = latest_preview_jpeg_;
  return true;
}

bool MfCamera::CopyLatestSampleBytes(std::vector<uint8_t>& out) {
  std::lock_guard<std::mutex> lock(preview_mu_);
  if (!is_open_ || latest_sample_bytes_.empty()) {
    return false;
  }
  out = latest_sample_bytes_;
  return true;
}

bool MfCamera::EncodeGrabOutputsFromBuffer(const std::vector<uint8_t>& buf, const int width, const int height,
                                           const GUID& subtype, const int cap_edge, const bool source_is_png,
                                           std::vector<uint8_t>& preview_jpeg,
                                           std::vector<uint8_t>& source) const {
  if (buf.empty() || width <= 0 || height <= 0) {
    return false;
  }
  if (subtype == MFVideoFormat_MJPG || BufferLooksLikeJpeg(buf)) {
    if (!DownscaleJpegMaxLongEdge(buf.data(), buf.size(), cap_edge, preview_jpeg)) {
      preview_jpeg = buf;
    }
    if (source_is_png) {
      std::vector<uint8_t> rgba;
      int w = 0;
      int h = 0;
      if (!DecodeJpegToRgbaWic(buf.data(), buf.size(), rgba, w, h)) {
        return false;
      }
      return EncodePngRgbaWic(rgba.data(), w, h, source) && !preview_jpeg.empty() && !source.empty();
    }
    source = buf;
    return !preview_jpeg.empty() && !source.empty();
  }
  if (IsRgb32Subtype(subtype)) {
    const size_t expected = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
    if (buf.size() < expected) {
      return false;
    }
    std::vector<uint8_t> bgr;
    BgraToBgr(buf, bgr);
    if (bgr.empty()) {
      return false;
    }
    if (!EncodeJpegWicMaxLongEdge(bgr.data(), width, height, width * 3, cap_edge, preview_jpeg)) {
      return false;
    }
    if (source_is_png) {
      std::vector<uint8_t> rgba(buf.begin(), buf.begin() + static_cast<std::ptrdiff_t>(expected));
      return EncodePngRgbaWic(rgba.data(), width, height, source) && !preview_jpeg.empty() && !source.empty();
    }
    return EncodeJpegWic(bgr.data(), width, height, width * 3, source) && !preview_jpeg.empty() && !source.empty();
  }
  return false;
}

bool MfCamera::GrabStill(const std::string& capture_mode, std::vector<uint8_t>& preview_jpeg,
                         std::vector<uint8_t>& source, bool& source_is_png, int grab_preview_max_edge,
                         int& out_source_width, int& out_source_height) {
  out_source_width = 0;
  out_source_height = 0;
  source_is_png = (capture_mode == "png" || capture_mode == "png_master_with_jpeg_preview");
  const bool wants_jpeg = (capture_mode == "jpeg" || capture_mode == "jpeg_only");
  const bool wants_png = source_is_png;
  if (!wants_jpeg && !wants_png) {
    last_error_ = "invalid_capture_mode";
    return false;
  }
  if (!is_open_) {
    last_error_ = "camera_not_open";
    return false;
  }
  const int cap_edge = grab_preview_max_edge > 0 ? grab_preview_max_edge : capture_max_;

  WaitForPreviewEncodeIdle(200);

  if (reader_callback_) {
    reader_callback_->WaitUntilIdle(1500);
  }

  std::vector<uint8_t> buf;
  if (!CopyLatestSampleBytes(buf) || buf.empty()) {
    std::fprintf(stderr, "[camera_mf] GrabStill: no cached frame (wait for live preview)\n");
    last_error_ = "stream_not_ready";
    return false;
  }

  const int grab_w = frame_width_;
  const int grab_h = frame_height_;
  const GUID grab_subtype = frame_subtype_;
  if (grab_w <= 0 || grab_h <= 0) {
    last_error_ = "stream_not_ready";
    return false;
  }
  if (static_cast<uint32_t>(grab_w) != stream_profile_.width ||
      static_cast<uint32_t>(grab_h) != stream_profile_.height) {
    std::fprintf(stderr,
                 "[camera_mf] GrabStill: resolution_mismatch expected %ux%u got %dx%d bytes=%zu\n",
                 stream_profile_.width, stream_profile_.height, grab_w, grab_h, buf.size());
    last_error_ = "capture_resolution_mismatch";
    return false;
  }
  if (grab_subtype != MFVideoFormat_MJPG && !BufferLooksLikeJpeg(buf) && !IsRgb32Subtype(grab_subtype)) {
    last_error_ = "capture_not_supported_format";
    return false;
  }

  if (!EncodeGrabOutputsFromBuffer(buf, grab_w, grab_h, grab_subtype, cap_edge, source_is_png, preview_jpeg, source)) {
    last_error_ = "encode_failed";
    return false;
  }
  if (preview_jpeg.empty() || source.empty()) {
    last_error_ = "encode_empty_output";
    return false;
  }
  out_source_width = grab_w;
  out_source_height = grab_h;
  std::fprintf(stderr, "[camera_mf] GrabStill: %dx%d subtype=%08lx (preview capped at %d px long edge)\n", grab_w,
               grab_h, static_cast<unsigned long>(grab_subtype.Data1), cap_edge);
  return true;
}

bool MfCamera::GetCapabilities(std::map<std::string, CameraNumCap>& out) {
  if (!source_) {
    return false;
  }
  return GetMfControlCapabilities(source_, out);
}

bool MfCamera::GetControlValues(std::map<std::string, double>& out) {
  if (!source_) {
    return false;
  }
  return GetMfControlValues(source_, out);
}

CameraControlApplyResult MfCamera::SetControlValues(const std::map<std::string, double>& partial) {
  if (!source_) {
    CameraControlApplyResult result;
    result.failed["*"] = "camera not open";
    return result;
  }
  return SetMfControlValues(source_, partial);
}
